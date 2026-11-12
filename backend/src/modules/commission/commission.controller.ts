/**
 * Commission Config controllers — /v1/commission/* and /v1/incentives. — arch §6.4
 * Every route declares its (commission, action) permission; the global guard enforces it.
 * REP commission stream only — no path to client_billing_rates (#3).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TierScheduleService } from './tier-schedule.service';
import { FlatRateService } from './flat-rate.service';
import { TierRateService } from './tier-rate.service';
import { BasePricesService } from './base-prices.service';
import { SetBasePricesDto } from './dto/base-prices.dto';
import { IncentiveService } from './incentive.service';
import { ProductTypeService } from './product-type.service';
import { CreateTierScheduleDto, ListTierSchedulesQuery, UpdateTierScheduleDto } from './dto/tier.dto';
import { CreateFlatRateDto, ListFlatRatesQuery, UpdateFlatRateDto } from './dto/flat-rate.dto';
import { CreateTierRateDto, ListTierRatesQuery, UpdateTierRateDto } from './dto/tier-rate.dto';
import { CreateIncentiveDto, ListIncentivesQuery, UpdateIncentiveDto } from './dto/incentive.dto';
import { CreateProductTypeDto, ListProductTypesQuery, UpdateProductTypeDto } from './dto/product-type.dto';
import {
  BasePricesResponse,
  FlatRateResponse,
  TierRateResponse,
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
    private readonly tierRates: TierRateService,
    private readonly basePrices: BasePricesService,
  ) {}

  // ── Tier schedule ─────────────────────────────────────────────────────────────────────────────

  @Get('tiers')
  @RequirePermission('commission', 'view')
  @ApiOperation({
    summary: 'Tier schedules (current + pending)',
    description: 'Requires commission:view.',
  })
  @ApiOkResponse({ type: TierConfigResponse, isArray: true })
  listTiers(@Query() query: ListTierSchedulesQuery) {
    return this.tiers.list(query);
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

  @Post('base-prices')
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Switch a scope to base prices (tiers off)',
    description:
      'Requires commission:edit. In ONE transaction: the scope’s schedule becomes a single [0,∞) tier-1 bracket at ' +
      'default_rate, and each listed internet product gets its own tier-1 price; products left out use the default. ' +
      'Global takes a default only. Effective-dated like every rate (#10): back-dating → 422.',
  })
  @ApiCreatedResponse({ type: BasePricesResponse })
  setBasePrices(@Body() dto: SetBasePricesDto, @CurrentUser('id') actorId: string) {
    return this.basePrices.setBasePrices(dto, actorId);
  }

  @Patch('tiers/:id')
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Edit a PENDING tier schedule',
    description: 'Requires commission:edit. Only a pending schedule can be edited; current/past → 422 (supersede).',
  })
  @ApiOkResponse({ type: TierConfigResponse })
  updateTiers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTierScheduleDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.tiers.update(id, dto, actorId);
  }

  @Delete('tiers/:id')
  @RequirePermission('commission', 'edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a PENDING tier schedule',
    description: 'Requires commission:edit. Only a pending schedule can be deleted; current/past → 422.',
  })
  @ApiNoContentResponse()
  removeTiers(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.tiers.remove(id, actorId);
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

  @Patch('flat-rates/:id')
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Edit a PENDING flat rate',
    description: 'Requires commission:edit. Only a pending rate can be edited; current/past → 422 (supersede).',
  })
  @ApiOkResponse({ type: FlatRateResponse })
  updateFlatRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFlatRateDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.flatRates.update(id, dto, actorId);
  }

  @Delete('flat-rates/:id')
  @RequirePermission('commission', 'edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a PENDING flat rate',
    description: 'Requires commission:edit. Only a pending rate can be deleted; current/past → 422.',
  })
  @ApiNoContentResponse()
  removeFlatRate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.flatRates.remove(id, actorId);
  }

  // ── Per-product tier rates ────────────────────────────────────────────────────────────────────
  // The tally and the bracket boundaries are NOT configured here — those live on the tier schedule and
  // still decide which tier every product lands in (#5). These rows only answer what a given tier pays
  // for one product; a product with no row keeps the schedule's own rate.

  @Get('tier-rates')
  @RequirePermission('commission', 'view')
  @ApiOperation({
    summary: 'Per-product tier rates (current + pending)',
    description: 'Requires commission:view. Scope = (client, product, tier); a missing row falls back to the schedule rate.',
  })
  @ApiOkResponse({ type: TierRateResponse, isArray: true })
  listTierRates(@Query() query: ListTierRatesQuery) {
    return this.tierRates.list(query);
  }

  @Post('tier-rates')
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Set an effective-dated per-product tier rate',
    description:
      'Requires commission:edit. TIERED products only (an add-on uses a flat rate). The tier must exist in ' +
      'the schedule. Back-dating is rejected (422) — a closed period is never rewritten (#10).',
  })
  @ApiCreatedResponse({ type: TierRateResponse })
  createTierRate(@Body() dto: CreateTierRateDto, @CurrentUser('id') actorId: string) {
    return this.tierRates.create(dto, actorId);
  }

  @Patch('tier-rates/:id')
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Edit a PENDING per-product tier rate',
    description: 'Requires commission:edit. Only a pending rate can be edited; current/past → 422 (supersede).',
  })
  @ApiOkResponse({ type: TierRateResponse })
  updateTierRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTierRateDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.tierRates.update(id, dto, actorId);
  }

  @Delete('tier-rates/:id')
  @RequirePermission('commission', 'edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a PENDING per-product tier rate',
    description: 'Requires commission:edit. Only a pending rate can be deleted; current/past → 422.',
  })
  @ApiNoContentResponse()
  removeTierRate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.tierRates.remove(id, actorId);
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
      'Requires commission:edit. Both modes are applied by the engine (threshold-relative): per_activation ' +
      '(bonus beyond target_count; null/0 = every activation) and one_time (a single bonus at target_count).',
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

  @Delete(':id')
  @RequirePermission('commission', 'edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an unused incentive',
    description: 'Requires commission:edit. Only an incentive never applied to a paid item can be deleted; ' +
      'a referenced incentive is part of a frozen snapshot — end it instead (→ 422).',
  })
  @ApiNoContentResponse()
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.incentives.remove(id, actorId);
  }
}

/**
 * Product-type catalogue — the configurable type list + behaviour. GET is an authenticated reference read
 * (product / flat-rate / incentive forms use it); create/edit require product_types:edit (its OWN RBAC
 * module, so a role can manage the catalogue without all Commission Config edit access). — §6
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
  @RequirePermission('product_types', 'edit')
  @ApiOperation({
    summary: 'Add a product type (always a standard add-on)',
    description:
      'Requires product_types:edit. behaviour is forced standard_addon — a new type can never be tiered/' +
      'greenfield (#5/#9). May carry an inline commission flat rate (written to the commission stream).',
  })
  @ApiCreatedResponse({ type: ProductTypeResponse })
  create(@Body() dto: CreateProductTypeDto, @CurrentUser('id') actorId: string) {
    return this.productTypes.create(dto, actorId);
  }

  @Patch(':key')
  @RequirePermission('product_types', 'edit')
  @ApiOperation({
    summary: 'Relabel / activate / deactivate a product type',
    description: 'Requires product_types:edit. key + behaviour are immutable; system types cannot be deactivated.',
  })
  @ApiOkResponse({ type: ProductTypeResponse })
  update(@Param('key') key: string, @Body() dto: UpdateProductTypeDto, @CurrentUser('id') actorId: string) {
    return this.productTypes.update(key, dto, actorId);
  }
}
