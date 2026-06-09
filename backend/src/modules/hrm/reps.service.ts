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
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, Rep, RepStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { permissionKey } from '../../common/rbac/permissions.util';
import { BUILTIN_ROLES } from '../../common/rbac/rbac.constants';
import { buildPage, resolveOrderBy, toSkipTake } from '../../common/pagination/paginate';
import { CreateRepDto, ListRepsQuery, UpdateRepDto } from './dto/rep.dto';

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

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class RepsService {
  /** Columns a client may sort the list on (allowlist — the orderBy-injection guard). */
  private static readonly SORTABLE = ['rep_code', 'full_name', 'status', 'hire_date', 'created_at'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
      reps.map((rep) => redactRep(rep, canSee)),
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
    return redactRep(rep, canSeeSensitive(user));
  }

  async create(dto: CreateRepDto, actorId: string) {
    // #11 — reject reuse of ANY existing code (active or terminated), case-insensitively.
    const existing = await this.prisma.rep.findFirst({
      where: { rep_code: { equals: dto.rep_code, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'rep_code already used — codes are never reused, including terminated reps',
      );
    }

    await this.assertValidFieldManager(dto.field_manager_id);

    try {
      const rep = await this.prisma.rep.create({
        data: {
          rep_code: dto.rep_code,
          full_name: dto.full_name,
          field_manager_id: dto.field_manager_id,
          hire_date: dateOnly(dto.hire_date),
          status: 'active',
          user_id: dto.user_id ?? null,
          payment_details:
            dto.payment_details === undefined
              ? undefined
              : (dto.payment_details as Prisma.InputJsonValue),
        },
      });
      await this.audit.log({
        actorId,
        entityType: 'reps',
        entityId: rep.id,
        action: 'create',
        after: this.auditView(rep),
      });
      return rep;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('rep_code already used'); // DB backstop for #11
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateRepDto, actorId: string) {
    const before = await this.prisma.rep.findUnique({ where: { id } });
    if (!before) {
      throw new NotFoundException('Rep not found');
    }

    if (dto.field_manager_id && dto.field_manager_id !== before.field_manager_id) {
      await this.assertValidFieldManager(dto.field_manager_id);
    }

    const data: Prisma.RepUncheckedUpdateInput = {};
    if (dto.full_name !== undefined) data.full_name = dto.full_name;
    if (dto.field_manager_id !== undefined) data.field_manager_id = dto.field_manager_id;
    if (dto.hire_date !== undefined) data.hire_date = dateOnly(dto.hire_date);
    if (dto.user_id !== undefined) data.user_id = dto.user_id ?? null;
    if (dto.payment_details !== undefined)
      data.payment_details = dto.payment_details as Prisma.InputJsonValue;

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
    return updated;
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
      full_name: rep.full_name,
      field_manager_id: rep.field_manager_id,
      status: rep.status,
      termination_date: rep.termination_date
        ? rep.termination_date.toISOString().slice(0, 10)
        : null,
      payment_details_present: rep.payment_details !== null,
    };
  }
}
