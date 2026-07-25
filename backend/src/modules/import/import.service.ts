/**
 * ImportService — the generic STAGE → RECONCILE → COMMIT pipeline. A real Excel/CSV file is uploaded,
 * parsed (ParserService), auto-mapped (suggestMapping) + cleaned (cleanMappedRow), classified, and staged;
 * nothing touches live tables until a fully reconciled batch is committed, and the COMMIT is ONE
 * `prisma.$transaction` (atomic, idempotent — #8) exactly like Pay Run finalize. Drives Sales'
 * `validateWithinTx` for bulk validation; writes back-dated rates (#10), opening holdback (IMP-007), and
 * the go-live master/HISTORICAL data directly via the transaction. Owns import_batches / import_rows /
 * import_field_mappings. — SRS §15, arch §6.11
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ImportSourceType, ImportType, MatchStatus, Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { StorageService, UploadedFile } from '../../common/storage/storage.service';
import { SalesService } from '../sales/sales.service';
import { NOTIFICATION_EMITTER, NotificationEmitter } from '../../common/notifications/notification-emitter';
import { applyMapping, RawRow } from './mapping.logic';
import { cleanMappedRow } from './clean.logic';
import { suggestMapping } from './suggest-mapping.logic';
import { fieldTypesFor, TARGET_FIELDS, targetKey } from './target-fields';
import { ParserService } from './parsing/parser.service';
import {
  Classification,
  classifyBillingRateRow,
  classifyClientRow,
  classifyHistoricalSaleRow,
  classifyHoldbackRow,
  classifyLiveSaleRow,
  classifyProductRow,
  classifyRepRow,
  classifySalesRow,
} from './matching.logic';
import {
  buildProductTypeVocab,
  MARKET_VOCAB,
  RATE_KIND_VOCAB,
  REP_STATUS_VOCAB,
  resolveSingle,
  resolveVocabValue,
  SALE_STATUS_VOCAB,
  Vocab,
  VocabResolution,
} from './value-vocabulary.logic';
import { detectProductTypeColumns, ProductTypeColumn, resolveRowProductTypes } from './product-columns.logic';
import { CandidateSale, matchReportRow } from './sale-matching.logic';
import { groupIssues, summariseIssues } from './group-issues.logic';
import { evaluateGate } from './reconcile-gate.logic';
import { applyBulkValidation } from './handlers/bulk-validation.handler';
import { applyLiveSale } from './handlers/live-sales.handler';
import { applyBillingRate } from './handlers/billing-rate.handler';
import { applyHoldback } from './handlers/holdback.handler';
import { applyClient, applyHistoricalSale, applyProduct, applyRep } from './handlers/master.handlers';
import { CreateImportDto } from './dto/create-import.dto';
import { ReconcileAction, ReconcileDto } from './dto/reconcile.dto';
import { RemapDto } from './dto/remap.dto';
import { ListImportsQuery } from './dto/list-imports.query';

type Kind =
  | 'bulk_validation'
  | 'bulk_sales'
  | 'historical_sales'
  | 'create_clients'
  | 'create_products'
  | 'billing_rate'
  | 'create_reps'
  | 'opening_holdback';

const str = (row: RawRow, key: string): string | null => {
  const v = row[key];
  return v === undefined || v === null || v === '' ? null : String(v);
};
const up = (s: string | null): string => (s ?? '').toUpperCase();
const uniqCodes = (rows: RawRow[], key: string): string[] => [
  ...new Set(rows.map((r) => str(r, key)).filter((v): v is string => !!v)),
];
/**
 * A stored DATE column back to 'YYYY-MM-DD' (they are UTC-midnight, so the UTC day IS the real day, #7).
 * Tolerates a missing value: a sale with no usable date simply can't corroborate a match on one.
 */
const isoDate = (d: Date | null | undefined): string | null => (d instanceof Date ? d.toISOString().slice(0, 10) : null);

/**
 * Saved mappings are keyed by SYSTEM FIELD, so renaming the historical target's `product_type` to
 * `product_types` would leave an existing saved mapping silently pointing at a field nobody reads — the
 * column would just vanish. Rename the key on load (only when the new one is absent, so an updated mapping
 * always wins). Remove once no `master_migration` mapping predates the rename.
 */
export function migrateLegacyMappingKeys(mappingJson: unknown): unknown {
  if (!mappingJson || typeof mappingJson !== 'object') return mappingJson;
  const mapping = { ...(mappingJson as Record<string, string>) };
  if (mapping.product_type && !mapping.product_types) {
    mapping.product_types = mapping.product_type;
    delete mapping.product_type;
  }
  return mapping;
}

/**
 * Resolve a row's `product_types` cell against the catalogue vocabulary and WRITE THE CANONICAL KEYS BACK
 * into the mapped row. Normalising into the staged data (rather than re-resolving at commit) means the
 * operator sees canonical keys in the reconcile UI, and the commit handlers can do a plain comma-split —
 * so the resolution rule lives in exactly one place and cannot disagree with itself between stage and
 * commit. A row whose types don't resolve is left untouched; the classifier turns it into an `error`.
 */
