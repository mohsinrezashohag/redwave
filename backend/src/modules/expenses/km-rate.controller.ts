/**
 * KmRateController — /v1/km-rates. The per-client, effective-dated kilometre rate (Meeting 3, EXP-004).
 * Read gated km_rates:view; write (append a future-dated rate / delete a pending one) gated km_rates:edit
 * — it's an org-config surface with its OWN RBAC module (previously piggybacked on expenses:view/edit), so a
 * role can be granted km-rate management without all Expenses access. The rep-stream rate drives the km
 * amount paid to reps; the client_bill stream is stored for the client expense document.
 */
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { KmRateService } from './km-rate.service';
import { CreateKmRateDto, ListKmRatesQuery } from './dto/km-rate.dto';
import { KmRateResponse } from './dto/km-rate.response';

@ApiTags('Expenses')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('km-rates')
export class KmRateController {
  constructor(private readonly kmRates: KmRateService) {}

  @Get()
  @RequirePermission('km_rates', 'view')
  @ApiOperation({
    summary: 'List effective-dated km rates',
    description: 'Requires km_rates:view. Filter by stream / client / status. Each row carries its server-derived status.',
  })
  @ApiOkResponse({ type: KmRateResponse, isArray: true })
  list(@Query() query: ListKmRatesQuery) {
    return this.kmRates.list(query);
  }

  @Post()
  @RequirePermission('km_rates', 'edit')
  @ApiOperation({
    summary: 'Add an effective-dated km rate',
    description:
      'Requires km_rates:edit. Appends a new future-dated rate for the (stream, client) scope: it supersedes ' +
      'the scope’s pending row and bounds the current one. Back-dating is rejected (422). Omit client_id for the global default.',
  })
  @ApiCreatedResponse({ type: KmRateResponse })
  create(@Body() dto: CreateKmRateDto, @CurrentUser() user: AuthUser) {
    return this.kmRates.create(dto, user.id);
  }

  @Delete(':id')
  @RequirePermission('km_rates', 'edit')
  @ApiOperation({
    summary: 'Delete a PENDING km rate',
    description: 'Requires km_rates:edit. Only a pending row may be deleted (current/past → 422). Re-opens any predecessor it had bounded.',
  })
  @ApiNoContentResponse({ description: 'Deleted.' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.kmRates.remove(id, user.id);
  }
}
