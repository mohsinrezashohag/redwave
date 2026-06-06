/**
 * Pay Run controllers — /v1/pay-periods, /v1/pay-runs*, /v1/holdback-ledger. — arch §6.6
 * payrun:approve gates the money actions (finalize, bonus). Every route declares its permission;
 * the global guard enforces it and the service scopes data per caller.
 */
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { PayPeriodService } from './pay-period.service';
import { PayRunService } from './pay-run.service';
import { CreatePayRunDto } from './dto/create-pay-run.dto';
import { SetBonusDto } from './dto/bonus.dto';
import { ExportPayRunDto } from './dto/export.dto';
import { ListHoldbackQuery } from './dto/list-holdback.query';
import {
  ExportResultResponse,
  HoldbackLedgerResponse,
  PayPeriodResponse,
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
  constructor(private readonly payRuns: PayRunService) {}

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
