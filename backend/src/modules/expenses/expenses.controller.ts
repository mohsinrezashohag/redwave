/**
 * Expenses controllers — /v1/expense-reports, /v1/expense-field-configs, /v1/expense-exports. — arch §6.8
 * Every endpoint declares its (expenses, action) permission; the global guard enforces it and the
 * services scope data per caller.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
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
import { ExpensesService } from './expenses.service';
import { FieldConfigService } from './field-config.service';
import { ExpenseExportService } from './expense-export.service';
import { CreateExpenseItemsDto } from './dto/create-items.dto';
import { UpdateExpenseItemDto } from './dto/update-item.dto';
import { ReviewDto } from './dto/review.dto';
import { BulkReviewDto } from './dto/bulk-review.dto';
import { ListExpenseItemsQuery } from './dto/list-items.query';
import { CreateFieldConfigDto, UpdateFieldConfigDto } from './dto/field-config.dto';
import { CreateExportDto } from './dto/export.dto';
import {
  BulkReviewResultResponse,
  ExpenseExportResponse,
  ExpenseItemPageResponse,
  ExpenseItemResponse,
  FieldConfigResponse,
  ReceiptUrlResponse,
  ValidationSummaryResponse,
} from './dto/expense.response';

@ApiTags('Expenses')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('expense-items')
export class ExpenseItemsController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post()
  @RequirePermission('expenses', 'create')
  @ApiOperation({
    summary: 'Create one or several expense items',
    description:
      'Requires expenses:create. Item-first — no report wrapper. Any user may submit (own by default). ' +
      'km items compute their amount server-side; non-km items require a receipt per the category config. ' +
      'Each item’s pay period is derived from its own expense_date (same-cycle payout, EXP-009).',
  })
  @ApiCreatedResponse({ type: ExpenseItemResponse, isArray: true })
  create(@Body() dto: CreateExpenseItemsDto, @CurrentUser() user: AuthUser) {
    return this.expenses.createItems(dto, user);
  }

  @Get()
  @RequirePermission('expenses', 'view')
  @ApiOperation({
    summary: 'List expense items',
    description:
      'Requires expenses:view. Paginated + scoped (own/roster/all); filters status/category/rep/client/' +
      'period/date-range and free-text search across the description.',
  })
  @ApiOkResponse({ type: ExpenseItemPageResponse })
  list(@Query() query: ListExpenseItemsQuery, @CurrentUser() user: AuthUser) {
    return this.expenses.list(query, user);
  }

  @Get('validation-summary')
  @RequirePermission('expenses', 'view')
  @ApiOperation({
    summary: 'Aggregate Alert/Warning flags across a scoped, filtered set',
    description:
      'Requires expenses:view (scoped). Returns the flagged/alert/warning counts over the same filters as the ' +
      'list (e.g. the approvals queue) — the interim home for the report-header count until the report rework (EXP-013).',
  })
  @ApiOkResponse({ type: ValidationSummaryResponse })
  validationSummary(@Query() query: ListExpenseItemsQuery, @CurrentUser() user: AuthUser) {
    return this.expenses.validationSummary(query, user);
  }

  @Post('bulk-review')
  @RequirePermission('expenses', 'approve')
  @ApiOperation({
    summary: 'Bulk review expense items',
    description:
      'Requires expenses:approve. Applies one decision (approve | reject | send_back) to many items; ' +
      'items not in a reviewable status (or out of scope) are skipped.',
  })
  @ApiCreatedResponse({ type: BulkReviewResultResponse })
  bulkReview(@Body() dto: BulkReviewDto, @CurrentUser() user: AuthUser) {
    return this.expenses.bulkReview(dto, user);
  }

  @Get(':id/receipt-url')
  @RequirePermission('expenses', 'view')
  @ApiOperation({
    summary: 'Get an access-controlled URL for the item’s receipt',
    description:
      'Requires expenses:view + the SAME item visibility as the detail GET. Returns a fresh 60s signed URL ' +
      'for the stored receipt path; 404 when the item has no receipt; 503 when storage is not configured.',
  })
  @ApiOkResponse({ type: ReceiptUrlResponse })
  receiptUrl(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.expenses.receiptUrl(id, user);
  }

  @Get(':id')
  @RequirePermission('expenses', 'view')
  @ApiOperation({ summary: 'Get an expense item', description: 'Requires expenses:view (scoped).' })
  @ApiOkResponse({ type: ExpenseItemResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.expenses.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermission('expenses', 'edit')
  @ApiOperation({
    summary: 'Edit an expense item',
    description:
      'Requires expenses:edit. Editable pre-approval; once approved, only a Super Admin may edit (EXP-007). ' +
      'The full item content is re-submitted and replaces the item (km log re-derived).',
  })
  @ApiOkResponse({ type: ExpenseItemResponse })
  edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expenses.editItem(id, dto, user);
  }

  @Delete(':id')
  @RequirePermission('expenses', 'delete')
  @ApiOperation({
    summary: 'Delete an expense item',
    description: 'Requires expenses:delete. Only a not-yet-approved item may be removed (scoped).',
  })
  @ApiOkResponse({ description: 'Deleted.' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.expenses.deleteItem(id, user);
  }

  @Post(':id/review')
  @RequirePermission('expenses', 'approve')
  @ApiOperation({
    summary: 'Review an expense item',
    description: 'Requires expenses:approve. decision = approve | reject | send_back.',
  })
  @ApiCreatedResponse({ type: ExpenseItemResponse })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expenses.review(id, dto, user);
  }
}

@ApiTags('Expenses')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('expense-field-configs')
export class ExpenseFieldConfigsController {
  constructor(private readonly configs: FieldConfigService) {}

  @Get()
  @RequirePermission('expenses', 'view')
  @ApiOperation({ summary: 'List expense category configs', description: 'Requires expenses:view.' })
  @ApiOkResponse({ type: FieldConfigResponse, isArray: true })
  list() {
    return this.configs.list();
  }

  @Post()
  @RequirePermission('expenses', 'edit')
  @ApiOperation({
    summary: 'Add / configure an expense category',
    description: 'Requires expenses:edit. Sets label, requires_receipt, is_active for a category key.',
  })
  @ApiCreatedResponse({ type: FieldConfigResponse })
  create(@Body() dto: CreateFieldConfigDto, @CurrentUser() user: AuthUser) {
    return this.configs.create(dto, user);
  }

  @Patch(':key')
  @RequirePermission('expenses', 'edit')
  @ApiOperation({
    summary: 'Update an expense category config (label / receipt rule / active / per-type fields / soft cap)',
    description: 'Requires expenses:edit. The category_key is immutable; sends only the changed properties.',
  })
  @ApiOkResponse({ type: FieldConfigResponse })
  update(@Param('key') key: string, @Body() dto: UpdateFieldConfigDto, @CurrentUser() user: AuthUser) {
    return this.configs.update(key, dto, user);
  }
}

@ApiTags('Expenses')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('expense-exports')
export class ExpenseExportsController {
  constructor(private readonly exports: ExpenseExportService) {}

  @Get()
  @RequirePermission('expenses', 'view')
  @ApiOperation({ summary: 'List expense exports', description: 'Requires expenses:view.' })
  @ApiOkResponse({ type: ExpenseExportResponse, isArray: true })
  list() {
    return this.exports.list();
  }

  @Post()
  @RequirePermission('expenses', 'export')
  @ApiOperation({
    summary: 'Generate an expense export',
    description: 'Requires expenses:export. Records the request with a stubbed file_url (generation deferred).',
  })
  @ApiCreatedResponse({ type: ExpenseExportResponse })
  create(@Body() dto: CreateExportDto, @CurrentUser() user: AuthUser) {
    return this.exports.generate(dto, user);
  }
}

// NOTE: the legacy POST /v1/expense-receipts controller is GONE — receipts now upload through the unified
// POST /v1/files pipeline (purpose=receipt): server-generated path, stored_files metadata, claim-validated
// at item create/edit, served via GET /v1/expense-items/{id}/receipt-url (60s signed URL).
