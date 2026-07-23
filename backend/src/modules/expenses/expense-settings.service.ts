/**
 * ExpenseSettingsService — the singleton org-level expense policy.
 *
 * Today it holds the OFFICE ADDRESS a km trip runs from. Redwave's policy is that a day's driving starts
 * (and, on a round trip, ends) at the office, so the km form DEFAULTS its first stop to this address rather
 * than leaving the rep to retype it — and mistype it — every day. It is a DEFAULT, not a constraint: the rep
 * can replace the stop for a trip that genuinely started elsewhere.
 *
 * All fields are nullable: a deployment that has not set an office simply gets no default. — SRS EXP-004
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { UpdateExpenseSettingsDto } from './dto/expense-settings.dto';

@Injectable()
export class ExpenseSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The one settings row (created lazily, empty). */
  private async ensureRow() {
    const existing = await this.prisma.expenseSetting.findFirst();
    return existing ?? this.prisma.expenseSetting.create({ data: {} });
  }

  async get() {
    const row = await this.ensureRow();
    return {
      office_address: row.office_address,
      office_lat: row.office_lat?.toString() ?? null,
      office_lng: row.office_lng?.toString() ?? null,
      updated_at: row.updated_at,
    };
  }

  async update(dto: UpdateExpenseSettingsDto, actorId: string) {
    const row = await this.ensureRow();
    const before = { office_address: row.office_address };
    // Clearing the address clears its coordinates too — a lat/lng with no address is not a usable stop.
    const clearing = dto.office_address !== undefined && !dto.office_address;
    await this.prisma.expenseSetting.update({
      where: { id: row.id },
      data: {
        ...(dto.office_address !== undefined ? { office_address: dto.office_address || null } : {}),
        ...(clearing
          ? { office_lat: null, office_lng: null }
          : {
              ...(dto.office_lat !== undefined ? { office_lat: dto.office_lat || null } : {}),
              ...(dto.office_lng !== undefined ? { office_lng: dto.office_lng || null } : {}),
            }),
        updated_by: actorId,
      },
    });
    const after = await this.get();
    await this.audit.log({
      actorId,
      entityType: 'expense_settings',
      entityId: row.id,
      action: 'update',
      before,
      after: { office_address: after.office_address },
    });
    return after;
  }
}
