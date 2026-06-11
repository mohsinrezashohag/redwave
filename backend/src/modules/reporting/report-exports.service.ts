/**
 * ReportExportsService — record + list on-demand report exports (report_exports; SRS RPT-015).
 * The FILE is generated CLIENT-side from already-scope-enforced reads (lib/export); this records WHO
 * exported WHAT and WHEN — mirroring expense_exports — and is the audit trail for report files leaving
 * the system. NO new permission: each report type rides its EXISTING key, checked here PER TYPE (a
 * controller @RequirePermission can't vary by body): business_summary→reports:business,
 * leaderboard→reports:view, payrun_summary→payrun:export, expense_summary→expenses:export. Denial →
 * 403 + an access_denied audit row (the dashboards-service pattern). For the rep-scoped report types
 * the caller's rep scope is recorded into scope_filters (manager=roster, rep=self, admin/SA=null=all),
 * like expense-export.service. SCHEDULED exports are deferred (§12). — CLAUDE §5
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { BUILTIN_ROLES } from '../../common/rbac/rbac.constants';
import { permissionKey } from '../../common/rbac/permissions.util';
import { CreateReportExportDto, ReportType } from './dto/report-export.dto';

/** The EXISTING permission each report type rides — the per-type gate (no new permission). */
export const TYPE_PERMISSION: Record<ReportType, [module: string, action: string]> = {
  business_summary: ['reports', 'business'],
  leaderboard: ['reports', 'view'],
  payrun_summary: ['payrun', 'export'],
  expense_summary: ['expenses', 'export'],
};

/** The report types whose DATA is rep-scoped — their record carries the caller's rep scope. */
const REP_SCOPED_TYPES: ReadonlySet<ReportType> = new Set(['payrun_summary', 'expense_summary']);

const isAdmin = (u: AuthUser): boolean => u.isSuperAdmin || u.roleNames.includes(BUILTIN_ROLES.ADMIN);

const LIST_LIMIT = 50;

@Injectable()
export class ReportExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  /** Latest recorded exports — own records for non-admin callers, all for Admin/Super Admin. */
  list(user: AuthUser) {
    return this.prisma.reportExport.findMany({
      where: isAdmin(user) ? {} : { generated_by: user.id },
      orderBy: { generated_at: 'desc' },
      take: LIST_LIMIT,
    });
  }

  async record(dto: CreateReportExportDto, user: AuthUser) {
    const [moduleKey, action] = TYPE_PERMISSION[dto.report_type];
    if (!user.permissions.has(permissionKey(moduleKey, action))) {
      await this.audit.log({
        actorId: user.id,
        entityType: 'report_exports',
        entityId: user.id,
        action: 'access_denied',
        after: { reason: `report type '${dto.report_type}' requires ${moduleKey}:${action}` },
      });
      throw new ForbiddenException(`Exporting this report requires the ${moduleKey}:${action} permission`);
    }

    // Record the caller's rep scope for rep-scoped report data (the expense-export pattern): the actual
    // rows were already scope-enforced by the read endpoints; this keeps the audit record honest about
    // WHOSE data the file could contain. null = all (admin/SA). — CLAUDE §5
    let rep_scope: string[] | null = null;
    if (REP_SCOPED_TYPES.has(dto.report_type)) {
      const repScope = await this.scope.getRepScope(user);
      rep_scope = repScope.level === 'all' ? null : repScope.repIds;
    }

    const export_ = await this.prisma.reportExport.create({
      data: {
        generated_by: user.id,
        report_type: dto.report_type,
        format: dto.format,
        filename: dto.filename,
        scope_filters: {
          pay_period_id: dto.pay_period_id ?? null,
          from: dto.from ?? null,
          to: dto.to ?? null,
          rep_scope,
        },
      },
    });
    await this.audit.log({
      actorId: user.id,
      entityType: 'report_exports',
      entityId: export_.id,
      action: 'export',
      after: { report_type: dto.report_type, format: dto.format, filename: dto.filename },
    });
    return export_;
  }
}
