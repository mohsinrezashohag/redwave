/**
 * Pay Run controllers — /v1/pay-periods, /v1/pay-runs*, /v1/holdback-ledger. — arch §6.6
 * payrun:approve gates the money actions (finalize, bonus). Every route declares its permission;
 * the global guard enforces it and the service scopes data per caller.
 */
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiProduces,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { PayPeriodService } from './pay-period.service';
import { PayRunService } from './pay-run.service';
import { PayrollExcelRenderer } from './renderers/payroll-excel.renderer';
import { CreatePayRunDto } from './dto/create-pay-run.dto';
import { SetBonusDto } from './dto/bonus.dto';
import { ExportPayRunDto } from './dto/export.dto';
import {
  PayrollReportResponse,
  RepPayStatementResponse,
  RepPayStatementSummaryResponse,
} from './dto/pay-run.response';
import { ListHoldbackQuery } from './dto/list-holdback.query';
import {
  ExportResultResponse,
  HoldbackLedgerResponse,
  PayPeriodResponse,
  PayRunHoldbackSummaryResponse,
  PayRunLineResponse,
  PayRunResponse,
  PayRunSummaryResponse,
} from './dto/pay-run.response';

@ApiTags('Pay Run & Holdback')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('pay-periods')
export class PayPeriodController {
  constructor(private readonly periods: PayPeriodService) {}

  @Get()
  @RequirePermission('payrun', 'view')
  @ApiOperation({
    summary: 'List pay periods',
    description: 'Requires payrun:view. Pre-loaded 2026 schedule.',
  })
  @ApiOkResponse({ type: PayPeriodResponse, isArray: true })
  list() {
    return this.periods.list();
  }
}

@ApiTags('Pay Run & Holdback')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('pay-runs')
export class PayRunController {
  constructor(
    private readonly payRuns: PayRunService,
    private readonly payrollExcel: PayrollExcelRenderer,
  ) {}

  @Get()
  @RequirePermission('payrun', 'view')
  @ApiOperation({ summary: 'List pay runs', description: 'Requires payrun:view.' })
  @ApiOkResponse({ type: PayRunSummaryResponse, isArray: true })
  list() {
    return this.payRuns.listRuns();
  }

  @Post()
  @RequirePermission('payrun', 'create')
  @ApiOperation({
    summary: 'Create / refresh a DRAFT pay run',
    description: 'Requires payrun:create. Computes preview lines via the engine; nothing frozen.',
  })
  @ApiCreatedResponse({ type: PayRunResponse })
  create(@Body() dto: CreatePayRunDto, @CurrentUser() user: AuthUser) {
    return this.payRuns.createDraft(dto, user);
  }

