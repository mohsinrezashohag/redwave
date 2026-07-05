/**
 * BillingGenerationController — nested generation under /v1/clients/{id}. — arch §6.9
 * Generating a statement/invoice requires billing:create; the global guard enforces it server-side.
 */
import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StatementService } from './statement.service';
import { InvoiceService } from './invoice.service';
import { GenerateBillingDto } from './dto/generate.dto';
import { ClientInvoiceResponse, ClientStatementResponse, StatementPreviewResponse } from './dto/billing.response';

@ApiTags('Billing & Statements')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('clients')
export class BillingGenerationController {
  constructor(
    private readonly statements: StatementService,
    private readonly invoices: InvoiceService,
  ) {}

  @Post(':id/statements/preview')
  @HttpCode(200)
  @RequirePermission('billing', 'create')
  @ApiOperation({
    summary: 'Preview a statement (NOT persisted; no number minted)',
    description:
      'Requires billing:create. Returns the one-line-per-customer rows + total (CAD, no GST), priced ' +
      'from client_billing_rates. An unpriced product → 422 with unpriced[]. Use before generating.',
  })
  @ApiOkResponse({ type: StatementPreviewResponse })
  previewStatement(
    @Param('id', ParseUUIDPipe) clientId: string,
    @Body() dto: GenerateBillingDto,
  ) {
    return this.statements.preview(clientId, dto.pay_period_id);
  }

  @Post(':id/statements')
  @RequirePermission('billing', 'create')
  @ApiOperation({
    summary: 'Issue a client statement (one line per customer)',
    description:
      'Requires billing:create. Priced solely from client_billing_rates effective on each sale_date; ' +
      'no GST. ISSUES a NEW gapless-numbered immutable version; any prior version is marked superseded.',
  })
  @ApiCreatedResponse({ type: ClientStatementResponse })
  generateStatement(
    @Param('id', ParseUUIDPipe) clientId: string,
    @Body() dto: GenerateBillingDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.statements.generate(clientId, dto.pay_period_id, actorId, dto.fx_rate);
  }

  @Post(':id/invoices')
  @RequirePermission('billing', 'create')
  @ApiOperation({
    summary: 'Generate a one-line commission invoice',
    description:
      'Requires billing:create. total_commission = the client-billing statement total (billing stream ' +
      'only; never the rep commission payout). Regenerating replaces the existing invoice.',
  })
  @ApiCreatedResponse({ type: ClientInvoiceResponse })
  generateInvoice(
    @Param('id', ParseUUIDPipe) clientId: string,
    @Body() dto: GenerateBillingDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.invoices.generate(clientId, dto.pay_period_id, actorId, dto.fx_rate);
  }
}
