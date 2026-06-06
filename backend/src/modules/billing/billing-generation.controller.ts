/**
 * BillingGenerationController — nested generation under /v1/clients/{id}. — arch §6.9
 * Generating a statement/invoice requires billing:create; the global guard enforces it server-side.
 */
import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StatementService } from './statement.service';
import { InvoiceService } from './invoice.service';
import { GenerateBillingDto } from './dto/generate.dto';
import { ClientInvoiceResponse, ClientStatementResponse } from './dto/billing.response';

@ApiTags('Billing & Statements')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('clients')
export class BillingGenerationController {
  constructor(
    private readonly statements: StatementService,
    private readonly invoices: InvoiceService,
  ) {}

  @Post(':id/statements')
  @RequirePermission('billing', 'create')
  @ApiOperation({
    summary: 'Generate a client statement (one line per customer)',
    description:
      'Requires billing:create. Priced solely from client_billing_rates effective on each sale_date; ' +
      'no GST. Regenerating replaces the existing statement for the client+period (no duplicate).',
  })
  @ApiCreatedResponse({ type: ClientStatementResponse })
  generateStatement(
    @Param('id', ParseUUIDPipe) clientId: string,
    @Body() dto: GenerateBillingDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.statements.generate(clientId, dto.pay_period_id, actorId);
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
    return this.invoices.generate(clientId, dto.pay_period_id, actorId);
  }
}
