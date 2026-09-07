/**
 * MarginController — /v1/margin: per-sale margin and the rates in force.
 *
 * Margin exposes what Redwave earns on every sale, so it is Super Admin only. The controller declares
 * `reports:business` (already Super-Admin-only and off the module grid) and the SERVICE re-checks
 * `isSuperAdmin` and audits the denial — a decorator alone would let a future role grant leak it.
 *
 * Every read here is read-only and crosses invariant #3 under the conditions packet 07 sets out; the
 * reasoning lives at the join site in `margin.service.ts`. No value produced here may feed a rate, a
 * commission or a document.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { MarginService } from './margin.service';
import { MarginQuery, MarginRollupQuery, RatesInForceQuery } from './dto/margin.query';
import { MarginGroupResponse, MarginRowResponse, RateInForceResponse } from './dto/margin.response';

@ApiTags('Reporting & Dashboards')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('margin')
export class MarginController {
  constructor(private readonly margin: MarginService) {}

  @Get('per-sale')
  @RequirePermission('reports', 'business')
  @ApiOperation({
    summary: 'Per-sale margin — client bill vs rep pay, and the spread',
    description:
      'Super Admin only. Both sides are FROZEN (issued statement lines and finalized payroll lines), ' +
      'joined in memory on sale_id — there is no database relation between the two rate streams (#3). ' +
      'Rows carry their document currency and are never converted (#12).',
  })
  @ApiOkResponse({ type: MarginRowResponse, isArray: true })
  perSale(@Query() query: MarginQuery, @CurrentUser() user: AuthUser) {
    return this.margin.perSale(user, query.from, query.to, query.client_id);
  }

  @Get('rollup')
  @RequirePermission('reports', 'business')
  @ApiOperation({
    summary: 'Margin rolled up by product, client or rep',
    description:
      'Super Admin only. Grouped by currency as well as the chosen dimension, so two currencies are ' +
      'never summed together (#12).',
  })
  @ApiOkResponse({ type: MarginGroupResponse, isArray: true })
  rollup(@Query() query: MarginRollupQuery, @CurrentUser() user: AuthUser) {
    return this.margin.rollup(user, query.from, query.to, query.by, query.client_id);
  }

  @Get('rates-in-force')
  @RequirePermission('reports', 'business')
  @ApiOperation({
    summary: 'Client rate and rep rate side by side, with their effective dates',
    description:
      'Super Admin only. Answers what we charge and what we pay for a product TODAY, which the per-sale ' +
      'view cannot for a product that has not sold. A tiered product reports every bracket, because its ' +
      'rep rate depends on the period volume — there is no single number.',
  })
  @ApiOkResponse({ type: RateInForceResponse, isArray: true })
  ratesInForce(@Query() query: RatesInForceQuery, @CurrentUser() user: AuthUser) {
    return this.margin.ratesInForce(user, query.on, query.client_id);
  }
}
