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
  ExportSalesDto,
  SaleExportFilters,
  SaleExportPageResponse,
  SaleExportResultResponse,
  SaleExportSummaryResponse,
} from './dto/sale-export.dto';
import { PaginationQuery } from '../../common/pagination/pagination.query';
import {
  ListSaleEditRequestsQuery,
  SaleEditRequestPageResponse,
  SaleEditRequestResponse,
} from './dto/sale-edit-request.dto';
import { ApproveSaleEditRequestDto, RejectSaleEditRequestDto } from './dto/update-sale.dto';
import {
  BulkValidateResultResponse,
  DeletedSaleResponse,
  SalePageResponse,
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
      'Requires sales:view. Paginated (page/limit/sort/search) + filters status/rep_id/client_id/date. Scoped per caller in the query.',
  })
  @ApiOkResponse({ type: SalePageResponse })
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

  // ── Sales export log (client request 2026-11-11). Declared BEFORE `:id`, which would otherwise capture
  // `/sales/exports`. ─────────────────────────────────────────────────────────────────────────────

  @Post('exports')
  @RequirePermission('sales', 'export')
  @ApiOperation({
    summary: 'Record a sales export and return its rows',
    description:
      'Requires sales:export. RECORDS the export first (who/when/format/filters/row count + exactly which sales), ' +
      'then returns the rows for the browser to build the file. only_new = sales never exported before ' +
      '(company-wide). Scoped like the list. More than 5000 matching sales → 422 (narrow the filters).',
  })
  @ApiCreatedResponse({ type: SaleExportResultResponse })
  exportSales(@Body() dto: ExportSalesDto, @CurrentUser() user: AuthUser) {
    return this.sales.exportSales(dto, user);
  }

  @Get('exports/summary')
  @RequirePermission('sales', 'export')
  @ApiOperation({
    summary: '"Last exported" + how many matching sales were never exported',
    description: 'Requires sales:export. Takes the sales list filters.',
  })
  @ApiOkResponse({ type: SaleExportSummaryResponse })
  exportSummary(@Query() filters: SaleExportFilters, @CurrentUser() user: AuthUser) {
    return this.sales.exportSummary(filters, user);
  }

  @Get('exports')
  @RequirePermission('sales', 'export')
  @ApiOperation({
    summary: 'Sales export history (newest first)',
    description: 'Requires sales:export. Paginated. Callers who see all sales see every export; others see their own.',
  })
  @ApiOkResponse({ type: SaleExportPageResponse })
  listExports(@Query() query: PaginationQuery, @CurrentUser() user: AuthUser) {
    return this.sales.listExports(query, user);
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
    summary: 'Edit a sale inside its 5-day window',
    description:
      'Requires sales:edit. Entered or validated sales only, within 5 days of entry (Winnipeg); otherwise 422. ' +
      'Customer name, address, products and greenfield are editable; client/sale_date/mpu_id/rep are not. ' +
      'Products re-run the entry rules (SALE-001a).',
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

  @Post(':id/approve-duplicate')
  @HttpCode(200)
  @RequirePermission('sales', 'approve')
  @ApiOperation({
    summary: 'Approve a possible duplicate (2026-11-16)',
    description:
      'Requires sales:approve. A sale entered with the same client + MPU as a live sale is held as a possible ' +
      'duplicate and cannot be validated until approved here. Scoped + audited; a repeat is a no-op.',
  })
  @ApiOkResponse({ type: SaleResponse })
  approveDuplicate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.sales.approveDuplicate(id, user);
  }

  @Post(':id/edit-requests')
  @RequirePermission('sales', 'view')
  @ApiOperation({
    summary: 'Request an edit to your own sale (2026-11-16)',
    description:
      'Requires sales:view and that the sale is the caller’s own. Same body and 5-day window as PATCH; ' +
      'stored as a pending request (only the changed fields) and the approvers are notified.',
  })
  @ApiCreatedResponse({ type: SaleEditRequestResponse })
  requestEdit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSaleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sales.requestEdit(id, dto, user);
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

/**
 * SaleEditRequestsController — /v1/sale-edit-requests. A rep's edit of their own sale waits here for an
 * admin/manager (sales:edit). Approving applies it through the same edit path (5-day window + status
 * re-checked in one transaction); rejecting keeps the sale as it is. Scoped like the sales list (§5).
 * — client meeting 2026-11-16
 */
@ApiTags('Sales & Validation')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('sale-edit-requests')
export class SaleEditRequestsController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  @RequirePermission('sales', 'edit')
  @ApiOperation({
    summary: 'List sale edit requests',
    description: 'Requires sales:edit. Paginated; filter by status (pending/approved/rejected); search by Sale ID or customer.',
  })
  @ApiOkResponse({ type: SaleEditRequestPageResponse })
  list(@Query() query: ListSaleEditRequestsQuery, @CurrentUser() user: AuthUser) {
    return this.sales.listEditRequests(query, user);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('sales', 'edit')
  @ApiOperation({ summary: 'Approve (apply) an edit request', description: 'Requires sales:edit. 422 once the window has closed.' })
  @ApiOkResponse({ type: SaleEditRequestResponse })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveSaleEditRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sales.approveEditRequest(id, dto.note, user);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('sales', 'edit')
  @ApiOperation({ summary: 'Reject an edit request', description: 'Requires sales:edit. The rep is notified with the note.' })
  @ApiOkResponse({ type: SaleEditRequestResponse })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectSaleEditRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sales.rejectEditRequest(id, dto.note, user);
  }
}
