/**
 * RepsService — distributor (rep) HR records. Reuses the Auth/Clients patterns (PrismaService +
 * explicit AuditService; soft status changes, never hard-delete). — SRS HRM-001..004/007/008
 *
 * Invariant #11: rep_code is globally unique AND never reused, including terminated reps' codes —
 * enforced HERE in the service (case-insensitive pre-check across all statuses), with the DB unique
 * constraint as a backstop. Sensitive payment_details is redacted unless the caller holds hrm:edit
 * (HRM-008) and is kept out of audit payloads.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { decryptField, encryptField, loadFieldKey } from '../../common/crypto/field-cipher';
import { todayInWinnipeg } from '../../common/timezone';
import {
  bankNameFor,
  formatSin,
  maskAccount,
  maskSin,
  normalizeAccount,
  normalizeInstitution,
  normalizePostal,
  normalizeSin,
  normalizeTransit,
  routingNumbers,
} from './rep-profile.logic';
import { Prisma, Rep, RepStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AvatarService } from '../../common/avatar/avatar.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { permissionKey } from '../../common/rbac/permissions.util';
import { BUILTIN_ROLES } from '../../common/rbac/rbac.constants';
import { buildPage, resolveOrderBy, toSkipTake } from '../../common/pagination/paginate';
import {
  BulkAssignManagerDto,
  CreateRepDto,
  ListRepsQuery,
  RepProfileFieldsDto,
  UpdateRepDto,
} from './dto/rep.dto';

const dateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

/** Default list filter: active reps; terminated excluded unless explicitly requested. — HRM-004/007 */
export function repStatusWhere(status: 'active' | 'terminated' | 'all' | undefined): {
  status?: RepStatus;
} {
  if (status === 'all') {
    return {};
  }
  return { status: status === 'terminated' ? 'terminated' : 'active' };
}

/** Sensitive fields (payment_details, doc URLs) require hrm:edit. — HRM-008 */
export function canSeeSensitive(user: AuthUser): boolean {
  return user.permissions.has(permissionKey('hrm', 'edit'));
}

/** Null out payment_details unless the caller may see sensitive PII. Pure. */
export function redactRep<T extends { payment_details: unknown }>(rep: T, canSee: boolean): T {
  return canSee ? rep : { ...rep, payment_details: null };
}

/** The profile columns, as plain values (valid in both a Prisma create and update input). */
type ProfileColumns = Partial<
  Pick<
    Rep,
    | 'date_of_birth'
    | 'phone'
    | 'email'
    | 'address_street'
    | 'address_city'
    | 'address_province'
    | 'address_postal'
    | 'sin_ciphertext'
    | 'sin_last3'
    | 'jacket_size'
    | 'tshirt_size'
  >
>;

/** PII on the rep row that only an hrm:edit caller may read. — HRM-008 */
const PII_FIELDS = [
  'payment_details',
  'date_of_birth',
  'phone',
  'email',
  'address_street',
  'address_city',
  'address_province',
  'address_postal',
] as const;

/**
 * THE rep serializer — every response goes through it (list, get, create, update). Pure.
 *   - The SIN ciphertext and its last-3 never leave the server; the caller gets `sin_masked` (hrm:edit
 *     only) and `sin_on_file` (a boolean, safe for anyone who can see the rep).
 *   - Without hrm:edit, every PII field is null.
 * Returning raw rows (as create/update used to) would have shipped the ciphertext to the browser.
 */
export function toRepView(rep: Rep, canSee: boolean) {
  const { sin_ciphertext, sin_last3, payment_details, ...rest } = rep;
  const pd = asPaymentDetails(payment_details);
  // The account ciphertext never leaves the server: strip it from payment_details, and expose banking only
  // as the DERIVED, masked shape (2026-11-12).
  const publicPd = Object.fromEntries(Object.entries(pd ?? {}).filter(([k]) => k !== 'account_ciphertext'));
  const view = {
    ...rest,
    payment_details: pd ? (publicPd as Prisma.JsonObject) : null,
    sin_on_file: sin_ciphertext !== null,
    sin_masked: canSee ? maskSin(sin_last3) : null,
    banking:
      canSee && pd?.institution_no
        ? {
            institution_no: pd.institution_no,
            transit_no: pd.transit_no ?? null,
            account_masked: maskAccount(pd.account_last4),
            bank_name: pd.bank_name ?? bankNameFor(pd.institution_no),
            account_holder: pd.account_holder ?? null,
            routing_electronic: routingNumbers(pd.institution_no, pd.transit_no)?.electronic ?? null,
            routing_cheque: routingNumbers(pd.institution_no, pd.transit_no)?.cheque ?? null,
          }
        : null,
  };
  if (canSee) return view;
  const redacted: Record<string, unknown> = { ...view };
  for (const field of PII_FIELDS) redacted[field] = null;
  return redacted as typeof view;
}

