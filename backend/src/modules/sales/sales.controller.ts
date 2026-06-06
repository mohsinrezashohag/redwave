/**
 * SalesController — /v1/sales. — arch §6.5
 * Every route declares its (sales, action) permission; the global guard enforces it, and the
 * service additionally scopes data per caller (rep=own / manager=roster / admin=all).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
import { AuthUser } from '../../common/rbac/auth-user.type';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { ValidateSaleDto } from './dto/validate-sale.dto';
import { SetGreenfieldDto } from './dto/greenfield.dto';
import { BulkValidateDto } from './dto/bulk-validate.dto';
import { ListSalesQuery } from './dto/list-sales.query';
import {
  BulkValidateResultResponse,
  DeletedSaleResponse,
  SaleResponse,
} from './dto/sale.response';

@ApiTags('Sales & Validation')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post()
  @RequirePermission('sales', 'create')
  @ApiOperation({
    summary: 'Enter a sale',
    description: 'Requires sales:create. Server generates the Sale ID; item snapshots stay NULL.',
  })
  @ApiCreatedResponse({ type: SaleResponse })
  create(@Body() dto: CreateSaleDto, @CurrentUser() user: AuthUser) {
    return this.sales.create(dto, user);
  }

  @Get()
  @RequirePermission('sales', 'view')
  @ApiOperation({
    summary: 'List sales',
    description:
      'Requires sales:view. Filters status/rep_id/client_id/date. Scoped per caller in the query.',
  })
  @ApiOkResponse({ type: SaleResponse, isArray: true })
  list(@Query() query: ListSalesQuery, @CurrentUser() user: AuthUser) {
    return this.sales.list(query, user);
  }

  @Post('bulk-validate')
  @HttpCode(200)
  @RequirePermission('sales', 'approve')
  @ApiOperation({
    summary: 'Batch-validate selected sales (queue bulk-select)',
    description:
      'Requires sales:approve. NOT a file upload — client-report ingestion is the Import module.',
  })
  @ApiOkResponse({ type: BulkValidateResultResponse })
  bulkValidate(@Body() dto: BulkValidateDto, @CurrentUser() user: AuthUser) {
    return this.sales.bulkValidate(dto, user);
  }

  @Get(':id')
  @RequirePermission('sales', 'view')
  @ApiOperation({
    summary: 'Get a sale',
    description: 'Requires sales:view. Includes items + derived pay period.',
  })
  @ApiOkResponse({ type: SaleResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.sales.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermission('sales', 'edit')
  @ApiOperation({
    summary: 'Edit an entered sale',
    description: 'Requires sales:edit. Only Entered sales; client/sale_date/mpu_id are immutable.',
  })
  @ApiOkResponse({ type: SaleResponse })
  edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSaleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sales.edit(id, dto, user);
  }

  @Post(':id/validate')
  @HttpCode(200)
  @RequirePermission('sales', 'approve')
  @ApiOperation({
    summary: 'Validate a sale (entered → validated)',
    description:
      'Requires sales:approve. Approval gate; never changes the pay period. Optional greenfield confirm.',
  })
  @ApiOkResponse({ type: SaleResponse })
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValidateSaleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sales.validate(id, dto, user);
  }

  @Post(':id/greenfield')
  @HttpCode(200)
  @RequirePermission('sales', 'approve')
  @ApiOperation({
    summary: 'Confirm/clear greenfield (PROPOSED — SRS §17)',
    description:
      'Requires sales:approve. PROPOSED two-step; recomputes counts_toward_tally. Pay Run consumes at close.',
  })
  @ApiOkResponse({ type: SaleResponse })
  setGreenfield(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetGreenfieldDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sales.setGreenfield(id, dto, user);
  }

  @Delete(':id')
  @RequirePermission('sales', 'delete')
  @ApiOperation({
    summary: 'Delete a pre-payout sale (soft)',
    description:
      'Requires sales:delete. entered|validated → status=deleted (row preserved); rejected once paid.',
  })
  @ApiOkResponse({ type: DeletedSaleResponse })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.sales.remove(id, user);
  }
}
