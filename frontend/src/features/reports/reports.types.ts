/**
 * Reports feature types — ALIASED to the generated OpenAPI schema (Batch A #2 convention; never hand-write
 * response shapes). The report-export record mirrors expense_exports: who/what/when; the FILE itself is
 * client-generated. — SRS RPT-015
 */
import type { components } from '../../api/generated/schema';

export type ReportExport = components['schemas']['ReportExportResponse'];
export type CreateReportExportBody = components['schemas']['CreateReportExportDto'];

export type ReportType = ReportExport['report_type'];
export type ReportFormat = ReportExport['format'];
