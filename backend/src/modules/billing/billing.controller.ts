/**
 * Billing read + download/export controllers — /v1/statements and /v1/invoices. — arch §6.9
 *
 * Listing/detail/download require billing:view; a recorded export requires billing:export. Downloads + exports
 * stream the REAL rendered file (Excel / PDF / QuickBooks CSV) from the FROZEN, immutable record. Billing is
 * per-CLIENT partner data, gated by billing:* (no rep scoping).
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StatementService } from './statement.service';
import { InvoiceService } from './invoice.service';
import { BillingExportService, RenderedFile, StatementFormat } from './billing-export.service';
import { ListBillingQuery } from './dto/list.query';
import { StatementExportDto } from './dto/export.dto';
import { BillingPeriodResponse, ClientInvoiceResponse, ClientStatementResponse } from './dto/billing.response';

/** Stream a rendered file as a download attachment. */
function sendFile(res: Response, file: RenderedFile): void {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Content-Length', String(file.bytes.length));
  res.end(file.bytes);
}

@ApiTags('Billing & Statements')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('statements')
export class StatementsController {
  constructor(
    private readonly statements: StatementService,
    private readonly exports: BillingExportService,
  ) {}

  @Get()
  @RequirePermission('billing', 'view')
  @ApiOperation({ summary: 'List generated statements (every version; newest first)', description: 'Requires billing:view.' })
  @ApiOkResponse({ type: ClientStatementResponse, isArray: true })
  list(@Query() query: ListBillingQuery) {
    return this.statements.list(query);
  }

  @Get(':id')
  @RequirePermission('billing', 'view')
  @ApiOperation({ summary: 'Get a statement with its lines', description: 'Requires billing:view.' })
  @ApiOkResponse({ type: ClientStatementResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.statements.findOne(id);
  }

  @Get(':id/download')
  @RequirePermission('billing', 'view')
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv')
  @ApiOperation({
    summary: 'Download the statement file (re-render from the frozen record)',
    description: 'Requires billing:view. ?format=excel (default) | quickbooks. Streams the file.',
  })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const fmt: StatementFormat = format === 'quickbooks' ? 'quickbooks' : 'excel';
    sendFile(res, await this.exports.renderStatement(id, fmt));
  }

  @Post(':id/export')
  @RequirePermission('billing', 'export')
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv')
  @ApiOperation({
    summary: 'Export a statement (records a billing_exports artifact + streams the file)',
    description: 'Requires billing:export. format=excel|quickbooks. Records the export; streams the file.',
  })
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatementExportDto,
    @CurrentUser('id') actorId: string,
    @Res() res: Response,
  ): Promise<void> {
    sendFile(res, await this.exports.exportStatement(id, dto.format, actorId));
  }
}

/**
 * The weekly billing calendar the UI picks from. Read-only + seeded, exactly like pay periods — Redwave
 * bills a fixed Mon–Sun week, so there is nothing to create by hand.
 */
@ApiTags('Billing & Statements')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('billing-periods')
export class BillingPeriodsController {
  constructor(private readonly statements: StatementService) {}

  @Get()
  @RequirePermission('billing', 'view')
  @ApiOperation({
    summary: 'List the billing weeks ("Bill 17", Mon–Sun)',
    description: 'Requires billing:view. Separate from pay periods — a bill straddles two of them.',
  })
  @ApiOkResponse({ type: BillingPeriodResponse, isArray: true })
  list() {
    return this.statements.listPeriods();
  }
}

@ApiTags('Billing & Statements')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoiceService,
    private readonly exports: BillingExportService,
  ) {}

  @Get()
  @RequirePermission('billing', 'view')
  @ApiOperation({ summary: 'List generated invoices (every version; newest first)', description: 'Requires billing:view.' })
  @ApiOkResponse({ type: ClientInvoiceResponse, isArray: true })
  list(@Query() query: ListBillingQuery) {
    return this.invoices.list(query);
  }

  @Get(':id')
  @RequirePermission('billing', 'view')
  @ApiOperation({ summary: 'Get an invoice', description: 'Requires billing:view.' })
  @ApiOkResponse({ type: ClientInvoiceResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.findOne(id);
  }

  @Get(':id/download')
  @RequirePermission('billing', 'view')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Download the invoice PDF (re-render from the frozen record)', description: 'Requires billing:view.' })
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    sendFile(res, await this.exports.renderInvoice(id));
  }

  @Post(':id/export')
  @RequirePermission('billing', 'export')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Export an invoice PDF (records a billing_exports artifact + streams it)', description: 'Requires billing:export.' })
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actorId: string,
    @Res() res: Response,
  ): Promise<void> {
    sendFile(res, await this.exports.exportInvoice(id, actorId));
  }
}
