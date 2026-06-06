/**
 * ImportController — /v1/imports. — arch §6.11
 * Importing/migrating is restricted to Super Admin/Admin (IMP-001) via the import:* permissions; the
 * COMMIT is the high-stakes action and requires import:approve. The global guard enforces server-side.
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
import { ImportService } from './import.service';
import { CreateImportDto } from './dto/create-import.dto';
import { ReconcileDto } from './dto/reconcile.dto';
import { ListImportsQuery } from './dto/list-imports.query';
import { ImportBatchResponse } from './dto/import.response';

@ApiTags('Data Import & Integration')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('imports')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  @Post()
  @RequirePermission('import', 'create')
  @ApiOperation({
    summary: 'Create a staged import batch',
    description:
      'Requires import:create. Stages + classifies rows (file upload stubbed — rows fed in the body). ' +
      'Nothing is written to live tables until commit.',
  })
  @ApiCreatedResponse({ type: ImportBatchResponse })
  create(@Body() dto: CreateImportDto, @CurrentUser() user: AuthUser) {
    return this.imports.stage(dto, user);
  }

  @Get()
  @RequirePermission('import', 'view')
  @ApiOperation({ summary: 'Import/migration history', description: 'Requires import:view.' })
  @ApiOkResponse({ type: ImportBatchResponse, isArray: true })
  list(@Query() query: ListImportsQuery) {
    return this.imports.list(query);
  }

  @Get(':id')
  @RequirePermission('import', 'view')
  @ApiOperation({
    summary: 'Preview a staged batch',
    description: 'Requires import:view. Rows with match status, counts, and reconcile total.',
  })
  @ApiOkResponse({ type: ImportBatchResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.findOne(id);
  }

  @Post(':id/reconcile')
  @RequirePermission('import', 'edit')
  @ApiOperation({
    summary: 'Resolve unmatched/ambiguous rows',
    description: 'Requires import:edit. Resolutions: match / edit / ignore. Recomputes counts.',
  })
  @ApiCreatedResponse({ type: ImportBatchResponse })
  reconcile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReconcileDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.imports.reconcile(id, dto, user);
  }

  @Post(':id/commit')
  @RequirePermission('import', 'approve')
  @ApiOperation({
    summary: 'Commit the batch (atomic + idempotent; reconcile-gated)',
    description:
      'Requires import:approve. Blocked (422) while any row is unresolved (balance migrations must ' +
      'also reconcile to the source total). Applies all rows in ONE transaction; re-commit is a no-op.',
  })
  @ApiCreatedResponse({ type: ImportBatchResponse })
  commit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.imports.commit(id, user);
  }
}
