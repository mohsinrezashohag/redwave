/**
 * ImportService — the generic STAGE → RECONCILE → COMMIT pipeline. Nothing is written to live tables
 * until a fully reconciled batch is committed, and the COMMIT is ONE `prisma.$transaction` (atomic,
 * idempotent — #8) exactly like Pay Run finalize. File upload is stubbed (rows fed in the request);
 * the parse/mapping/matching logic is real (pure modules). Drives Sales' `validateWithinTx` for bulk
 * validation; writes back-dated rates (#10) and opening holdback balances (IMP-007) directly via the
 * transaction. Owns import_batches / import_rows / import_field_mappings. — SRS §15, arch §6.11
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ImportSourceType,
  ImportType,
  MatchStatus,
  Prisma,
} from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { SalesService } from '../sales/sales.service';
import { NOTIFICATION_EMITTER, NotificationEmitter } from '../../common/notifications/notification-emitter';
import { applyMapping, RawRow } from './mapping.logic';
import {
  Classification,
  classifyHoldbackRow,
  classifyRateRow,
  classifySalesRow,
} from './matching.logic';
import { evaluateGate } from './reconcile-gate.logic';
import { applyBulkValidation } from './handlers/bulk-validation.handler';
import { applyBillingRate } from './handlers/billing-rate.handler';
import { applyHoldback } from './handlers/holdback.handler';
import { CreateImportDto } from './dto/create-import.dto';
import { ReconcileAction, ReconcileDto } from './dto/reconcile.dto';
import { ListImportsQuery } from './dto/list-imports.query';

type Kind = 'bulk_validation' | 'billing_rate' | 'opening_holdback';
const str = (row: RawRow, key: string): string | null => {
  const v = row[key];
  return v === undefined || v === null || v === '' ? null : String(v);
};

/** The only source_type × import_type pairings supported this session (others → 422). */
function pairingKind(source: ImportSourceType, type: ImportType): Kind | null {
  if (source === 'client_report' && type === 'sales') return 'bulk_validation';
  if (source === 'master_migration' && type === 'clients') return 'billing_rate';
  if (source === 'balance_migration' && type === 'holdback') return 'opening_holdback';
  return null;
}

