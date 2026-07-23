/**
 * ReconciliationController — /v1/reconciliation: finance's tie-out. Statement tie-out is gated by
 * billing:view; pay-run tie-out by payrun:view (no new permission). Read-only. — arch §6.9
 */
import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ReconciliationService } from './reconciliation.service';
import { StatementReconciliationQuery } from './dto/reconciliation.dto';
import { PayRunTieOutResponse, StatementTieOutResponse } from './dto/reconciliation.response';

@ApiTags('Reconciliation')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get('statements')
  @RequirePermission('billing', 'view')
  @ApiOperation({
    summary: 'Tie a client statement to its lines and the live re-priced sales',
    description: 'Requires billing:view. statement total = Σ lines = Σ live sales × billing rates; flags drift.',
  })
  @ApiOkResponse({ type: StatementTieOutResponse })
  statements(@Query() query: StatementReconciliationQuery) {
    return this.reconciliation.statementTieOut(query.client_id, query.billing_period_id);
  }

  @Get('pay-runs/:id')
  @RequirePermission('payrun', 'view')
  @ApiOperation({
    summary: 'Tie a pay run to its lines (net = components; run total = Σ net)',
    description: 'Requires payrun:view. Recomputes each line’s net from its components and flags any mismatch.',
  })
  @ApiOkResponse({ type: PayRunTieOutResponse })
  payRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.reconciliation.payRunTieOut(id);
  }
}