function canonicaliseProductTypes(row: RawRow, vocab: Vocab, ctx?: ProductTypeContext): VocabResolution {
  const resolved = ctx
    ? resolveRowProductTypes(ctx.rawByRow.get(row) ?? {}, str(row, 'product_types'), ctx.typeColumns, vocab)
    : resolveVocabValue(str(row, 'product_types'), vocab);
  if (resolved.keys.length > 0 && resolved.unknown.length === 0) {
    row.product_types = resolved.keys.join(',');
  }
  return resolved;
}

/**
 * Lets a classifier reach the row's ORIGINAL cells, which is where the per-type flag columns live — the
 * mapped row only carries the system fields. Keyed by the mapped row object so the pairing cannot drift.
 */
interface ProductTypeContext {
  typeColumns: ProductTypeColumn[];
  rawByRow: Map<RawRow, RawRow>;
}

/**
 * The same write-back for a SINGLE-valued column (`market`, `rate_kind`, `status`, a product's
 * `product_type`). Returns the offending text when it doesn't resolve, so the classifier can say so; an
 * empty cell resolves to nothing and is left for the classifier's required-ness check.
 */
function canonicaliseSingle(row: RawRow, field: string, vocab: Vocab): string | null {
  const { key, unknown } = resolveSingle(str(row, field), vocab);
  if (key !== null) {
    row[field] = key;
  }
  return unknown;
}

/** Supported source_type × import_type pairings → the internal target kind (others → 422). */
function pairingKind(source: ImportSourceType, type: ImportType): Kind | null {
  if (source === 'client_report' && type === 'sales') return 'bulk_validation';
  if (source === 'sales_entry' && type === 'sales') return 'bulk_sales'; // LIVE sales (IMP-013)
  if (source === 'master_migration' && type === 'sales') return 'historical_sales';
  if (source === 'master_migration' && type === 'clients') return 'create_clients';
  if (source === 'master_migration' && type === 'products') return 'create_products';
  if (source === 'master_migration' && type === 'billing_rates') return 'billing_rate';
  if (source === 'master_migration' && type === 'reps') return 'create_reps';
  if (source === 'balance_migration' && type === 'holdback') return 'opening_holdback';
  return null;
}

const BATCH_INCLUDE = { import_rows: { orderBy: { row_number: 'asc' } } } as const;

