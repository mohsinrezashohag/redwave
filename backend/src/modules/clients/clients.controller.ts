/**
 * ClientsController — /v1/clients and its nested products & billing-rates. — arch §6.3
 * Every route declares its (clients, action) permission; the global guard enforces it server-side.
 */
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { AuthUser } from '../../common/rbac/auth-user.type';
import { ClientsService } from './clients.service';
import { ProductsService } from './products.service';
import { BillingRatesService } from './billing-rates.service';
import { CreateClientDto, ListClientsQuery, UpdateClientDto } from './dto/client.dto';
import { CreateProductDto, ListProductsQuery } from './dto/product.dto';
import { CreateBillingRateDto, ListBillingRatesQuery, UpdateBillingRateDto } from './dto/billing-rate.dto';
import { BillingRateResponse, ClientPageResponse, ClientResponse, ProductResponse } from './dto/client.response';

@ApiTags('Clients & Products')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly products: ProductsService,
    private readonly billingRates: BillingRatesService,
  ) {}

  @Get()
  @RequirePermission('clients', 'view')
  @ApiOperation({
    summary: 'List clients',
    description: 'Requires clients:view. Paginated (page/limit/sort/search) + ?status filter.',
  })
  @ApiOkResponse({ type: ClientPageResponse })
  list(@Query() query: ListClientsQuery) {
    return this.clients.findAll(query);
  }

  @Post()
  @RequirePermission('clients', 'create')
  @ApiOperation({
    summary: 'Create a client',
    description: 'Requires clients:create. Unique code → 409.',
  })
  @ApiCreatedResponse({ type: ClientResponse })
  create(@Body() dto: CreateClientDto, @CurrentUser('id') actorId: string) {
    return this.clients.create(dto, actorId);
  }

  @Get(':id')
  @RequirePermission('clients', 'view')
  @ApiOperation({ summary: 'Get a client', description: 'Requires clients:view.' })
  @ApiOkResponse({ type: ClientResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('clients', 'edit')
  @ApiOperation({
    summary: 'Edit / deactivate a client',
    description: 'Requires clients:edit. is_active=false soft-deactivates.',
  })
  @ApiOkResponse({ type: ClientResponse })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.clients.update(id, dto, actorId);
  }

  // ── Nested: products ────────────────────────────────────────────────────────────────────────

  @Get(':id/products')
  @RequirePermission('clients', 'view')
  @ApiOperation({ summary: "List a client's products", description: 'Requires clients:view.' })
  @ApiOkResponse({ type: ProductResponse, isArray: true })
  listProducts(@Param('id', ParseUUIDPipe) id: string, @Query() query: ListProductsQuery) {
    return this.products.findAllForClient(id, query);
  }

  @Post(':id/products')
  @RequirePermission('clients', 'edit')
  @ApiOperation({
    summary: 'Create a per-client product',
    description:
      'Requires clients:edit. An optional initial_billing_rate ADDITIONALLY requires billing_rates:create ' +
      '(the rate is a billing-stream write — #3).',
  })
  @ApiCreatedResponse({ type: ProductResponse })
  createProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProductDto,
    @CurrentUser() user: AuthUser,
  ) {
    // The product create is gated clients:edit; setting an inline billing rate is the stricter billing-stream
    // gate — checked here so a clients:edit-only caller can still create a product (without a rate).
    if (dto.initial_billing_rate && !user.permissions.has('billing_rates:create')) {
      throw new ForbiddenException('Setting an initial billing rate requires billing_rates:create');
    }
    return this.products.create(id, dto, user.id);
  }

  // ── Nested: billing rates (effective-dated) ─────────────────────────────────────────────────

  @Get(':id/billing-rates')
  @RequirePermission('billing_rates', 'view')
  @ApiOperation({
    summary: "List a client's billing rates (current + pending)",
    description:
      'Requires billing_rates:view (Super Admin only by default — sensitive partner financials). ' +
      '?effectiveOn returns the rate in force per scope on a date.',
  })
  @ApiOkResponse({ type: BillingRateResponse, isArray: true })
  listBillingRates(@Param('id', ParseUUIDPipe) id: string, @Query() query: ListBillingRatesQuery) {
    return this.billingRates.list(id, query);
  }

  @Post(':id/billing-rates')
  @RequirePermission('billing_rates', 'create')
  @ApiOperation({
    summary: 'Add an effective-dated billing rate',
    description: 'Requires billing_rates:create. Supersedes the scope’s pending rate; back-dating → 422.',
  })
  @ApiCreatedResponse({ type: BillingRateResponse })
  createBillingRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBillingRateDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.billingRates.create(id, dto, actorId);
  }

  @Patch(':id/billing-rates/:rateId')
  @RequirePermission('billing_rates', 'edit')
  @ApiOperation({
    summary: 'Edit a PENDING billing rate',
    description:
      'Requires billing_rates:edit. Only a pending (not-yet-effective) rate can be edited; a current/past ' +
      'rate is immutable — supersede it with a new future-dated rate instead (→ 422).',
  })
  @ApiOkResponse({ type: BillingRateResponse })
  updateBillingRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rateId', ParseUUIDPipe) rateId: string,
    @Body() dto: UpdateBillingRateDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.billingRates.update(id, rateId, dto, actorId);
  }

  @Delete(':id/billing-rates/:rateId')
  @RequirePermission('billing_rates', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a PENDING billing rate',
    description:
      'Requires billing_rates:delete. Only a pending rate can be deleted; a current/past rate is immutable ' +
      '(→ 422).',
  })
  @ApiNoContentResponse()
  removeBillingRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rateId', ParseUUIDPipe) rateId: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.billingRates.remove(id, rateId, actorId);
  }
}
