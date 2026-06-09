/**
 * Commission Config controllers — /v1/commission/* and /v1/incentives. — arch §6.4
 * Every route declares its (commission, action) permission; the global guard enforces it.
 * REP commission stream only — no path to client_billing_rates (#3).
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TierScheduleService } from './tier-schedule.service';
import { FlatRateService } from './flat-rate.service';
import { HoldbackService } from './holdback.service';
import { IncentiveService } from './incentive.service';
import { ProductTypeService } from './product-type.service';
import { CreateTierScheduleDto } from './dto/tier.dto';
import { CreateFlatRateDto, ListFlatRatesQuery } from './dto/flat-rate.dto';
import { SetHoldbackConfigDto, SetHoldbackReleaseSettingDto } from './dto/holdback.dto';
import { CreateIncentiveDto, ListIncentivesQuery, UpdateIncentiveDto } from './dto/incentive.dto';
import { CreateProductTypeDto, ListProductTypesQuery, UpdateProductTypeDto } from './dto/product-type.dto';
import {
  FlatRateResponse,
  HoldbackConfigResponse,
  HoldbackReleaseSettingResponse,
  IncentiveResponse,
  TierConfigResponse,
} from './dto/commission.response';
import { ProductTypeResponse } from './dto/product-type.response';

@ApiTags('Commission Config')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('commission')
export class CommissionController {
  constructor(
    private readonly tiers: TierScheduleService,
    private readonly flatRates: FlatRateService,
    private readonly holdback: HoldbackService,
  ) {}

  // ── Tier schedule ─────────────────────────────────────────────────────────────────────────────

  @Get('tiers')
  @RequirePermission('commission', 'view')
  @ApiOperation({
    summary: 'Tier schedules (current + pending)',
    description: 'Requires commission:view.',
  })
  @ApiOkResponse({ type: TierConfigResponse, isArray: true })
  listTiers() {
    return this.tiers.list();
  }

  @Post('tiers')
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Create a new effective-dated tier schedule',
    description: 'Requires commission:edit. Supersedes the pending schedule; back-dating → 422.',
  })
  @ApiCreatedResponse({ type: TierConfigResponse })
  createTiers(@Body() dto: CreateTierScheduleDto, @CurrentUser('id') actorId: string) {
    return this.tiers.create(dto, actorId);
  }

  // ── Flat rates ────────────────────────────────────────────────────────────────────────────────

  @Get('flat-rates')
  @RequirePermission('commission', 'view')
  @ApiOperation({
    summary: 'Flat rates per product type (current + pending)',
    description: 'Requires commission:view.',
  })
  @ApiOkResponse({ type: FlatRateResponse, isArray: true })
  listFlatRates(@Query() query: ListFlatRatesQuery) {
    return this.flatRates.list(query);
  }

  @Post('flat-rates')
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Set an effective-dated flat rate',
    description:
      'Requires commission:edit. greenfield_internet / tv / home_phone only (internet is tiered).',
  })
  @ApiCreatedResponse({ type: FlatRateResponse })
  createFlatRate(@Body() dto: CreateFlatRateDto, @CurrentUser('id') actorId: string) {
    return this.flatRates.create(dto, actorId);
  }

  // ── Holdback split ────────────────────────────────────────────────────────────────────────────

  @Get('holdback-config')
  @RequirePermission('commission', 'view')
  @ApiOperation({
    summary: 'Advance/holdback split (current + pending)',
    description: 'Requires commission:view.',
  })
  @ApiOkResponse({ type: HoldbackConfigResponse, isArray: true })
  listHoldbackConfig() {
    return this.holdback.listConfig();
  }

  @Patch('holdback-config')
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Set an effective-dated advance/holdback split',
    description:
      'Requires commission:edit. advance_pct + holdback_pct must equal 1; back-dating → 422.',
  })
  @ApiOkResponse({ type: HoldbackConfigResponse })
  setHoldbackConfig(@Body() dto: SetHoldbackConfigDto, @CurrentUser('id') actorId: string) {
    return this.holdback.setConfig(dto, actorId);
  }

  // ── Holdback release setting (PROPOSED, SRS §17.1) ────────────────────────────────────────────

  @Get('holdback-release-setting')
  @RequirePermission('commission', 'view')
  @ApiOperation({
    summary: 'Holdback-release setting (current sticky) — PROPOSED (SRS §17)',
    description: 'Requires commission:view. PROPOSED/pending Redwave confirmation; stored only.',
  })
  @ApiOkResponse({
    type: HoldbackReleaseSettingResponse,
    description: 'The current sticky setting, or null if none has been set.',
  })
  getReleaseSetting() {
    return this.holdback.getReleaseSetting();
  }

  @Patch('holdback-release-setting')
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Set the holdback-release setting (bulk, sticky) — PROPOSED (SRS §17)',
    description:
      'Requires commission:edit. PROPOSED/pending Redwave confirmation: release_rule is stored only; ' +
      'its interpretation (which cycle the 30% releases into) is deferred to the Pay Run module.',
  })
  @ApiOkResponse({ type: HoldbackReleaseSettingResponse })
  setReleaseSetting(@Body() dto: SetHoldbackReleaseSettingDto, @CurrentUser('id') actorId: string) {
    return this.holdback.setReleaseSetting(dto, actorId);
  }
}

@ApiTags('Commission Config')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('incentives')
export class IncentivesController {
  constructor(private readonly incentives: IncentiveService) {}

  @Get()
  @RequirePermission('commission', 'view')
  @ApiOperation({
    summary: 'List incentives',
    description: 'Requires commission:view. ?status filter.',
  })
  @ApiOkResponse({ type: IncentiveResponse, isArray: true })
  list(@Query() query: ListIncentivesQuery) {
    return this.incentives.list(query);
  }

  @Post()
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Create an incentive/spiff',
    description:
      'Requires commission:edit. per_activation is applied by the engine; target_based is MODELED but ' +
      'DEFERRED (not yet applied — pending Redwave confirmation).',
  })
  @ApiCreatedResponse({ type: IncentiveResponse })
  create(@Body() dto: CreateIncentiveDto, @CurrentUser('id') actorId: string) {
    return this.incentives.create(dto, actorId);
  }

  @Patch(':id')
  @RequirePermission('commission', 'edit')
  @ApiOperation({ summary: 'Edit / end an incentive', description: 'Requires commission:edit.' })
  @ApiOkResponse({ type: IncentiveResponse })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIncentiveDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.incentives.update(id, dto, actorId);
  }
}

/**
 * Product-type catalogue — the configurable type list + behaviour. GET is an authenticated reference read
 * (product / flat-rate / incentive forms use it); create/edit require commission:edit. — §6
 */
