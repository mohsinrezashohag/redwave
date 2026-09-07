/**
 * ExportLayoutService — saved, named column layouts for exported reports.
 *
 * Lives in `common/` rather than `reporting/` because BOTH billing (issued statements) and payrun (the
 * payroll workbook) need it, and a domain module must never depend on the reporting module to render its
 * own documents. Same cross-cutting seam as `common/sequence` and `common/fx`.
 *
 * The export analogue of `ImportFieldMapping`: a Redwave format change becomes a settings change rather
 * than a dev ticket. Mohsin raised this himself in the meeting.
 *
 * #3 lives in the REGISTRY, not here. This service validates every layout through
 * `export-fields.registry.ts`, which is what makes "add the client rate to the payroll export" impossible
 * to express rather than merely discouraged.
 *
 * #2 — an issued document keeps the layout it was ISSUED with. `resolveForIssue` is what a generator calls
 * to capture the layout at issue time; a re-render then reads the FROZEN id off the document, never
 * today's configuration. That is why changing a layout can never alter a historical statement.
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../rbac/auth-user.type';
import {
  EXPORT_REGISTRY,
  LayoutColumn,
  REPORT_TYPES,
  ReportType,
  defaultLayout,
  isReportType,
  sampleRow,
  validateLayout,
} from './export-fields.registry';
import { SaveExportLayoutDto } from '../../modules/reporting/dto/export-layout.dto';

/** Read a stored jsonb column list defensively — a malformed row must not crash a render. */
function parseColumns(raw: unknown): LayoutColumn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .filter((c) => typeof c.field === 'string')
    .map((c) => ({ field: c.field as string, header: typeof c.header === 'string' ? c.header : undefined }));
}

@Injectable()
export class ExportLayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The field catalogue — what a layout may reference, per report type. Drives the admin picker. */
  registry() {
    return REPORT_TYPES.map((type) => ({
      report_type: type,
      label: EXPORT_REGISTRY[type].label,
      has_formula_strip: EXPORT_REGISTRY[type].hasFormulaStrip,
      fields: EXPORT_REGISTRY[type].fields.map((f) => ({
        key: f.key,
        label: f.label,
        money: f.money === true,
        required: f.required === true,
      })),
      default_columns: defaultLayout(type),
      sample_row: sampleRow(type),
    }));
  }

  async list(reportType?: string) {
    const rows = await this.prisma.exportLayout.findMany({
      where: reportType ? { report_type: reportType } : {},
      orderBy: [{ report_type: 'asc' }, { created_at: 'desc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      report_type: r.report_type,
      client_id: r.client_id,
      columns: parseColumns(r.columns),
      is_active: r.is_active,
      created_by: r.created_by,
    }));
  }

  /**
   * Save a layout. Validation happens BEFORE the write, so an unrenderable layout never reaches the
   * database — a stored layout that breaks a workbook would fail at download time, in front of whoever
   * needed the file.
   */
  async save(dto: SaveExportLayoutDto, user: AuthUser) {
    if (!isReportType(dto.report_type)) {
      throw new UnprocessableEntityException(
        `unknown report type '${dto.report_type}' — expected one of ${REPORT_TYPES.join(', ')}`,
      );
    }
    const columns: LayoutColumn[] = dto.columns.map((c) => ({ field: c.field, header: c.header }));
    const errors = validateLayout(dto.report_type, columns);
    if (errors.length > 0) {
      throw new UnprocessableEntityException({ message: 'invalid export layout', errors });
    }

    const created = await this.prisma.exportLayout.create({
      data: {
        name: dto.name,
        report_type: dto.report_type,
        client_id: dto.client_id ?? null,
        columns: columns as unknown as object[],
        created_by: user.id,
      },
    });

    await this.audit.log({
      actorId: user.id,
      entityType: 'export_layouts',
      entityId: created.id,
      action: 'create',
      after: { name: dto.name, report_type: dto.report_type, client_id: dto.client_id ?? null, column_count: columns.length },
    });
    return { ...created, columns };
  }

  /**
   * Deactivate a layout. It is never deleted: an issued statement may reference it, and that document's
   * rendering must remain reproducible (#2). Deactivating stops it being chosen for NEW documents while
   * leaving history intact.
   */
  async deactivate(id: string, user: AuthUser) {
    const row = await this.prisma.exportLayout.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Export layout not found');
    }
    const updated = await this.prisma.exportLayout.update({ where: { id }, data: { is_active: false } });
    await this.audit.log({
      actorId: user.id,
      entityType: 'export_layouts',
      entityId: id,
      action: 'update',
      before: { is_active: row.is_active },
      after: { is_active: false },
    });
    return { ...updated, columns: parseColumns(updated.columns) };
  }

  /**
   * The layout to use for a report RIGHT NOW: the client's own active layout, else the report-wide one,
   * else the built-in default. Most specific wins, matching every other scoped lookup in the system.
   */
  async resolve(reportType: ReportType, clientId?: string | null): Promise<{ id: string | null; columns: LayoutColumn[] }> {
    const rows = await this.prisma.exportLayout.findMany({
      where: { report_type: reportType, is_active: true },
      orderBy: { created_at: 'desc' },
    });
    const forClient = clientId ? rows.find((r) => r.client_id === clientId) : undefined;
    const global = rows.find((r) => r.client_id === null);
    const chosen = forClient ?? global;
    if (!chosen) return { id: null, columns: defaultLayout(reportType) };

    const columns = parseColumns(chosen.columns);
    // A stored layout that no longer validates (a field was retired, say) falls back rather than emitting
    // a broken workbook. Reporting a clean default beats failing a download nobody can fix in the moment.
    return validateLayout(reportType, columns).length === 0
      ? { id: chosen.id, columns }
      : { id: null, columns: defaultLayout(reportType) };
  }

  /**
   * The layout FROZEN onto an issued document, read back for a re-render (#2). A document issued before
   * layouts existed — or issued under the default — carries null and re-renders with the built-in default,
   * which is exactly how it was issued. That is what makes a historical re-download byte-identical.
   */
  async resolveFrozen(reportType: ReportType, layoutId: string | null): Promise<LayoutColumn[]> {
    if (!layoutId) return defaultLayout(reportType);
    const row = await this.prisma.exportLayout.findUnique({ where: { id: layoutId } });
    if (!row) return defaultLayout(reportType);
    const columns = parseColumns(row.columns);
    return validateLayout(reportType, columns).length === 0 ? columns : defaultLayout(reportType);
  }
}
