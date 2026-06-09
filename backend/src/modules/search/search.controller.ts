/**
 * SearchController — GET /v1/search?q=. Authenticated-only (no @RequirePermission); the SERVICE scopes
 * each entity group to the caller's entitlements (reps→hrm:view, clients→clients:view, sales→data scope).
 * So a rep can only ever find their own sales/customers, regardless of the query. — arch §7
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { SearchService } from './search.service';
import { SearchResponse } from './dto/search.response';

@ApiTags('Search')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Global search',
    description:
      'Authenticated. RBAC-scoped per entity (reps need hrm:view, clients need clients:view, sales are scoped to the caller). Returns grouped results with ids to deep-link.',
  })
  @ApiQuery({ name: 'q', required: true, description: 'Search term (≥2 chars).' })
  @ApiOkResponse({ type: SearchResponse })
  query(@Query('q') q: string, @CurrentUser() user: AuthUser): Promise<SearchResponse> {
    return this.search.search(q, user);
  }
}