@ApiTags('Commission Config')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('product-types')
export class ProductTypesController {
  constructor(private readonly productTypes: ProductTypeService) {}

  @Get()
  @ApiOperation({
    summary: 'List product types (catalogue)',
    description: 'Authenticated reference read. ?status=active filters to active types.',
  })
  @ApiOkResponse({ type: ProductTypeResponse, isArray: true })
  list(@Query() query: ListProductTypesQuery) {
    return this.productTypes.list(query);
  }

  @Post()
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Add a product type (always a standard add-on)',
    description:
      'Requires commission:edit. behaviour is forced standard_addon — a new type can never be tiered/' +
      'greenfield (#5/#9). May carry an inline commission flat rate (written to the commission stream).',
  })
  @ApiCreatedResponse({ type: ProductTypeResponse })
  create(@Body() dto: CreateProductTypeDto, @CurrentUser('id') actorId: string) {
    return this.productTypes.create(dto, actorId);
  }

  @Patch(':key')
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Relabel / activate / deactivate a product type',
    description: 'Requires commission:edit. key + behaviour are immutable; system types cannot be deactivated.',
  })
  @ApiOkResponse({ type: ProductTypeResponse })
  update(@Param('key') key: string, @Body() dto: UpdateProductTypeDto, @CurrentUser('id') actorId: string) {
    return this.productTypes.update(key, dto, actorId);
  }
}
