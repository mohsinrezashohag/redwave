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
import { FlatRateService } from './flat-rate.service';
import { IncentiveService } from './incentive.service';
import { ProductTypeService } from './product-type.service';
import { CreateFlatRateDto, ListFlatRatesQuery, UpdateFlatRateDto } from './dto/flat-rate.dto';
import { CreateIncentiveDto, ListIncentivesQuery, UpdateIncentiveDto } from './dto/incentive.dto';
import { CreateProductTypeDto, ListProductTypesQuery, UpdateProductTypeDto } from './dto/product-type.dto';
import {
  FlatRateResponse,
  IncentiveResponse,
} from './dto/commission.response';
import { ProductTypeResponse } from './dto/product-type.response';

@ApiTags('Commission Config')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('commission')
export class CommissionController {
  constructor(
    private readonly flatRates: FlatRateService,
  ) {}

  // ── Rep rates (one flat rate per item; no tiers since 2026-11-13) ────────────────────────────────────────────────────────────────────────────────

  @Get('flat-rates')
  @RequirePermission('commission', 'view')
  @ApiOperation({
    summary: 'Rep rates (current + pending)',
    description:
      'Requires commission:view. A rate is per product type (product_id null) or for one product, globally ' +
      '(client_id null) or for one client. Most specific wins: client+product → product → client+type → type.',
  })
  @ApiOkResponse({ type: FlatRateResponse, isArray: true })
  listFlatRates(@Query() query: ListFlatRatesQuery) {
    return this.flatRates.list(query);
  }

  @Post('flat-rates')
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Set an effective-dated rep rate',
    description:
      'Requires commission:edit. Any product type (internet, greenfield_internet, add-ons), optionally for one ' +
      'product. Back-dating is rejected (422) — a closed period is never rewritten (#10).',
  })
  @ApiCreatedResponse({ type: FlatRateResponse })
  createFlatRate(@Body() dto: CreateFlatRateDto, @CurrentUser('id') actorId: string) {
    return this.flatRates.create(dto, actorId);
  }

  @Patch('flat-rates/:id')
  @RequirePermission('commission', 'edit')
  @ApiOperation({
    summary: 'Edit a PENDING rep rate',
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
    summary: 'Delete a PENDING rep rate',
    description: 'Requires commission:edit. Only a pending rate can be deleted; current/past → 422.',
  })
  @ApiNoContentResponse()
  removeFlatRate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.flatRates.remove(id, actorId);
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
      'Requires product_types:edit. behaviour is forced standard_addon — a new type can never be internet/' +
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
