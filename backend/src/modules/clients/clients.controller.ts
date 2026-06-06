/**
 * ClientsController — /v1/clients and its nested products & billing-rates. — arch §6.3
 * Every route declares its (clients, action) permission; the global guard enforces it server-side.
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
import { ClientsService } from './clients.service';
import { ProductsService } from './products.service';
import { BillingRatesService } from './billing-rates.service';
import { CreateClientDto, ListClientsQuery, UpdateClientDto } from './dto/client.dto';
import { CreateProductDto, ListProductsQuery } from './dto/product.dto';
import { CreateBillingRateDto, ListBillingRatesQuery } from './dto/billing-rate.dto';
import { BillingRateResponse, ClientResponse, ProductResponse } from './dto/client.response';

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
  @ApiOperation({ summary: 'List clients', description: 'Requires clients:view. ?status filter.' })
  @ApiOkResponse({ type: ClientResponse, isArray: true })
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
  @ApiOperation({ summary: 'Create a per-client product', description: 'Requires clients:edit.' })
  @ApiCreatedResponse({ type: ProductResponse })
  createProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProductDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.products.create(id, dto, actorId);
  }

  // ── Nested: billing rates (effective-dated) ─────────────────────────────────────────────────

  @Get(':id/billing-rates')
  @RequirePermission('clients', 'view')
  @ApiOperation({
    summary: "List a client's billing rates (current + pending)",
    description:
      'Requires clients:view. ?effectiveOn returns the rate in force per scope on a date.',
  })
  @ApiOkResponse({ type: BillingRateResponse, isArray: true })
  listBillingRates(@Param('id', ParseUUIDPipe) id: string, @Query() query: ListBillingRatesQuery) {
    return this.billingRates.list(id, query);
  }

  @Post(':id/billing-rates')
  @RequirePermission('clients', 'edit')
  @ApiOperation({
    summary: 'Add an effective-dated billing rate',
    description: 'Requires clients:edit. Supersedes the scope’s pending rate; back-dating → 422.',
  })
  @ApiCreatedResponse({ type: BillingRateResponse })
  createBillingRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBillingRateDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.billingRates.create(id, dto, actorId);
  }
}
