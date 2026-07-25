/**
 * ImportController — /v1/imports + /v1/import-mappings. — arch §6.11
 * Importing/migrating is restricted to Super Admin/Admin (IMP-001) via the import:* permissions; the
 * COMMIT is the high-stakes action and requires import:approve. The global guard enforces server-side.
 * Create is a real multipart Excel/CSV upload; the server parses + cleans + auto-maps + classifies.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { SuccessResponse } from '../../common/dto/success.response';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { UploadedFile as UploadedFileShape } from '../../common/storage/storage.service';
import { ImportService } from './import.service';
import { CreateImportDto } from './dto/create-import.dto';
import { ReconcileDto } from './dto/reconcile.dto';
import { RemapDto } from './dto/remap.dto';
import { CreateMappingDto, ListMappingsQuery, UpdateMappingDto } from './dto/mapping.dto';
import { ListImportsQuery } from './dto/list-imports.query';
import { ImportBatchResponse, ImportFieldMappingResponse, ImportPreviewResponse, StagedImportResponse } from './dto/import.response';

const MAX_IMPORT_BYTES = 15 * 1024 * 1024; // 15 MB

@ApiTags('Data Import & Integration')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('imports')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  @Post()
  @RequirePermission('import', 'create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        source_type: { type: 'string' },
        import_type: { type: 'string' },
        client_id: { type: 'string' },
        field_mapping_id: { type: 'string' },
        reconcile_total: { type: 'string' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload + stage an import batch (Excel/CSV)',
    description:
      'Requires import:create. Multipart: an .xlsx/.xls/.csv/.tsv file + metadata. The server parses, ' +
      'cleans, auto-suggests a mapping (or applies field_mapping_id), and classifies. Nothing is written ' +
      'to live tables until commit. Returns the staged batch + parsed headers + the applied mapping.',
  })
  @ApiCreatedResponse({ type: StagedImportResponse })
  create(
    @Body() dto: CreateImportDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(\.(xlsx|xls|csv|tsv|txt)$|spreadsheet|excel|csv|text\/plain)/i })
        .build({
          fileIsRequired: true,
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          exceptionFactory: () => new UnprocessableEntityException('an Excel (.xlsx/.xls) or CSV/TSV file is required'),
        }),
    )
    file: UploadedFileShape,
    @CurrentUser() user: AuthUser,
  ) {
    return this.imports.stage(file, dto, user);
  }

  @Post('preview')
  @RequirePermission('import', 'create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        source_type: { type: 'string' },
        import_type: { type: 'string' },
        client_id: { type: 'string' },
        field_mapping_id: { type: 'string' },
        sheet: { type: 'string' },
      },
    },
  })
  @ApiOperation({
    summary: 'Dry-run an import file (no batch, nothing stored)',
    description:
      'Requires import:create. Runs the SAME parse → map → clean → classify path as staging and reports ' +
      'what it would produce — chosen sheet, detected header row, the mapping, required fields with no ' +
      'column, a row sample, and the grouped blockers — WITHOUT creating a batch or storing the file. ' +
      'Lets the operator correct the sheet or mapping before anything is staged.',
  })
  @ApiOkResponse({ type: ImportPreviewResponse })
  preview(
    @Body() dto: CreateImportDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(\.(xlsx|xls|csv|tsv|txt)$|spreadsheet|excel|csv|text\/plain)/i })
        .build({
          fileIsRequired: true,
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          exceptionFactory: () => new UnprocessableEntityException('an Excel (.xlsx/.xls) or CSV/TSV file is required'),
        }),
    )
    file: UploadedFileShape,
  ) {
    return this.imports.preview(file, dto);
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

  @Get(':id/error-report')
  @RequirePermission('import', 'view')
  @ApiProduces('text/csv')
  @Header('Content-Type', 'text/csv')
  @ApiOperation({
    summary: 'Download a CSV of the rows still needing attention',
    description: 'Requires import:view. The unmatched/duplicate/error rows for hand-cleaning.',
  })
  errorReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.errorReport(id);
  }

  @Post(':id/remap')
  @RequirePermission('import', 'edit')
  @ApiOperation({
    summary: 'Re-apply a mapping to the staged rows',
    description: 'Requires import:edit. Re-maps + re-cleans + re-classifies the stored rows (no re-upload).',
  })
  @ApiCreatedResponse({ type: StagedImportResponse })
  remap(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RemapDto, @CurrentUser() user: AuthUser) {
    return this.imports.remap(id, dto, user);
  }

  @Post(':id/reconcile')
  @RequirePermission('import', 'edit')
  @ApiOperation({
    summary: 'Resolve unmatched/ambiguous rows',
    description: 'Requires import:edit. Resolutions: match / edit / ignore. Recomputes counts.',
  })
  @ApiCreatedResponse({ type: ImportBatchResponse })
  reconcile(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReconcileDto, @CurrentUser() user: AuthUser) {
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

@ApiTags('Data Import & Integration')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('import-mappings')
export class ImportMappingsController {
  constructor(private readonly imports: ImportService) {}

  @Get()
  @RequirePermission('import', 'view')
  @ApiOperation({ summary: 'List saved field mappings', description: 'Requires import:view.' })
  @ApiOkResponse({ type: ImportFieldMappingResponse, isArray: true })
  list(@Query() query: ListMappingsQuery) {
    return this.imports.listMappings(query);
  }

  @Post()
  @RequirePermission('import', 'create')
  @ApiOperation({ summary: 'Save a reusable field mapping', description: 'Requires import:create.' })
  @ApiCreatedResponse({ type: ImportFieldMappingResponse })
  create(@Body() dto: CreateMappingDto, @CurrentUser() user: AuthUser) {
    return this.imports.createMapping(dto, user);
  }

  @Patch(':id')
  @RequirePermission('import', 'edit')
  @ApiOperation({ summary: 'Update a saved field mapping', description: 'Requires import:edit.' })
  @ApiOkResponse({ type: ImportFieldMappingResponse })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMappingDto, @CurrentUser() user: AuthUser) {
    return this.imports.updateMapping(id, dto, user);
  }

  @Delete(':id')
  @RequirePermission('import', 'edit')
  @ApiOperation({ summary: 'Delete a saved field mapping', description: 'Requires import:edit.' })
  @ApiOkResponse({ type: SuccessResponse })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.imports.removeMapping(id, user);
  }
}