  @Get(':id')
  @RequirePermission('payrun', 'view')
  @ApiOperation({
    summary: 'Get a pay run + lines',
    description: 'Requires payrun:view (scoped lines).',
  })
  @ApiOkResponse({ type: PayRunResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.payRuns.getRun(id, user);
  }

  @Get(':id/lines')
  @RequirePermission('payrun', 'view')
  @ApiOperation({
    summary: 'Per-rep computed lines',
    description: 'Requires payrun:view (scoped).',
  })
  @ApiOkResponse({ type: PayRunLineResponse, isArray: true })
  lines(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.payRuns.getLines(id, user);
  }

  @Get(':id/holdback')
  @RequirePermission('payrun', 'view')
  @ApiOperation({
    summary: "The run's period-level 30% (deferred pay) view",
    description:
      'Requires payrun:view (scoped). Every figure is server-computed — what is held this period, WHEN it ' +
      'releases, what matures into this period, the clawback set-off, and the per-origin ledger breakdown. ' +
      'On a DRAFT the current hold + release period are a projection (is_projection=true); once finalized ' +
      'they are read from the frozen holdback_ledger.',
  })
  @ApiOkResponse({ type: PayRunHoldbackSummaryResponse })
  holdbackSummary(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.payRuns.getHoldbackSummary(id, user);
  }

  @Post(':id/lines/:lineId/bonus')
  @HttpCode(200)
  @RequirePermission('payrun', 'approve')
  @ApiOperation({
    summary: 'Set an ad-hoc bonus on a draft line',
    description: 'Requires payrun:approve. Draft only.',
  })
  @ApiOkResponse({ type: PayRunLineResponse })
  setBonus(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: SetBonusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payRuns.setBonus(id, lineId, dto, user);
  }

  @Post(':id/finalize')
  @HttpCode(200)
  @RequirePermission('payrun', 'approve')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Safe to retry; finalize is idempotent.',
  })
  @ApiOperation({
    summary: 'Finalize a pay run (the money action)',
    description:
      'Requires payrun:approve. ATOMIC + IDEMPOTENT: freezes snapshots, pays sales, records/releases ' +
      'holdback (release timing PROPOSED — SRS §17), applies bonuses, composes net. Retry is a no-op.',
  })
  @ApiOkResponse({ type: PayRunResponse })
  finalize(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.payRuns.finalize(id, user);
  }

  /**
   * The PAYROLL REPORT — Redwave's own workbook, read from the lines FROZEN at finalize.
   *
   * `payrun:view` for the preview, `payrun:export` for the file, mirroring the ADP export beside it. Rep-pay
   * stream only; nothing here reaches the client-billing rate tables (#3).
   */
  @Get(':id/payroll-report')
  @RequirePermission('payrun', 'view')
  @ApiOperation({
    summary: "Preview the payroll report (Redwave's workbook shape)",
    description:
      'Requires payrun:view. One row per SALE from the FROZEN snapshot — never recomputed (#2). A run that ' +
      'has not finalized has no lines yet and reports is_finalized=false rather than showing zeros.',
  })
  @ApiOkResponse({ type: PayrollReportResponse })
  payrollReport(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.payRuns.payrollReport(id, user);
  }

  @Get(':id/payroll-report/download')
  @RequirePermission('payrun', 'export')
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({
    summary: 'Download the payroll report workbook (.xlsx)',
    description:
      'Requires payrun:export. Header on row 2 with the SUBTOTAL strip on row 1, matching Redwave’s file.',
  })
  async payrollReportDownload(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const report = await this.payRuns.payrollReport(id, user);
    const bytes = await this.payrollExcel.render({ ...report, generated_at: new Date().toISOString() });
    const filename = `redwave-payroll-period-${report.period_number}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(bytes.length));
    res.end(bytes);
  }

  @Get(':id/reps/:repId/statement')
  @RequirePermission('payrun', 'view')
  @ApiOperation({
    summary: "Issue ONE rep's pay statement for this run (admin)",
    description:
      'Requires payrun:view — an admin gate a rep does not hold. Built from the SAME frozen payroll lines ' +
      'as the payroll report, filtered to one rep, so the two reconcile by construction (#2). Contains no ' +
      'client rate (#3).',
  })
  @ApiOkResponse({ type: RepPayStatementResponse })
  repStatement(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('repId', ParseUUIDPipe) repId: string,
  ) {
    return this.payRuns.repPayStatement(id, repId);
  }

  @Post(':id/export')
  @HttpCode(200)
  @RequirePermission('payrun', 'export')
  @ApiOperation({
    summary: 'Generate the ADP export for a finalized run',
    description:
      'Requires payrun:export. Configurable format; marks the run exported; recorded via audit.',
  })
  @ApiOkResponse({ type: ExportResultResponse })
  export(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExportPayRunDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payRuns.exportRun(id, dto, user);
  }
}

@ApiTags('Pay Run & Holdback')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('holdback-ledger')
export class HoldbackLedgerController {
  constructor(private readonly payRuns: PayRunService) {}

  @Get()
  @RequirePermission('payrun', 'view')
  @ApiOperation({
    summary: 'Holdback ledger',
    description: 'Requires payrun:view. Holds, schedule, release status.',
  })
  @ApiOkResponse({ type: HoldbackLedgerResponse, isArray: true })
  list(@Query() query: ListHoldbackQuery, @CurrentUser() user: AuthUser) {
    return this.payRuns.listHoldbackLedger(query, user);
  }
}


/**
 * A rep's OWN pay statements. A SEPARATE controller on purpose, and note what its routes do not have:
 * there is no `repId` parameter anywhere. The rep is resolved from the authenticated token, so another
 * rep's statement cannot be requested through this surface at all — stronger than validating an id.
 *
 * Gated by `pay_statements:view`, its own module row, so statement access is grantable WITHOUT any pay-run
 * access. A rep never reaches the run itself, another rep's lines, or any org-wide total (§5, #3).
 */
@ApiTags('Pay Run & Holdback')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('pay-statements')
export class PayStatementsController {
  constructor(private readonly payRuns: PayRunService) {}

  @Get()
  @RequirePermission('pay_statements', 'view')
  @ApiOperation({
    summary: 'List MY pay statements',
    description: 'Requires pay_statements:view. Own only — the rep comes from the token, never a parameter.',
  })
  @ApiOkResponse({ type: RepPayStatementSummaryResponse, isArray: true })
  mine(@CurrentUser() user: AuthUser) {
    return this.payRuns.myPayStatements(user);
  }

  @Get(':runId')
  @RequirePermission('pay_statements', 'view')
  @ApiOperation({
    summary: 'Get MY pay statement for one run',
    description:
      'Requires pay_statements:view. The run is named, the REP is not — it is always the caller. A user ' +
      'with no linked rep gets 403, not an empty list.',
  })
  @ApiOkResponse({ type: RepPayStatementResponse })
  mineForRun(@Param('runId', ParseUUIDPipe) runId: string, @CurrentUser() user: AuthUser) {
    return this.payRuns.myPayStatement(runId, user);
  }
}
