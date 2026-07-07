/**
 * Client EXPENSE billing document controllers (BILL-012 / EXP-014). — arch §6.9
 *
 * Generation is nested under /v1/clients/{id}/expense-documents (billing:create); read/download/export live at
 * /v1/expense-documents (billing:view / billing:export) — mirroring statements/invoices. Downloads render the
 * REAL PDF from the FROZEN, immutable record. Per-CLIENT partner data, gated by billing:* (no rep scoping).
 * NO new permission (reuses the billing grid).
 */
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BillingExportService, RenderedFile } from './billing-export.service';
import { ClientExpenseDocService } from './expense-doc.service';
import { GenerateExpenseDocDto } from './dto/expense-doc.dto';
import { ListBillingQuery } from './dto/list.query';
import { ClientExpenseDocumentResponse, ExpenseDocPreviewResponse } from './dto/expense-doc.response';

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
@Controller('clients')
export class ExpenseDocGenerationController {
  constructor(private readonly docs: ClientExpenseDocService) {}

  @Post(':id/expense-documents/preview')
  @HttpCode(200)
  @RequirePermission('billing', 'create')
  @ApiOperation({
    summary: 'Preview a client expense document (NOT persisted; no number minted)',
    description:
      'Requires billing:create. Returns the grouped km + food lines (per rep/day) + total in the client currency, ' +
      'plus any food excluded for a currency mismatch. A km item with no client-bill rate → 422.',
  })
  @ApiOkResponse({ type: ExpenseDocPreviewResponse })
  preview(@Param('id', ParseUUIDPipe) clientId: string, @Body() dto: GenerateExpenseDocDto) {
    return this.docs.preview(clientId, dto.pay_period_id, { rep_ids: dto.rep_ids, dates: dto.dates });
  }

  @Post(':id/expense-documents')
  @RequirePermission('billing', 'create')
  @ApiOperation({
    summary: 'Issue a client expense document (km + food only, per rep/day)',
    description:
      'Requires billing:create. km is priced from the CLIENT-BILL km rate; food is native-currency (mismatches ' +
      'excluded). No receipts, no commission (#3). ISSUES a NEW gapless CEXP-numbered immutable version; any prior ' +
      'version is marked superseded. FX is frozen at issue (#12).',
  })
  @ApiCreatedResponse({ type: ClientExpenseDocumentResponse })
  generate(
    @Param('id', ParseUUIDPipe) clientId: string,
    @Body() dto: GenerateExpenseDocDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.docs.generate(clientId, dto.pay_period_id, actorId, { rep_ids: dto.rep_ids, dates: dto.dates }, dto.fx_rate);
  }
}

@ApiTags('Billing & Statements')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('expense-documents')
export class ExpenseDocumentsController {
  constructor(
    private readonly docs: ClientExpenseDocService,
    private readonly exports: BillingExportService,
  ) {}

  @Get()
  @RequirePermission('billing', 'view')
  @ApiOperation({ summary: 'List expense documents (every version; newest first)', description: 'Requires billing:view.' })
  @ApiOkResponse({ type: ClientExpenseDocumentResponse, isArray: true })
  list(@Query() query: ListBillingQuery) {
    return this.docs.list(query);
  }

  @Get(':id')
  @RequirePermission('billing', 'view')
  @ApiOperation({ summary: 'Get an expense document (with its frozen line detail)', description: 'Requires billing:view.' })
  @ApiOkResponse({ type: ClientExpenseDocumentResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.docs.findOne(id);
  }

  @Get(':id/download')
  @RequirePermission('billing', 'view')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Download the expense document PDF (re-render from the frozen record)', description: 'Requires billing:view.' })
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    sendFile(res, await this.exports.renderExpenseDoc(id));
  }

  @Post(':id/export')
  @RequirePermission('billing', 'export')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Export the expense document PDF (records a billing_exports artifact + streams it)', description: 'Requires billing:export.' })
  async export(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string, @Res() res: Response): Promise<void> {
    sendFile(res, await this.exports.exportExpenseDoc(id, actorId));
  }
}
