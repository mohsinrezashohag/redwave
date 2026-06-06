/**
 * Expenses controllers — /v1/expense-reports, /v1/expense-field-configs, /v1/expense-exports. — arch §6.8
 * Every endpoint declares its (expenses, action) permission; the global guard enforces it and the
 * services scope data per caller.
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
import { AuthUser } from '../../common/rbac/auth-user.type';
import { ExpensesService } from './expenses.service';
import { FieldConfigService } from './field-config.service';
import { ExpenseExportService } from './expense-export.service';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { ReviewDto } from './dto/review.dto';
import { ListReportsQuery } from './dto/list-reports.query';
import { CreateFieldConfigDto } from './dto/field-config.dto';
import { CreateExportDto } from './dto/export.dto';
import {
  ExpenseExportResponse,
  ExpenseReportResponse,
  FieldConfigResponse,
} from './dto/expense.response';

@ApiTags('Expenses')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('expense-reports')
export class ExpenseReportsController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post()
  @RequirePermission('expenses', 'create')
  @ApiOperation({
    summary: 'Submit a weekly expense report',
    description:
      'Requires expenses:create. Any user may submit (own by default). km items compute their amount; ' +
      'non-km items require a receipt per the category config. The pay period is derived from week_start.',
  })
  @ApiCreatedResponse({ type: ExpenseReportResponse })
  create(@Body() dto: CreateReportDto, @CurrentUser() user: AuthUser) {
    return this.expenses.submit(dto, user);
  }

  @Get()
  @RequirePermission('expenses', 'view')
  @ApiOperation({
    summary: 'List expense reports',
    description: 'Requires expenses:view. Scoped (own/roster/all); filters status/rep/client/period/date.',
  })
  @ApiOkResponse({ type: ExpenseReportResponse, isArray: true })
  list(@Query() query: ListReportsQuery, @CurrentUser() user: AuthUser) {
    return this.expenses.list(query, user);
  }

  @Get(':id')
  @RequirePermission('expenses', 'view')
  @ApiOperation({ summary: 'Get an expense report', description: 'Requires expenses:view (scoped).' })
  @ApiOkResponse({ type: ExpenseReportResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.expenses.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermission('expenses', 'edit')
  @ApiOperation({
    summary: 'Edit an expense report',
    description:
      'Requires expenses:edit. Editable pre-approval; once approved, only a Super Admin may edit. ' +
      'Supplying items replaces the report lines wholesale.',
  })
  @ApiOkResponse({ type: ExpenseReportResponse })
  edit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReportDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.expenses.edit(id, dto, user);
  }

  @Post(':id/approve')
  @RequirePermission('expenses', 'approve')
  @ApiOperation({
    summary: 'Review an expense report',
    description: 'Requires expenses:approve. decision = approve | reject | send_back.',
  })
  @ApiCreatedResponse({ type: ExpenseReportResponse })
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
