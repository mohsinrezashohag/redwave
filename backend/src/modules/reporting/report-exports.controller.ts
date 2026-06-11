/**
 * Report-exports controller — /v1/report-exports (SRS RPT-015). POST records an on-demand report export
 * (the file is generated client-side); it is AUTHENTICATED-ONLY here because the permission depends on
 * the report TYPE in the body — the service enforces the per-type gate (business_summary→reports:business,
 * leaderboard→reports:view, payrun_summary→payrun:export, expense_summary→expenses:export) with 403 +
 * audit on denial. GET lists recent records (own for non-admin, all for Admin/SA), gated reports:view.
 */
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { ReportExportsService } from './report-exports.service';
import { CreateReportExportDto, ReportExportResponse } from './dto/report-export.dto';

@ApiTags('Reporting & Dashboards')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('report-exports')
export class ReportExportsController {
  constructor(private readonly exports: ReportExportsService) {}

  @Get()
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'List recent report exports',
    description: 'Latest 50 recorded exports — own records for non-admin callers, all for Admin/Super Admin.',
  })
  @ApiOkResponse({ type: ReportExportResponse, isArray: true })
  list(@CurrentUser() user: AuthUser) {
    return this.exports.list(user);
  }

  @Post()
  @ApiOperation({
    summary: 'Record an on-demand report export',
    description:
      'Authenticated; the permission is enforced PER report type in the service ' +
      '(business_summary→reports:business, leaderboard→reports:view, payrun_summary→payrun:export, ' +
      'expense_summary→expenses:export). Denial → 403 + audit. The file itself is generated client-side.',
  })
  @ApiCreatedResponse({ type: ReportExportResponse })
  record(@CurrentUser() user: AuthUser, @Body() dto: CreateReportExportDto) {
    return this.exports.record(dto, user);
  }
}