/** How many cleaned+classified rows the dry run returns. Enough to eyeball; not a second copy of the file. */
const PREVIEW_SAMPLE_ROWS = 10;

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sales: SalesService,
    private readonly parser: ParserService,
    private readonly storage: StorageService,
    @Inject(NOTIFICATION_EMITTER) private readonly emitter: NotificationEmitter,
  ) {}

  /**
   * parse → map → clean → classify. The ONE path shared by `preview` and `stage`, extracted so a dry run
   * can never disagree with what staging actually produces. It performs NO writes.
   */
  private async analyze(file: UploadedFile, dto: CreateImportDto) {
    const kind = pairingKind(dto.source_type, dto.import_type);
    if (!kind) {
      throw new UnprocessableEntityException(`unsupported import: ${dto.source_type} + ${dto.import_type}`);
    }
    if (kind === 'bulk_validation' && !dto.client_id) {
      throw new UnprocessableEntityException('client_id is required for a client_report import');
    }
    // Auto-creating referenced master data is a MIGRATION affordance for reference-only history. On live
    // sales an invented rep or product would flow straight into the tier tally and the pay run (#5), so it
    // is refused outright rather than quietly ignored.
    if (dto.create_missing && kind !== 'historical_sales') {
      throw new UnprocessableEntityException(
        'create_missing is only supported for historical sales (master_migration + sales) — every other target requires the referenced records to already exist',
      );
    }

    const fields = TARGET_FIELDS[targetKey(dto.source_type, dto.import_type)] ?? [];
    // The target's own fields score sheet + header-row selection, so an Instructions tab or a title
    // banner doesn't become the header row.
    const parsed = await this.parser.parse(file, { sheet: dto.sheet, expectedFields: fields });
    const saved = await this.loadMapping(dto.field_mapping_id, dto.source_type);
    const mapping = (saved as Record<string, string> | null) ?? suggestMapping(parsed.headers, fields);
    const types = fieldTypesFor(dto.source_type, dto.import_type);

    const rawRows = parsed.rows;
    const mappedRows = rawRows.map((raw) => cleanMappedRow(applyMapping(raw, mapping), types));

    // The real working files give each product type its own yes/no column rather than listing them in one
    // cell, so a sales target also reads that layout. Columns already claimed by another system field are
    // excluded, and an explicit product-types cell still wins per row.
    const wantsProductTypes = fields.some((f) => f.field === 'product_types');
    const typeColumns = wantsProductTypes
      ? detectProductTypeColumns(parsed.headers, await this.productTypeVocab(), Object.values(mapping))
      : [];
    const productTypeCtx: ProductTypeContext | undefined =
      typeColumns.length > 0 ? { typeColumns, rawByRow: new Map(mappedRows.map((m, i) => [m, rawRows[i]])) } : undefined;

    const classifications = await this.classifyAll(kind, mappedRows, dto.client_id ?? null, dto.create_missing ?? false, productTypeCtx);
    return { kind, fields, parsed, mapping, rawRows, mappedRows, classifications, typeColumns };
  }

  /**
   * DRY RUN (IMP-003). Shows the operator what staging WOULD produce — chosen sheet, detected header row,
   * the mapping, the required fields that found no column, a sample of classified rows, and the grouped
   * blockers — WITHOUT creating a batch or storing the file. Nothing here writes.
   */
  async preview(file: UploadedFile, dto: CreateImportDto) {
    const { kind, fields, parsed, mapping, mappedRows, classifications, typeColumns } = await this.analyze(file, dto);

    const rows = classifications.map((c, i) => ({
      row_number: i + 1,
      match_status: c.match_status,
      issue: c.issue,
    }));
    // Always computed for historical sales — with the flag ON it says what WILL be created, and with it OFF
    // it tells the operator what turning it on would do, instead of leaving them to decode N error rows.
    const willCreate = kind === 'historical_sales' ? await this.historicalCreationPlan(mappedRows) : { clients: [], reps: [], products: [] };
    return {
      create_missing: dto.create_missing ?? false,
      will_create: willCreate,
      // Empty unless the file uses the column-per-type layout — the operator should see that a row's
      // products were read from yes/no columns rather than a list cell.
      product_type_columns: typeColumns,
      sheet: parsed.sheet,
      sheets: parsed.sheets,
      header_row: parsed.headerRow,
      headers: parsed.headers,
      mapping,
      /** Required system fields no column mapped to — the file is unusable until these are resolved. */
      unmapped_required: fields.filter((f) => f.required && !mapping[f.field]).map((f) => f.field),
      total_rows: mappedRows.length,
      counts: this.summarise(rows),
      issue_groups: groupIssues(rows),
      /** A small slice so the operator can eyeball the cleaning before committing to a batch. */
      sample: mappedRows.slice(0, PREVIEW_SAMPLE_ROWS).map((mapped, i) => ({
        row_number: i + 1,
        match_status: classifications[i].match_status,
        issue: classifications[i].issue,
        mapped_data: mapped,
      })),
    };
  }

  // ── Stage (real file → parse → map → clean → classify → stage) ──────────────────────
  async stage(file: UploadedFile, dto: CreateImportDto, user: AuthUser) {
    const { parsed, mapping, rawRows, mappedRows, classifications } = await this.analyze(file, dto);

    const stored = await this.storage.upload('imports', file); // real source file (or local:// fallback)
    const batch = await this.prisma.importBatch.create({
      data: {
        source_file_url: stored.path,
        source_type: dto.source_type,
        import_type: dto.import_type,
        client_id: dto.client_id ?? null,
        field_mapping_id: dto.field_mapping_id ?? null,
        status: 'staged',
        total_rows: rawRows.length,
        matched_rows: classifications.filter((c) => c.match_status === 'matched').length,
        error_rows: classifications.filter((c) => c.match_status === 'error').length,
        reconcile_total: dto.reconcile_total ?? null,
        // Persisted because remap + a reconcile edit re-classify: without it those re-runs would judge the
        // rows under the opposite rule and flip them back to `error`.
        create_missing: dto.create_missing ?? false,
        // Persisted so the detail screen can show what was ACTUALLY applied instead of re-guessing.
        applied_mapping: mapping as Prisma.InputJsonValue,
        error_summary: this.summariseWithGroups(
          classifications.map((c, i) => ({ row_number: i + 1, match_status: c.match_status, issue: c.issue })),
        ),
        run_by: user.id,
        import_rows: {
          create: rawRows.map((raw, i) => ({
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
      after: { source_type: dto.source_type, import_type: dto.import_type, ...this.summarise(classifications) },
    });
    // `source_headers` is transient (the FE offers them as mapping choices); `applied_mapping` is stored.
    return { ...batch, source_headers: parsed.headers };
  }

  // ── Remap (re-apply a new mapping to the stored raw_data — no re-upload) ─────────────
  async remap(id: string, dto: RemapDto, user: AuthUser) {
    const batch = await this.findOne(id);
    if (batch.status !== 'staged') {
      throw new ConflictException('only a staged batch can be remapped');
    }
    const kind = pairingKind(batch.source_type, batch.import_type)!;
    const types = fieldTypesFor(batch.source_type, batch.import_type);
    const mappedRows = batch.import_rows.map((r) => cleanMappedRow(applyMapping(r.raw_data as RawRow, dto.mapping_json), types));
    const classifications = await this.classifyAll(kind, mappedRows, batch.client_id, batch.create_missing);

    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < batch.import_rows.length; i++) {
        const row = batch.import_rows[i];
        const c = classifications[i];
        await tx.importRow.update({
          where: { id: row.id },
          data: {
            mapped_data: mappedRows[i] as Prisma.InputJsonValue,
            match_status: c.match_status,
            matched_entity_id: c.matched_entity_id ?? null,
            issue: c.issue,
          },
        });
      }
      // The new mapping IS the batch's mapping from here on — the detail screen reads it back.
      await tx.importBatch.update({ where: { id }, data: { applied_mapping: dto.mapping_json as Prisma.InputJsonValue } });
      await this.recountBatch(tx, id);
    });

    const updated = await this.findOne(id);
    await this.audit.log({ actorId: user.id, entityType: 'import_batches', entityId: id, action: 'reconcile', after: { remap: true, ...this.summarise(updated.import_rows) } });
    return updated;
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

  /** A CSV of the rows that still need attention (unmatched/duplicate/error) for hand-cleaning. */
  async errorReport(id: string): Promise<string> {
    const batch = await this.findOne(id);
    const rows = batch.import_rows.filter((r) => ['unmatched', 'duplicate', 'error'].includes(r.match_status));
    const header = ['row_number', 'match_status', 'issue', 'data'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const cells = [String(r.row_number), r.match_status, r.issue ?? '', JSON.stringify(r.mapped_data ?? r.raw_data)];
      lines.push(cells.map(csvCell).join(','));
    }
    return lines.join('\r\n');
  }

  // ── Reconcile ───────────────────────────────────────────────────────────────────────
  async reconcile(id: string, dto: ReconcileDto, user: AuthUser) {
    const batch = await this.findOne(id);
    if (batch.status !== 'staged') {
      throw new ConflictException('only a staged batch can be reconciled');
    }
    const rowsById = new Map(batch.import_rows.map((r) => [r.id, r]));
    const kind = pairingKind(batch.source_type, batch.import_type)!;
    const types = fieldTypesFor(batch.source_type, batch.import_type);

    await this.prisma.$transaction(async (tx) => {
      for (const res of dto.resolutions) {
        const row = rowsById.get(res.row_id);
        if (!row) {
          throw new UnprocessableEntityException(`row ${res.row_id} is not in this batch`);
        }
        if (res.action === ReconcileAction.ignore) {
          await tx.importRow.update({ where: { id: row.id }, data: { match_status: 'ignored', resolved_by: user.id } });
        } else if (res.action === ReconcileAction.match) {
          if (!res.matched_entity_id) {
            throw new UnprocessableEntityException("action 'match' requires matched_entity_id");
          }
          await tx.importRow.update({
            where: { id: row.id },
            data: { match_status: 'matched', matched_entity_id: res.matched_entity_id, issue: null, resolved_by: user.id },
          });
        } else {
          // edit: replace mapped_data, re-clean, and re-classify this single row against fresh context.
          const mapped = cleanMappedRow((res.mapped_data ?? (row.mapped_data as RawRow)) as RawRow, types);
          const [c] = await this.classifyAll(kind, [mapped], batch.client_id, batch.create_missing);
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
    const commitCtx = await this.buildCommitContext(kind, batch.create_missing);

    // ATOMIC: every matched row applied in ONE transaction — any throw rolls the entire batch back (#8).
    await this.prisma.$transaction(async (tx) => {
      for (const row of batch.import_rows) {
        if (row.match_status !== 'matched') continue; // ignored rows are skipped
        const mapped = row.mapped_data as RawRow;
        const entityId = await this.applyRow(tx, kind, row.matched_entity_id, mapped, user, id, commitCtx);
        if (row.matched_entity_id !== entityId) {
          await tx.importRow.update({ where: { id: row.id }, data: { matched_entity_id: entityId } });
        }
      }
      await tx.importBatch.update({ where: { id }, data: { status: 'committed', committed_at: new Date() } });
    });

    const committed = await this.findOne(id);
    await this.audit.log({
      actorId: user.id,
      entityType: 'import_batches',
      entityId: id,
      action: 'commit',
      after: { import_type: batch.import_type, ...this.summarise(committed.import_rows) },
    });
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

  /** Dispatch one matched row to its commit handler. */
  private async applyRow(
    tx: Prisma.TransactionClient,
    kind: Kind,
    matchedEntityId: string | null,
    mapped: RawRow,
    user: AuthUser,
    batchId: string,
    ctx: CommitContext,
  ): Promise<string> {
    switch (kind) {
      case 'bulk_validation':
        return applyBulkValidation(tx, matchedEntityId!, user, this.sales);
      case 'bulk_sales':
        return applyLiveSale(tx, mapped, user, this.sales, batchId);
      case 'billing_rate':
        return applyBillingRate(tx, mapped, user.id);
      case 'create_clients':
        return applyClient(tx, mapped);
      case 'create_products':
        return applyProduct(tx, mapped, user.id);
      case 'create_reps':
        return applyRep(tx, mapped, user.id);
      case 'historical_sales':
        return applyHistoricalSale(tx, mapped, batchId, ctx.behaviours, {
          createMissing: ctx.createMissing,
          importerUserId: user.id,
        });
      case 'opening_holdback': {
        const originId = String(mapped.origin_pay_period_id);
        const originPeriod = ctx.periodsById.get(originId)!;
        return applyHoldback(tx, mapped, { originPeriod, allPeriods: ctx.allPeriods, releaseRule: ctx.releaseRule });
      }
    }
  }

  // ── Saved field mappings (IMP-002) ──────────────────────────────────────────────────
  listMappings(query: { source_type?: ImportSourceType; client_id?: string }) {
    return this.prisma.importFieldMapping.findMany({
      where: { ...(query.source_type ? { source_type: query.source_type } : {}), ...(query.client_id ? { client_id: query.client_id } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  async createMapping(dto: { name: string; source_type: ImportSourceType; client_id?: string; mapping_json: Record<string, string> }, user: AuthUser) {
    const mapping = await this.prisma.importFieldMapping.create({
      data: { name: dto.name, source_type: dto.source_type, client_id: dto.client_id ?? null, mapping_json: dto.mapping_json, created_by: user.id },
    });
    await this.audit.log({ actorId: user.id, entityType: 'import_field_mappings', entityId: mapping.id, action: 'create', after: { name: dto.name, source_type: dto.source_type } });
    return mapping;
  }

  async updateMapping(id: string, dto: { name?: string; mapping_json?: Record<string, string> }, user: AuthUser) {
    await this.getMapping(id);
    const mapping = await this.prisma.importFieldMapping.update({
      where: { id },
      data: { ...(dto.name !== undefined ? { name: dto.name } : {}), ...(dto.mapping_json !== undefined ? { mapping_json: dto.mapping_json } : {}) },
    });
    await this.audit.log({ actorId: user.id, entityType: 'import_field_mappings', entityId: id, action: 'edit' });
    return mapping;
  }

  async removeMapping(id: string, user: AuthUser) {
    await this.getMapping(id);
    await this.prisma.importFieldMapping.delete({ where: { id } });
    await this.audit.log({ actorId: user.id, entityType: 'import_field_mappings', entityId: id, action: 'delete' });
    return { success: true };
  }

  private async getMapping(id: string) {
    const mapping = await this.prisma.importFieldMapping.findUnique({ where: { id } });
    if (!mapping) {
      throw new NotFoundException('Field mapping not found');
    }
    return mapping;
  }

  // ── internals ─────────────────────────────────────────────────────────────────────
  private async loadMapping(fieldMappingId: string | undefined, sourceType: ImportSourceType): Promise<unknown> {
    if (!fieldMappingId) return null;
    const mapping = await this.prisma.importFieldMapping.findUnique({ where: { id: fieldMappingId } });
    if (!mapping) {
      throw new NotFoundException('Field mapping not found');
    }
    if (mapping.source_type !== sourceType) {
      throw new BadRequestException('field mapping source_type does not match the batch');
    }
    return migrateLegacyMappingKeys(mapping.mapping_json);
  }

  /** Classify every mapped row for the batch kind, pre-fetching the DB context each classifier needs. */
  private async classifyAll(
    kind: Kind,
    mappedRows: RawRow[],
    clientId: string | null,
    createMissing = false,
    productTypeCtx?: ProductTypeContext,
  ): Promise<Classification[]> {
    switch (kind) {
      case 'bulk_validation':
        return this.classifySales(mappedRows, clientId);
      case 'billing_rate':
        return this.classifyBillingRates(mappedRows);
      case 'opening_holdback':
        return this.classifyHoldbacks(mappedRows);
      case 'create_clients':
        return this.classifyClients(mappedRows);
      case 'create_products':
        return this.classifyProducts(mappedRows);
      case 'create_reps':
        return this.classifyReps(mappedRows);
      case 'historical_sales':
        return this.classifyHistoricalSales(mappedRows, createMissing, productTypeCtx);
      case 'bulk_sales':
        return this.classifyLiveSales(mappedRows, productTypeCtx);
    }
  }

  /**
   * Rep ids by code — accepting EITHER the system `rep_code` (RW-D-0001) or the optional `external_code`
   * (the "Redwave20" style Redwave's own files use). Both are matched UPPER-cased, the same fold import
   * cleaning applies, so a file may mix the two schemes freely. `rep_code` remains the immutable business
   * key (#11); this is only a second way to look one up.
   */
  private async repsByAnyCode(codes: string[]): Promise<Map<string, string>> {
    if (codes.length === 0) return new Map();
    const upper = codes.map(up);
    const rows = await this.prisma.rep.findMany({
      where: { OR: [{ rep_code: { in: upper } }, { external_code: { in: upper } }] },
      select: { id: true, rep_code: true, external_code: true },
    });
    const byCode = new Map<string, string>();
    for (const rep of rows) {
      byCode.set(up(rep.rep_code), rep.id);
      if (rep.external_code) byCode.set(up(rep.external_code), rep.id);
    }
    return byCode;
  }

  private async clientsByCode(codes: string[]): Promise<Map<string, string>> {
    if (codes.length === 0) return new Map();
    const rows = await this.prisma.client.findMany({ where: { client_code: { in: codes } }, select: { id: true, client_code: true } });
    return new Map(rows.map((c) => [up(c.client_code), c.id]));
  }

  /**
   * Client report → entered sales. MPU ID is the partner's per-house identifier and remains the exact,
   * preferred key. But CTI/VF supply it and **RF Now does not** (SRS §84), so a row without one falls back
   * to matching on customer name + address + date. That fallback NEVER auto-validates on a guess — only an
   * unambiguous strong candidate matches; anything else comes back with candidates for the operator.
   */
  private async classifySales(mappedRows: RawRow[], clientId: string | null): Promise<Classification[]> {
    const mpus = uniqCodes(mappedRows, 'mpu_id');
    const byMpu = new Map<string, string[]>();
    if (mpus.length) {
      const entered = await this.prisma.sale.findMany({
        where: { client_id: clientId ?? undefined, status: 'entered', mpu_id: { in: mpus } },
        select: { id: true, mpu_id: true },
      });
      for (const s of entered) {
        if (!s.mpu_id) continue;
        (byMpu.get(s.mpu_id) ?? byMpu.set(s.mpu_id, []).get(s.mpu_id)!).push(s.id);
      }
    }

    // Load the client's open sales ONCE for the rows that have no MPU to match on.
    const needsFallback = mappedRows.some((r) => !str(r, 'mpu_id'));
    const openSales: CandidateSale[] = needsFallback
      ? (
          await this.prisma.sale.findMany({
            where: { client_id: clientId ?? undefined, status: 'entered' },
            select: { id: true, sale_code: true, customer_name: true, street: true, sale_date: true, activation_date: true },
            take: 2000,
          })
        ).map((s) => ({
          id: s.id,
          sale_code: s.sale_code,
          customer_name: s.customer_name,
          street: s.street,
          sale_date: isoDate(s.sale_date) ?? '',
          activation_date: isoDate(s.activation_date),
        }))
      : [];

    return mappedRows.map((r) => {
      const mpu = str(r, 'mpu_id');
      if (mpu) {
        return classifySalesRow(r, { matchedSaleIds: byMpu.get(mpu) ?? [] });
      }
      const outcome = matchReportRow(
        { customer_name: str(r, 'customer_name'), service_address: str(r, 'service_address'), activation_date: str(r, 'activation_date') },
        openSales,
      );
      if (outcome.matchedSaleId) {
        return { match_status: 'matched' as const, issue: null, matched_entity_id: outcome.matchedSaleId };
      }
      return { match_status: 'unmatched' as const, issue: outcome.issue };
    });
  }

  private async classifyClients(mappedRows: RawRow[]): Promise<Classification[]> {
    const byCode = await this.clientsByCode(uniqCodes(mappedRows, 'client_code'));
    return mappedRows.map((r) => {
      canonicaliseSingle(r, 'market', MARKET_VOCAB); // "Canada" → CA
      return classifyClientRow(r, { existingClientId: byCode.get(up(str(r, 'client_code'))) ?? null });
    });
  }

  private async classifyProducts(mappedRows: RawRow[]): Promise<Classification[]> {
    const byCode = await this.clientsByCode(uniqCodes(mappedRows, 'client_code'));
    const vocab = await this.productTypeVocab();
    const types = new Set(vocab.map((v) => v.key));
    return mappedRows.map((r) => {
      canonicaliseSingle(r, 'product_type', vocab); // "Internet" → internet
      return classifyProductRow(r, {
        clientExists: byCode.has(up(str(r, 'client_code'))),
        productTypeExists: types.has(str(r, 'product_type') ?? ''),
      });
    });
  }

  private async classifyBillingRates(mappedRows: RawRow[]): Promise<Classification[]> {
    const byCode = await this.clientsByCode(uniqCodes(mappedRows, 'client_code'));
    const names = uniqCodes(mappedRows, 'product_name');
    const clientIds = [...byCode.values()];
    const products =
      clientIds.length && names.length
        ? await this.prisma.product.findMany({ where: { client_id: { in: clientIds }, name: { in: names } }, select: { client_id: true, name: true } })
        : [];
    const prodKey = new Set(products.map((p) => `${p.client_id}|${p.name}`));
    return mappedRows.map((r) => {
      canonicaliseSingle(r, 'rate_kind', RATE_KIND_VOCAB); // "TV add-on" → tv_addon
      const cid = byCode.get(up(str(r, 'client_code')));
      const name = str(r, 'product_name');
      return classifyBillingRateRow(r, { clientExists: !!cid, productExists: !!(cid && name && prodKey.has(`${cid}|${name}`)) });
    });
  }

  private async classifyReps(mappedRows: RawRow[]): Promise<Classification[]> {
    const codes = uniqCodes(mappedRows, 'rep_code');
    const existing = new Set(
      (await this.prisma.rep.findMany({ where: { rep_code: { in: codes } }, select: { rep_code: true } })).map((r) => up(r.rep_code)),
    );
    return mappedRows.map((r) => {
      canonicaliseSingle(r, 'status', REP_STATUS_VOCAB); // "Active" → active
      return classifyRepRow(r, { codeExists: existing.has(up(str(r, 'rep_code'))) });
    });
  }

  /**
   * HISTORICAL sales. One row = one household, so `product_types` may list several — the raw cell is
   * resolved through the value vocabulary FIRST (so `"Internet, TV"` becomes `['internet','tv']`), then
   * every resolved type must have an active product for the client.
   */
  /** The DB context historical rows are judged against — shared by classification and the creation plan. */
  private async historicalContext(mappedRows: RawRow[]) {
    const byCode = await this.clientsByCode(uniqCodes(mappedRows, 'client_code'));
    const repCodes = uniqCodes(mappedRows, 'rep_code');
    const repExists = new Set((await this.repsByAnyCode(repCodes)).keys());
    const clientIds = [...byCode.values()];
    const products = clientIds.length
      ? await this.prisma.product.findMany({ where: { client_id: { in: clientIds }, is_active: true }, select: { client_id: true, product_type: true } })
      : [];
    const prodKey = new Set(products.map((p) => `${p.client_id}|${p.product_type}`));
    const vocab = await this.productTypeVocab();
    return { byCode, repExists, prodKey, vocab };
  }

  private async classifyHistoricalSales(mappedRows: RawRow[], createMissing: boolean, productTypeCtx?: ProductTypeContext): Promise<Classification[]> {
    const { byCode, repExists, prodKey, vocab } = await this.historicalContext(mappedRows);
    return mappedRows.map((r) => {
      const cid = byCode.get(up(str(r, 'client_code')));
      const resolved = canonicaliseProductTypes(r, vocab, productTypeCtx);
      return classifyHistoricalSaleRow(r, {
        clientExists: !!cid,
        repExists: repExists.has(up(str(r, 'rep_code'))),
        unknownProductTypes: resolved.unknown,
        resolvedCount: resolved.keys.length,
        suggestion: resolved.suggestion,
        missingProductTypes: cid ? resolved.keys.filter((t) => !prodKey.has(`${cid}|${t}`)) : resolved.keys,
        createMissing,
      });
    });
  }

  /**
   * What `create_missing` would bring into existence — DISTINCT clients, reps and client+type products,
   * so the preview can warn before anything is staged. Read-only.
   */
  private async historicalCreationPlan(mappedRows: RawRow[]) {
    const { byCode, repExists, prodKey, vocab } = await this.historicalContext(mappedRows);
    const clients = new Set<string>();
    const reps = new Set<string>();
    const products = new Set<string>();

    for (const r of mappedRows) {
      const clientCode = up(str(r, 'client_code'));
      const repCode = up(str(r, 'rep_code'));
      const cid = byCode.get(clientCode);
      const resolved = resolveVocabValue(str(r, 'product_types'), vocab);
      if (resolved.unknown.length > 0 || resolved.keys.length === 0) continue; // an error row creates nothing
      if (clientCode && !cid) clients.add(clientCode);
      if (repCode && !repExists.has(repCode)) reps.add(repCode);
      for (const type of resolved.keys) {
        // A brand-new client has no products at all, so every type on its rows is a new product too.
        if (!cid || !prodKey.has(`${cid}|${type}`)) products.add(`${clientCode}|${type}`);
      }
    }
    return {
      clients: [...clients].sort(),
      reps: [...reps].sort(),
      products: [...products].sort().map((k) => {
        const [client_code, product_type] = k.split('|');
        return { client_code, product_type };
      }),
    };
  }

  /** The product-type vocabulary, built from the catalogue so SA-added types resolve with no code change. */
  private async productTypeVocab(): Promise<Vocab> {
    const rows = await this.prisma.productTypeCatalogue.findMany({ select: { key: true, label: true } });
    return buildProductTypeVocab(rows);
  }

  /**
   * LIVE sales (IMP-013). Like the historical context, but every reference must resolve to something the
   * engine can actually use: the rep must be ACTIVE, EVERY listed product type must have an active product
   * for the client, and the catalogue `behaviour` decides whether the row carries the mandatory internet
   * base (SALE-001a) — pre-checked here so a bad row is an `error` the gate blocks, not a mid-commit throw.
   */
  private async classifyLiveSales(mappedRows: RawRow[], productTypeCtx?: ProductTypeContext): Promise<Classification[]> {
    const byCode = await this.clientsByCode(uniqCodes(mappedRows, 'client_code'));
    const repCodes = uniqCodes(mappedRows, 'rep_code');
    // Either code resolves, but the rep must still be ACTIVE — SalesService rejects an inactive one.
    const upperRepCodes = repCodes.map(up);
    const activeRepRows = await this.prisma.rep.findMany({
      where: { status: 'active', OR: [{ rep_code: { in: upperRepCodes } }, { external_code: { in: upperRepCodes } }] },
      select: { rep_code: true, external_code: true },
    });
    const activeReps = new Set(
      activeRepRows.flatMap((r) => [up(r.rep_code), ...(r.external_code ? [up(r.external_code)] : [])]),
    );
    const clientIds = [...byCode.values()];
    const products = clientIds.length
      ? await this.prisma.product.findMany({
          where: { client_id: { in: clientIds }, is_active: true },
          select: { client_id: true, product_type: true },
        })
      : [];
    const prodKey = new Set(products.map((p) => `${p.client_id}|${p.product_type}`));
    // product_type → catalogue behaviour; `tiered`/`greenfield` are the internet base (#5/#9).
    const behaviours = new Map(
      (await this.prisma.productTypeCatalogue.findMany({ select: { key: true, behaviour: true } })).map(
        (t) => [t.key, t.behaviour],
      ),
    );
    const vocab = await this.productTypeVocab();
    return mappedRows.map((r) => {
      const cid = byCode.get(up(str(r, 'client_code')));
      canonicaliseSingle(r, 'status', SALE_STATUS_VOCAB); // "Validated" → validated
      const resolved = canonicaliseProductTypes(r, vocab, productTypeCtx);
      const types = resolved.keys;
      return classifyLiveSaleRow(r, {
        clientExists: !!cid,
        repActive: activeReps.has(up(str(r, 'rep_code'))),
        unknownProductTypes: resolved.unknown,
        suggestion: resolved.suggestion,
        missingProductTypes: cid ? types.filter((t) => !prodKey.has(`${cid}|${t}`)) : types,
        hasInternetBase: types.some((t) => {
          const behaviour = behaviours.get(t);
          return behaviour === 'tiered' || behaviour === 'greenfield';
        }),
      });
    });
  }

  private async classifyHoldbacks(mappedRows: RawRow[]): Promise<Classification[]> {
    const repCodes = uniqCodes(mappedRows, 'rep_code');
    const periodIds = uniqCodes(mappedRows, 'origin_pay_period_id');
    const reps = await this.repsByAnyCode(repCodes);
    const periods = new Map(
      (await this.prisma.payPeriod.findMany({ where: { id: { in: periodIds } }, select: { id: true, status: true } })).map((p) => [p.id, p.status]),
    );
    const repIds = [...reps.values()];
    const existing = new Set(
      (
        await this.prisma.holdbackLedger.findMany({
          where: { rep_id: { in: repIds }, origin_pay_period_id: { in: periodIds } },
          select: { rep_id: true, origin_pay_period_id: true },
        })
      ).map((h) => `${h.rep_id}|${h.origin_pay_period_id}`),
    );
    return mappedRows.map((r) => {
      const repId = reps.get(up(str(r, 'rep_code')));
      const origin = str(r, 'origin_pay_period_id');
      return classifyHoldbackRow(r, {
        repExists: !!repId,
        originPeriodStatus: origin ? (periods.get(origin) ?? null) : null,
        ledgerExists: repId && origin ? existing.has(`${repId}|${origin}`) : false,
      });
    });
  }

  private async buildCommitContext(kind: Kind, createMissing = false): Promise<CommitContext> {
    const empty = { allPeriods: [], periodsById: new Map(), releaseRule: '', behaviours: new Map<string, string>(), createMissing };
    // Historical sales need the catalogue behaviours to pick the BASE item that carries the row's
    // billed amount (see `applyHistoricalSale`).
    if (kind === 'historical_sales') {
      const types = await this.prisma.productTypeCatalogue.findMany({ select: { key: true, behaviour: true } });
      return { ...empty, behaviours: new Map(types.map((t) => [t.key, t.behaviour as string])) };
    }
    if (kind !== 'opening_holdback') {
      return empty;
    }
    const allPeriods = await this.prisma.payPeriod.findMany({ select: { id: true, start_date: true, payday: true } });
    const setting = await this.prisma.holdbackReleaseSetting.findFirst({ orderBy: { effective_from: 'desc' } });
    return {
      ...empty,
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
    const rows = await tx.importRow.findMany({
      where: { import_batch_id: id },
      select: { row_number: true, match_status: true, issue: true },
    });
    await tx.importBatch.update({
      where: { id },
      data: {
        matched_rows: rows.filter((r) => r.match_status === 'matched').length,
        error_rows: rows.filter((r) => r.match_status === 'error').length,
        error_summary: this.summariseWithGroups(rows),
      },
    });
  }

  private summarise(rows: { match_status: MatchStatus | string }[]): Record<string, number> {
    const counts: Record<string, number> = { matched: 0, unmatched: 0, duplicate: 0, error: 0, ignored: 0 };
    for (const r of rows) counts[r.match_status] += 1;
    return counts;
  }

  /**
   * The stored `error_summary`: the per-status counts (unchanged, so existing readers keep working) PLUS
   * the DISTINCT problems. Grouping is what makes a 16-row failure read as one fixable thing.
   */
  private summariseWithGroups(rows: { row_number: number; match_status: MatchStatus | string; issue: string | null }[]): Prisma.InputJsonValue {
    const groups = groupIssues(rows);
    return { ...this.summarise(rows), groups, summary: summariseIssues(groups) } as unknown as Prisma.InputJsonValue;
  }
}

interface CommitContext {
  allPeriods: { id: string; start_date: Date; payday: Date }[];
  periodsById: Map<string, { id: string; start_date: Date; payday: Date }>;
  releaseRule: string;
  /** product-type key → catalogue behaviour (`tiered` / `greenfield` / `standard_addon`). */
  behaviours: Map<string, string>;
  /** The batch was staged with `create_missing` — referenced master data may be created at commit. */
  createMissing: boolean;
}

/** Minimal CSV-cell escaping for the error report. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