/**
 * `payment_details` as stored. Banking (2026-11-12) lives under these keys; any other keys an older client
 * wrote are preserved untouched. The account number itself is ONLY ever `account_ciphertext` (AES-GCM).
 */
interface PaymentDetails {
  institution_no?: string;
  transit_no?: string;
  account_last4?: string;
  account_ciphertext?: string;
  bank_name?: string;
  account_holder?: string;
  [key: string]: unknown;
}

function asPaymentDetails(value: Prisma.JsonValue | null): PaymentDetails | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as PaymentDetails) : null;
}

const BANKING_KEYS = ['institution_no', 'transit_no', 'account_last4', 'account_ciphertext', 'bank_name', 'account_holder'] as const;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class RepsService {
  /** Columns a client may sort the list on (allowlist — the orderBy-injection guard). */
  private static readonly SORTABLE = ['rep_code', 'full_name', 'status', 'hire_date', 'created_at'] as const;

  /** AES key for the SIN; null when the server has none configured (→ SIN writes/reveals are 503). */
  private readonly piiKey = loadFieldKey();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly avatars: AvatarService,
  ) {}

  /** Adds the rep's photo (latest HR headshot, signed) — shown wherever the rep is shown. 2026-11-12 */
  private async withPhoto<T extends { id: string }>(view: T): Promise<T & { photo_url: string | null }> {
    const [row] = await this.avatars.withRepPhotos([view], (r) => r.id);
    return row;
  }

  async findAll(query: ListRepsQuery, user: AuthUser) {
    const where: Prisma.RepWhereInput = {
      ...repStatusWhere(query.status),
      ...(query.fieldManagerId ? { field_manager_id: query.fieldManagerId } : {}),
      ...(query.search
        ? {
            OR: [
              { full_name: { contains: query.search, mode: 'insensitive' } },
              { rep_code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { skip, take, page, limit } = toSkipTake(query);
    const orderBy = resolveOrderBy(query.sort, RepsService.SORTABLE, { created_at: 'asc' });
    const [reps, total] = await Promise.all([
      this.prisma.rep.findMany({ where, orderBy, skip, take }),
      this.prisma.rep.count({ where }),
    ]);
    const canSee = canSeeSensitive(user);
    return buildPage(
      await this.avatars.withRepPhotos(
        reps.map((rep) => toRepView(rep, canSee)),
        (r) => r.id,
      ),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string, user: AuthUser) {
    const rep = await this.prisma.rep.findUnique({ where: { id } });
    if (!rep) {
      throw new NotFoundException('Rep not found');
    }
    return this.withPhoto(toRepView(rep, canSeeSensitive(user)));
  }

  /**
   * A rep's OWN profile — the caller resolved the id from their token (MyRepProfileController), never from
   * input. They see their own PII (it is theirs), but the SIN stays MASKED: there is no self-reveal.
   */
  async findOwn(repId: string) {
    const rep = await this.prisma.rep.findUnique({
      where: { id: repId },
      include: { field_manager: { select: { full_name: true } } },
    });
    if (!rep) {
      throw new NotFoundException('Rep not found');
    }
    const { field_manager, ...row } = rep;
    return this.withPhoto({ ...toRepView(row, true), field_manager_name: field_manager?.full_name ?? null });
  }

  /**
   * Decrypt and return a rep's SIN. hrm:edit only (controller), and EVERY reveal is audited — who looked
   * at whose SIN and when — without the value itself ever entering the audit log.
   */
  async revealSin(id: string, actorId: string): Promise<{ sin: string | null }> {
    const rep = await this.prisma.rep.findUnique({ where: { id }, select: { id: true, sin_ciphertext: true } });
    if (!rep) {
      throw new NotFoundException('Rep not found');
    }
    if (rep.sin_ciphertext === null) {
      return { sin: null };
    }
    const sin = formatSin(decryptField(rep.sin_ciphertext, this.requirePiiKey()));
    await this.audit.log({ actorId, entityType: 'reps', entityId: id, action: 'reveal_sin' });
    return { sin };
  }

  async create(dto: CreateRepDto, user: AuthUser) {
    const actorId = user.id;
    // #11 — reject reuse of ANY existing code (active or terminated), case-insensitively.
    const existing = await this.prisma.rep.findFirst({
      where: { rep_code: { equals: dto.rep_code, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'This rep code is already used. Codes are never reused, including those of terminated reps.',
      );
    }

    await this.assertValidFieldManager(dto.field_manager_id);

    try {
      const rep = await this.prisma.rep.create({
        data: {
          rep_code: dto.rep_code,
          // Stored UPPER-cased so it matches the fold import cleaning applies to codes.
          external_code: dto.external_code?.trim() ? dto.external_code.trim().toUpperCase() : null,
          full_name: dto.full_name,
          field_manager_id: dto.field_manager_id,
          hire_date: dateOnly(dto.hire_date),
          status: 'active',
          user_id: dto.user_id ?? null,
          payment_details: this.paymentDetailsData(dto, null),
          ...this.profileData(dto),
        },
      });
      await this.audit.log({
        actorId,
        entityType: 'reps',
        entityId: rep.id,
        action: 'create',
        after: this.auditView(rep),
      });
      return this.withPhoto(toRepView(rep, canSeeSensitive(user)));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('rep_code already used'); // DB backstop for #11
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateRepDto, user: AuthUser) {
    const actorId = user.id;
    const before = await this.prisma.rep.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundException('Rep not found');
    }

    if (dto.field_manager_id && dto.field_manager_id !== before.field_manager_id) {
      await this.assertValidFieldManager(dto.field_manager_id);
    }

    const data: Prisma.RepUncheckedUpdateInput = {};
    if (dto.full_name !== undefined) data.full_name = dto.full_name;
    // An alias, not a business key — editable, and clearable by sending an empty string.
    if (dto.external_code !== undefined) {
      data.external_code = dto.external_code.trim() ? dto.external_code.trim().toUpperCase() : null;
    }
    if (dto.field_manager_id !== undefined) data.field_manager_id = dto.field_manager_id;
    if (dto.hire_date !== undefined) data.hire_date = dateOnly(dto.hire_date);
    if (dto.user_id !== undefined) data.user_id = dto.user_id ?? null;
    const paymentDetails = this.paymentDetailsData(dto, before.payment_details);
    if (paymentDetails !== undefined) data.payment_details = paymentDetails;
    Object.assign(data, this.profileData(dto));

    // Termination / reactivation (HRM-004): never delete — soft status change preserves history.
    let action = 'update';
    if (dto.status === 'terminated') {
      if (!dto.termination_date) {
        throw new UnprocessableEntityException(
          'termination_date is required when terminating a rep',
        );
      }
      data.status = 'terminated';
      data.termination_date = dateOnly(dto.termination_date);
      action = 'terminate';
    } else if (dto.status === 'active') {
      data.status = 'active';
      data.termination_date = dto.termination_date ? dateOnly(dto.termination_date) : null;
    } else if (dto.termination_date !== undefined) {
      data.termination_date = dto.termination_date ? dateOnly(dto.termination_date) : null;
    }

    const updated = await this.prisma.rep.update({ where: { id }, data });
    await this.audit.log({
      actorId,
      entityType: 'reps',
      entityId: id,
      action,
      before: this.auditView(before),
      after: this.auditView(updated),
    });
    return this.withPhoto(toRepView(updated, canSeeSensitive(user)));
  }

  /**
   * The profile columns to write, from whichever profile fields the DTO carries. `undefined` = leave alone,
   * `null` (or '' for the SIN) = clear. Validates what the DTO decorators cannot: DOB not in the future
   * (Winnipeg "today", CLAUDE §2), the postal code's shape, and the SIN's Luhn checksum — then ENCRYPTS
   * the SIN. Anything invalid is a 422 naming the field.
   */
  private profileData(dto: RepProfileFieldsDto): ProfileColumns {
    const data: ProfileColumns = {};
    const text = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() ? v.trim() : null);

    if (dto.date_of_birth !== undefined) {
      if (dto.date_of_birth !== null && dto.date_of_birth > todayInWinnipeg()) {
        throw new UnprocessableEntityException('date_of_birth cannot be in the future');
      }
      data.date_of_birth = dto.date_of_birth === null ? null : dateOnly(dto.date_of_birth);
    }
    if (dto.phone !== undefined) data.phone = text(dto.phone);
    if (dto.email !== undefined) data.email = text(dto.email)?.toLowerCase() ?? null;
    if (dto.address_street !== undefined) data.address_street = text(dto.address_street);
    if (dto.address_city !== undefined) data.address_city = text(dto.address_city);
    if (dto.address_province !== undefined) data.address_province = dto.address_province;
    if (dto.address_postal !== undefined) {
      const raw = text(dto.address_postal);
      const postal = raw === null || raw === undefined ? null : normalizePostal(raw);
      if (raw && !postal) {
        throw new UnprocessableEntityException('address_postal must be a Canadian postal code (e.g. R3G 0T7)');
      }
      data.address_postal = postal;
    }
    if (dto.jacket_size !== undefined) data.jacket_size = dto.jacket_size;
    if (dto.tshirt_size !== undefined) data.tshirt_size = dto.tshirt_size;

    if (dto.sin !== undefined) {
      const raw = text(dto.sin);
      if (!raw) {
        data.sin_ciphertext = null;
        data.sin_last3 = null;
      } else {
        const digits = normalizeSin(raw);
        if (!digits) {
          throw new UnprocessableEntityException(
            'This isn’t a valid SIN. It must be 9 digits and pass the SIN check digit; check the card for a typo.',
          );
        }
        data.sin_ciphertext = encryptField(digits, this.requirePiiKey());
        data.sin_last3 = digits.slice(-3);
      }
    }
    return data;
  }

  /**
   * The `payment_details` to write, or undefined to leave it alone. Banking keys come ONLY from the validated
   * `banking` field (2026-11-12) — a raw `payment_details` write can never set or wipe them, so it can never plant
   * an unencrypted account number. Other keys are preserved. The ACCOUNT number is encrypted (`field-cipher`,
   * same key as the SIN); a blank one on edit keeps the account on file; `banking: null` clears banking.
   */
  private paymentDetailsData(
    dto: RepProfileFieldsDto & { payment_details?: Record<string, unknown> },
    stored: Prisma.JsonValue | null,
  ): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
    if (dto.payment_details === undefined && dto.banking === undefined) return undefined;
    const existing = asPaymentDetails(stored) ?? {};
    const withoutBanking = (o: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => !(BANKING_KEYS as readonly string[]).includes(k)));
    const other = withoutBanking(dto.payment_details !== undefined ? (dto.payment_details ?? {}) : existing);

    let banking: Record<string, string> = Object.fromEntries(
      BANKING_KEYS.filter((k) => typeof existing[k] === 'string').map((k) => [k, existing[k] as string]),
    );
    if (dto.banking === null) {
      banking = {};
    } else if (dto.banking !== undefined) {
      const institution = normalizeInstitution(dto.banking.institution_no);
      if (!institution) throw new UnprocessableEntityException('The institution number is 3 digits (e.g. 001)');
      const transit = normalizeTransit(dto.banking.transit_no);
      if (!transit) throw new UnprocessableEntityException('The transit number is 5 digits (e.g. 12345)');
      const typed = dto.banking.account_no?.trim();
      let account: { account_last4: string; account_ciphertext: string };
      if (typed) {
        const digits = normalizeAccount(typed);
        if (!digits) throw new UnprocessableEntityException('The account number is 7 to 12 digits');
        account = { account_last4: digits.slice(-4), account_ciphertext: encryptField(digits, this.requirePiiKey()) };
      } else if (existing.account_ciphertext && existing.account_last4) {
        account = { account_last4: existing.account_last4, account_ciphertext: existing.account_ciphertext };
      } else {
        throw new UnprocessableEntityException('Enter the account number');
      }
      const bankName = dto.banking.bank_name?.trim() || bankNameFor(institution);
      const holder = dto.banking.account_holder?.trim();
      banking = {
        institution_no: institution,
        transit_no: transit,
        ...account,
        ...(bankName ? { bank_name: bankName } : {}),
        ...(holder ? { account_holder: holder } : {}),
      };
    }
    const merged = { ...other, ...banking };
    return Object.keys(merged).length > 0 ? (merged as Prisma.InputJsonValue) : Prisma.DbNull;
  }

  /**
   * Decrypt and return a rep's bank ACCOUNT number. hrm:edit only (controller); EVERY reveal is audited,
   * without the value. — 2026-11-12
   */
  async revealAccount(id: string, actorId: string): Promise<{ account_no: string | null }> {
    const rep = await this.prisma.rep.findUnique({ where: { id }, select: { id: true, payment_details: true } });
    if (!rep) {
      throw new NotFoundException('Rep not found');
    }
    const ciphertext = asPaymentDetails(rep.payment_details)?.account_ciphertext;
    if (!ciphertext) {
      return { account_no: null };
    }
    const account_no = decryptField(ciphertext, this.requirePiiKey());
    await this.audit.log({ actorId, entityType: 'reps', entityId: id, action: 'reveal_account' });
    return { account_no };
  }

  /** The PII key, or 503 — a SIN is never stored or revealed without it (never a plain-text fallback). */
  private requirePiiKey(): Buffer {
    if (!this.piiKey) {
      throw new ServiceUnavailableException(
        'SIN storage is not configured on this server (PII_ENCRYPTION_KEY is missing or invalid)',
      );
    }
    return this.piiKey;
  }

  /**
   * (Re)assign one or more reps to a field manager in one transaction. The roster scope (ScopeService) +
   * manager-scoped dashboards/queues read `field_manager_id`, so this drives team management. — HRM-002
   */
  async bulkAssignManager(dto: BulkAssignManagerDto, actorId: string) {
    await this.assertValidFieldManager(dto.field_manager_id);
    const repIds = [...new Set(dto.rep_ids)];
    const found = await this.prisma.rep.findMany({ where: { id: { in: repIds } }, select: { id: true } });
    if (found.length !== repIds.length) {
      throw new NotFoundException('one or more reps were not found');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.rep.updateMany({ where: { id: { in: repIds } }, data: { field_manager_id: dto.field_manager_id } });
    });
    await this.audit.log({
      actorId,
      entityType: 'reps',
      entityId: dto.field_manager_id,
      action: 'reassign_manager',
      after: { field_manager_id: dto.field_manager_id, rep_ids: repIds, count: repIds.length },
    });
    return { success: true, count: repIds.length };
  }

  private async assertValidFieldManager(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        user_roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!user) {
      throw new UnprocessableEntityException('field manager user does not exist');
    }
    if (user.status !== 'active') {
      throw new UnprocessableEntityException('field manager must be an active user');
    }
    const isManager = user.user_roles.some((ur) => ur.role.name === BUILTIN_ROLES.MANAGER);
    if (!isManager) {
      throw new UnprocessableEntityException('field manager must hold the Manager role'); // HRM-002
    }
  }

  /** Non-sensitive projection for the audit log (payment_details is never logged in full). */
  private auditView(rep: Rep) {
    return {
      rep_code: rep.rep_code,
      external_code: rep.external_code,
      full_name: rep.full_name,
      field_manager_id: rep.field_manager_id,
      status: rep.status,
      termination_date: rep.termination_date
        ? rep.termination_date.toISOString().slice(0, 10)
        : null,
      payment_details_present: rep.payment_details !== null,
      banking_present: !!asPaymentDetails(rep.payment_details)?.institution_no,
      // Profile: sizes are not PII; everything else is logged as PRESENCE only, never the value.
      jacket_size: rep.jacket_size,
      tshirt_size: rep.tshirt_size,
      date_of_birth_present: rep.date_of_birth !== null,
      contact_present: rep.phone !== null || rep.email !== null,
      address_present: rep.address_street !== null || rep.address_postal !== null,
      sin_present: rep.sin_ciphertext !== null,
    };
  }
}