const BATCH_INCLUDE = { import_rows: { orderBy: { row_number: 'asc' } } } as const;

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sales: SalesService,
    @Inject(NOTIFICATION_EMITTER) private readonly emitter: NotificationEmitter,
  ) {}

  // ── Stage ───────────────────────────────────────────────────────────────────────
  async stage(dto: CreateImportDto, user: AuthUser) {
    const kind = pairingKind(dto.source_type, dto.import_type);
    if (!kind) {
      throw new UnprocessableEntityException(
        `unsupported import: ${dto.source_type} + ${dto.import_type} (historical sales load & mixed are deferred)`,
      );
    }
    if (kind === 'bulk_validation' && !dto.client_id) {
      throw new UnprocessableEntityException('client_id is required for a client_report import');
    }

    const mappingJson = await this.loadMapping(dto.field_mapping_id, dto.source_type);
    const mappedRows = dto.rows.map((raw) => applyMapping(raw, mappingJson));
    const classifications = await this.classifyAll(kind, mappedRows, dto.client_id ?? null);

    const matched = classifications.filter((c) => c.match_status === 'matched').length;
    const errors = classifications.filter((c) => c.match_status === 'error').length;
    const summary = this.summarise(classifications);

    const batch = await this.prisma.importBatch.create({
      data: {
        source_file_url: `s3://redwave-imports/${dto.source_type}.xlsx`, // stub (real upload deferred)
        source_type: dto.source_type,
        import_type: dto.import_type,
        client_id: dto.client_id ?? null,
        field_mapping_id: dto.field_mapping_id ?? null,
        status: 'staged',
        total_rows: dto.rows.length,
        matched_rows: matched,
        error_rows: errors,
        reconcile_total: dto.reconcile_total ?? null, // operator-provided source total (IMP-007)
        error_summary: summary,
        run_by: user.id,
        import_rows: {
          create: dto.rows.map((raw, i) => ({
            row_number: i + 1,
            raw_data: raw as Prisma.InputJsonValue,
            mapped_data: mappedRows[i] as Prisma.InputJsonValue,
            match_status: classifications[i].match_status,
            matched_entity_id: classifications[i].matched_entity_id ?? null,
            issue: classifications[i].issue,
          })),
        },
      },
      include: BATCH_INCLUDE,
    });

    await this.audit.log({
      actorId: user.id,
      entityType: 'import_batches',
      entityId: batch.id,
      action: 'create',
      after: { source_type: dto.source_type, import_type: dto.import_type, ...summary },
    });
    return batch;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────────────
  list(query: ListImportsQuery) {
    return this.prisma.importBatch.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.source_type ? { source_type: query.source_type } : {}),
        ...(query.import_type ? { import_type: query.import_type } : {}),
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id }, include: BATCH_INCLUDE });
    if (!batch) {
      throw new NotFoundException('Import batch not found');
    }
    return batch;
  }

  // ── Reconcile ───────────────────────────────────────────────────────────────────────
  async reconcile(id: string, dto: ReconcileDto, user: AuthUser) {
    const batch = await this.findOne(id);
    if (batch.status !== 'staged') {
      throw new ConflictException('only a staged batch can be reconciled');
    }
    const rowsById = new Map(batch.import_rows.map((r) => [r.id, r]));

    await this.prisma.$transaction(async (tx) => {
      for (const res of dto.resolutions) {
        const row = rowsById.get(res.row_id);
        if (!row) {
          throw new UnprocessableEntityException(`row ${res.row_id} is not in this batch`);
        }
        if (res.action === ReconcileAction.ignore) {
          await tx.importRow.update({
            where: { id: row.id },
            data: { match_status: 'ignored', resolved_by: user.id },
          });
        } else if (res.action === ReconcileAction.match) {
          if (!res.matched_entity_id) {
            throw new UnprocessableEntityException("action 'match' requires matched_entity_id");
          }
          await tx.importRow.update({
            where: { id: row.id },
            data: {
              match_status: 'matched',
              matched_entity_id: res.matched_entity_id,
              issue: null,
              resolved_by: user.id,
            },
          });
        } else {
          // edit: replace mapped_data and re-classify this single row against fresh context.
          const mapped = (res.mapped_data ?? (row.mapped_data as RawRow)) as RawRow;
          const [c] = await this.classifyAll(
            pairingKind(batch.source_type, batch.import_type)!,
            [mapped],
            batch.client_id,
          );
          await tx.importRow.update({
            where: { id: row.id },
            data: {
              mapped_data: mapped as Prisma.InputJsonValue,
              match_status: c.match_status,
              matched_entity_id: c.matched_entity_id ?? null,
              issue: c.issue,
              resolved_by: user.id,
            },
          });
        }
      }
      await this.recountBatch(tx, id);
    });

    const updated = await this.findOne(id);
    await this.audit.log({
      actorId: user.id,
      entityType: 'import_batches',
      entityId: id,
      action: 'reconcile',
      after: { resolutions: dto.resolutions.length, ...this.summarise(updated.import_rows) },
    });
    return updated;
  }

  // ── Commit (atomic + idempotent — #8) ──────────────────────────────────────────────
  async commit(id: string, user: AuthUser) {
    const batch = await this.findOne(id);
    if (batch.status === 'committed') {
      return batch; // STATE-BASED IDEMPOTENCY — re-committing is a no-op (no double-apply). (#8)
    }
    if (batch.status !== 'staged') {
      throw new ConflictException(`cannot commit a ${batch.status} batch`);
    }

    // RECONCILE-BEFORE-COMMIT GATE — block while any row is unresolved; balance migrations must
    // also reconcile to the operator's source total (IMP-007).
    const financial =
      batch.import_type === 'holdback'
        ? {
            reconcileTotal: batch.reconcile_total ? new Decimal(batch.reconcile_total.toString()) : null,
            stagedSum: this.sumMatchedAmounts(batch.import_rows, 'amount_held'),
          }
        : undefined;
    const gate = evaluateGate(batch.import_rows, financial);
    if (!gate.ok) {
      throw new UnprocessableEntityException(gate.reason);
    }

    const kind = pairingKind(batch.source_type, batch.import_type)!;
    const commitCtx = await this.buildCommitContext(kind);

    // ATOMIC: every row applied in ONE transaction — any throw rolls the entire batch back (#8).
    await this.prisma.$transaction(async (tx) => {
      for (const row of batch.import_rows) {
        if (row.match_status !== 'matched') continue; // ignored rows are skipped
        const mapped = row.mapped_data as RawRow;
        let entityId: string;
        if (kind === 'bulk_validation') {
          entityId = await applyBulkValidation(tx, row.matched_entity_id!, user, this.sales);
        } else if (kind === 'billing_rate') {
          entityId = await applyBillingRate(tx, mapped, user.id);
        } else {
          const originId = String(mapped.origin_pay_period_id);
          const originPeriod = commitCtx.periodsById.get(originId)!;
          entityId = await applyHoldback(tx, mapped, {
            originPeriod,
            allPeriods: commitCtx.allPeriods,
            releaseRule: commitCtx.releaseRule,
          });
        }
        if (row.matched_entity_id !== entityId) {
          await tx.importRow.update({ where: { id: row.id }, data: { matched_entity_id: entityId } });
        }
      }
      await tx.importBatch.update({
        where: { id },
        data: { status: 'committed', committed_at: new Date() },
      });
    });

    const committed = await this.findOne(id);
    await this.audit.log({
      actorId: user.id,
      entityType: 'import_batches',
      entityId: id,
      action: 'commit',
      after: { import_type: batch.import_type, applied: batch.matched_rows },
    });
    // Best-effort: notify Admins/Super Admins (the importer is import:approve → already in these roles). — import_committed
    const importEvent = {
      eventType: 'import_committed' as const,
      title: 'Import committed',
      body: `An ${batch.import_type} import was committed (${batch.matched_rows} rows).`,
      relatedEntityType: 'import_batches',
      relatedEntityId: id,
      variables: { import_type: batch.import_type, committed_count: String(batch.matched_rows) },
    };
    await this.emitter.emitRole('Admin', importEvent);
    await this.emitter.emitRole('Super Admin', importEvent);
    return committed;
  }

  // ── internals ─────────────────────────────────────────────────────────────────────
  private async loadMapping(
    fieldMappingId: string | undefined,
    sourceType: ImportSourceType,
  ): Promise<unknown> {
    if (!fieldMappingId) {
      return null; // identity mapping — rows already in system-field shape
    }
    const mapping = await this.prisma.importFieldMapping.findUnique({ where: { id: fieldMappingId } });
    if (!mapping) {
      throw new NotFoundException('Field mapping not found');
    }
    if (mapping.source_type !== sourceType) {
      throw new BadRequestException('field mapping source_type does not match the batch');
    }
    return mapping.mapping_json;
  }

  /** Classify every mapped row for the batch kind, pre-fetching the DB context each classifier needs. */
  private async classifyAll(
    kind: Kind,
    mappedRows: RawRow[],
    clientId: string | null,
  ): Promise<Classification[]> {
    if (kind === 'bulk_validation') {
      return this.classifySales(mappedRows, clientId);
    }
    if (kind === 'billing_rate') {
      return this.classifyRates(mappedRows);
    }
    return this.classifyHoldbacks(mappedRows);
  }

  private async classifySales(mappedRows: RawRow[], clientId: string | null): Promise<Classification[]> {
    const mpus = [...new Set(mappedRows.map((r) => str(r, 'mpu_id')).filter((v): v is string => !!v))];
    const entered = mpus.length
      ? await this.prisma.sale.findMany({
          where: { client_id: clientId ?? undefined, status: 'entered', mpu_id: { in: mpus } },
          select: { id: true, mpu_id: true },
        })
      : [];
    const byMpu = new Map<string, string[]>();
    for (const s of entered) {
      if (!s.mpu_id) continue;
      const bucket = byMpu.get(s.mpu_id);
      if (bucket) bucket.push(s.id);
      else byMpu.set(s.mpu_id, [s.id]);
    }
    return mappedRows.map((r) => {
      const mpu = str(r, 'mpu_id');
      return classifySalesRow(r, { matchedSaleIds: mpu ? (byMpu.get(mpu) ?? []) : [] });
    });
  }

  private async classifyRates(mappedRows: RawRow[]): Promise<Classification[]> {
    const clientIds = [...new Set(mappedRows.map((r) => str(r, 'client_id')).filter((v): v is string => !!v))];
    const productIds = [...new Set(mappedRows.map((r) => str(r, 'product_id')).filter((v): v is string => !!v))];
    const clients = new Set(
      (await this.prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true } })).map((c) => c.id),
    );
    const products = new Map(
      (await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, client_id: true } })).map(
        (p) => [p.id, p.client_id],
      ),
    );
    return mappedRows.map((r) => {
      const base = classifyRateRow(r);
      if (base.match_status !== 'matched') return base;
      const clientId = str(r, 'client_id')!;
      if (!clients.has(clientId)) return { match_status: 'error', issue: 'client not found' };
      const productId = str(r, 'product_id');
      if (productId && products.get(productId) !== clientId) {
        return { match_status: 'error', issue: 'product not found or not owned by this client' };
      }
      return base;
    });
  }

  private async classifyHoldbacks(mappedRows: RawRow[]): Promise<Classification[]> {
    const repIds = [...new Set(mappedRows.map((r) => str(r, 'rep_id')).filter((v): v is string => !!v))];
    const periodIds = [...new Set(mappedRows.map((r) => str(r, 'origin_pay_period_id')).filter((v): v is string => !!v))];
    const reps = new Set(
      (await this.prisma.rep.findMany({ where: { id: { in: repIds } }, select: { id: true } })).map((r) => r.id),
    );
    const periods = new Map(
      (await this.prisma.payPeriod.findMany({ where: { id: { in: periodIds } }, select: { id: true, status: true } })).map(
        (p) => [p.id, p.status],
      ),
    );
    const existing = new Set(
      (
        await this.prisma.holdbackLedger.findMany({
          where: { rep_id: { in: repIds }, origin_pay_period_id: { in: periodIds } },
          select: { rep_id: true, origin_pay_period_id: true },
        })
      ).map((h) => `${h.rep_id}|${h.origin_pay_period_id}`),
    );
    return mappedRows.map((r) => {
      const repId = str(r, 'rep_id');
      const origin = str(r, 'origin_pay_period_id');
      return classifyHoldbackRow(r, {
        repExists: repId ? reps.has(repId) : false,
        originPeriodStatus: origin ? (periods.get(origin) ?? null) : null,
        ledgerExists: repId && origin ? existing.has(`${repId}|${origin}`) : false,
      });
    });
  }

  private async buildCommitContext(kind: Kind) {
    if (kind !== 'opening_holdback') {
      return { allPeriods: [], periodsById: new Map(), releaseRule: '' };
    }
    const allPeriods = await this.prisma.payPeriod.findMany({
      select: { id: true, start_date: true, payday: true },
    });
    const setting = await this.prisma.holdbackReleaseSetting.findFirst({ orderBy: { effective_from: 'desc' } });
    return {
      allPeriods,
      periodsById: new Map(allPeriods.map((p) => [p.id, p])),
      releaseRule: setting?.release_rule ?? 'next_cycle_after_30_days',
    };
  }

  private sumMatchedAmounts(rows: { match_status: MatchStatus; mapped_data: Prisma.JsonValue }[], key: string): Decimal {
    return rows
      .filter((r) => r.match_status === 'matched')
      .reduce((sum, r) => {
        const v = str(r.mapped_data as RawRow, key);
        return v ? sum.plus(new Decimal(v)) : sum;
      }, new Decimal(0));
  }

  private async recountBatch(tx: Prisma.TransactionClient, id: string): Promise<void> {
    const rows = await tx.importRow.findMany({ where: { import_batch_id: id }, select: { match_status: true } });
    await tx.importBatch.update({
      where: { id },
      data: {
        matched_rows: rows.filter((r) => r.match_status === 'matched').length,
        error_rows: rows.filter((r) => r.match_status === 'error').length,
        error_summary: this.summarise(rows),
      },
    });
  }

  private summarise(rows: { match_status: MatchStatus }[]): Record<string, number> {
    const counts: Record<string, number> = { matched: 0, unmatched: 0, duplicate: 0, error: 0, ignored: 0 };
    for (const r of rows) counts[r.match_status] += 1;
    return counts;
  }
}
