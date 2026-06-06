/**
 * ClawbackController — /v1/clawbacks. — arch §6.7
 * clawback:create gates the money-affecting entry; the global guard enforces it and the service
 * scopes data per caller.
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
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
import { ClawbackService } from './clawback.service';
import { CreateClawbackDto } from './dto/create-clawback.dto';
import { ListClawbacksQuery } from './dto/list-clawbacks.query';
import { ClawbackResponse } from './dto/clawback.response';

@ApiTags('Clawback')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('clawbacks')
export class ClawbackController {
  constructor(private readonly clawbacks: ClawbackService) {}

  @Get()
  @RequirePermission('clawback', 'view')
  @ApiOperation({
    summary: 'List clawbacks',
    description: 'Requires clawback:view. Scoped; filters status/rep_id/sale_id.',
  })
  @ApiOkResponse({ type: ClawbackResponse, isArray: true })
  list(@Query() query: ListClawbacksQuery, @CurrentUser() user: AuthUser) {
    return this.clawbacks.list(query, user);
  }

  @Post()
  @RequirePermission('clawback', 'create')
  @ApiOperation({
    summary: 'Enter a clawback',
    description:
      'Requires clawback:create. Targets a PAID sale_item; amount defaults to the exact frozen amount ' +
      '(rate + incentive). Flat, per-item, no date math; the snapshot is never edited.',
  })
  @ApiCreatedResponse({ type: ClawbackResponse })
  create(@Body() dto: CreateClawbackDto, @CurrentUser() user: AuthUser) {
    return this.clawbacks.enter(dto, user);
  }

  @Get(':id')
  @RequirePermission('clawback', 'view')
  @ApiOperation({ summary: 'Get a clawback', description: 'Requires clawback:view (scoped).' })
  @ApiOkResponse({ type: ClawbackResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.clawbacks.findOne(id, user);
  }
}
