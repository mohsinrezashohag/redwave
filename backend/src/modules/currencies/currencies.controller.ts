/**
 * CurrenciesController — GET /v1/currencies. Authenticated REFERENCE read (no special permission, like the
 * product-type catalogue): drives the billing-currency picker on the client form + the per-item currency
 * picker on the expense form. — Meeting 3
 */
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { CurrenciesService } from './currencies.service';
import { CurrencyResponse } from './dto/currency.response';

@ApiTags('Currencies')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  @Get()
  @ApiOperation({
    summary: 'List active currencies (catalogue)',
    description: 'Authenticated reference read (no permission) — the allowed billing/expense currencies.',
  })
  @ApiOkResponse({ type: CurrencyResponse, isArray: true })
  list() {
    return this.currencies.list();
  }
}
