/**
 * RepsController — /v1/reps and its nested documents & equipment. — arch §6.2
 * Every route declares its (hrm, action) permission; the global guard enforces it server-side.
 * Read endpoints pass the AuthUser so the service can redact sensitive PII (hrm:edit gate).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
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
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { UploadedFile as UploadedFileShape } from '../../common/storage/storage.service';
import { FileUrlResponse } from '../documents/dto/document.response';
import { RepsService } from './reps.service';
import { REP_DOC_TYPES, repDocumentProblem } from './rep-documents.logic';
import { RepDocumentsService } from './rep-documents.service';
import { RepEquipmentService } from './rep-equipment.service';
import { BulkAssignManagerDto, CreateRepDto, ListRepsQuery, UpdateRepDto } from './dto/rep.dto';
import { SuccessResponse } from '../../common/dto/success.response';
import {
  CreateRepDocumentDto,
  ReadRepDocumentDto,
  ReplaceRepDocumentDto,
  UpdateRepDocumentDto,
} from './dto/rep-document.dto';
import { CreateRepEquipmentDto } from './dto/rep-equipment.dto';
import {
  DeletedRepDocumentResponse,
  DataAccuracyResponse,
  DocumentReadResponse,
  RemovedRepDocumentResponse,
  RepDocumentResponse,
  RepEquipmentResponse,
  RepPageResponse,
  RepResponse,
  RevealSinResponse,
  RevealAccountResponse,
} from './dto/hrm.response';

const MAX_REP_DOC_BYTES = 25 * 1024 * 1024; // 25 MB

/** A PDF or image file is required (rep document upload / read / replace). */
const repDocFilePipe = () =>
  new ParseFilePipeBuilder()
    .addFileTypeValidator({ fileType: /^(application\/pdf|image\/(png|jpe?g|webp))$/ })
    .build({
      fileIsRequired: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      exceptionFactory: () => new UnprocessableEntityException('a PDF or image file is required'),
    });

@ApiTags('HRM / Reps')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('reps')
export class RepsController {
  constructor(
    private readonly reps: RepsService,
    private readonly documents: RepDocumentsService,
    private readonly equipment: RepEquipmentService,
  ) {}

  @Get()
  @RequirePermission('hrm', 'view')
  @ApiOperation({
    summary: 'List reps',
    description:
      'Requires hrm:view. Paginated (page/limit/sort/search) + status/fieldManagerId filters. payment_details redacted unless hrm:edit.',
  })
  @ApiOkResponse({ type: RepPageResponse })
  list(@Query() query: ListRepsQuery, @CurrentUser() user: AuthUser) {
    return this.reps.findAll(query, user);
  }

  @Post()
  @RequirePermission('hrm', 'create')
  @ApiOperation({
    summary: 'Create a rep',
    description: 'Requires hrm:create. rep_code never reused → 409.',
  })
  @ApiCreatedResponse({ type: RepResponse })
  create(@Body() dto: CreateRepDto, @CurrentUser() user: AuthUser) {
    return this.reps.create(dto, user);
  }

  @Post('bulk-assign-manager')
  @RequirePermission('hrm', 'edit')
  @ApiOperation({
    summary: 'Assign / reassign reps to a field manager (bulk)',
    description: 'Requires hrm:edit. Reassigns the roster the manager-scoped views read. Validates the manager.',
  })
  @ApiOkResponse({ type: SuccessResponse })
  bulkAssignManager(@Body() dto: BulkAssignManagerDto, @CurrentUser('id') actorId: string) {
    return this.reps.bulkAssignManager(dto, actorId);
  }

  @Get(':id')
  @RequirePermission('hrm', 'view')
  @ApiOperation({
    summary: 'Get a rep',
    description: 'Requires hrm:view. payment_details redacted unless hrm:edit.',
  })
  @ApiOkResponse({ type: RepResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.reps.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermission('hrm', 'edit')
  @ApiOperation({
    summary: 'Edit / set field manager / terminate a rep',
    description:
      'Requires hrm:edit. status=terminated requires termination_date. rep_code immutable.',
  })
  @ApiOkResponse({ type: RepResponse })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRepDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reps.update(id, dto, user);
  }

  @Post(':id/sin/reveal')
  @RequirePermission('hrm', 'edit')
  @ApiOperation({
    summary: "Reveal a rep's SIN",
    description:
      'Requires hrm:edit. Decrypts and returns the SIN; EVERY call writes a reveal_sin audit row (the value ' +
      'itself is never logged). 503 when the server has no PII_ENCRYPTION_KEY. sin is null when none is on file.',
  })
  @ApiOkResponse({ type: RevealSinResponse })
  revealSin(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.reps.revealSin(id, actorId);
  }

  @Post(':id/banking/reveal')
  @RequirePermission('hrm', 'edit')
  @ApiOperation({
    summary: "Reveal a rep's bank account number",
    description:
      'Requires hrm:edit. Decrypts and returns the account number; EVERY call writes a reveal_account audit row ' +
      '(the value itself is never logged). 503 without PII_ENCRYPTION_KEY. null when none is on file.',
  })
  @ApiOkResponse({ type: RevealAccountResponse })
  revealAccount(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.reps.revealAccount(id, actorId);
  }

  // ── Nested: documents ───────────────────────────────────────────────────────────────────────

  @Get(':id/documents')
  @RequirePermission('hrm', 'view')
  @ApiOperation({
    summary: "List a rep's documents",
    description: 'Requires hrm:view. file_url shown only with hrm:edit.',
  })
  @ApiOkResponse({ type: RepDocumentResponse, isArray: true })
  listDocuments(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.documents.list(id, user);
  }

  @Post(':id/documents')
  @RequirePermission('hrm', 'edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_REP_DOC_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        doc_type: { type: 'string', enum: [...REP_DOC_TYPES] },
        expires_on: { type: 'string', example: '2027-06-30' },
      },
    },
  })
  @ApiOperation({
    summary: 'Attach a document to a rep (upload)',
    description: 'Requires hrm:edit. Multipart: a PDF/image file + doc_type. Stored to object storage.',
  })
  @ApiCreatedResponse({ type: RepDocumentResponse })
  createDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRepDocumentDto,
    @UploadedFile(repDocFilePipe()) file: UploadedFileShape,
    @CurrentUser('id') actorId: string,
  ) {
    // The kind-specific rules (2026-11-12): a known type, a headshot is JPG/PNG, expiry only where it applies.
    const problem = repDocumentProblem(dto.doc_type, file.mimetype, dto.expires_on, dto.issued_on);
    if (problem) throw new UnprocessableEntityException(problem);
    return this.documents.create(id, dto, file, actorId);
  }

  // ── Reading dates off an ID (2026-11-12) — suggestions for HR; nothing read is stored ─────────

  @Post(':id/documents/read')
  @RequirePermission('hrm', 'edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_REP_DOC_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' }, doc_type: { type: 'string', enum: [...REP_DOC_TYPES] } },
    },
  })
  @ApiOperation({
    summary: 'Read the issue/expiry dates off an ID before uploading it',
    description:
      'Requires hrm:edit. Permits, PR card, driver’s licence, passport. Returns the dates and name as SUGGESTIONS plus ' +
      'consistency checks (name, dates, MRZ check digits); nothing is stored. 503 when reading isn’t set up; 422 ' +
      'when the document can’t be read — the dates are then typed by hand.',
  })
  @ApiOkResponse({ type: DocumentReadResponse })
  readDocumentUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReadRepDocumentDto,
    @UploadedFile(repDocFilePipe()) file: UploadedFileShape,
    @CurrentUser('id') actorId: string,
  ) {
    return this.documents.readUpload(id, dto.doc_type, file, actorId);
  }

  @Post(':id/documents/:docId/read')
  @RequirePermission('hrm', 'edit')
  @ApiOperation({
    summary: 'Read the issue/expiry dates off an ID already on file',
    description: 'Requires hrm:edit. Same as reading before upload; nothing is stored until HR saves the dates.',
  })
  @ApiOkResponse({ type: DocumentReadResponse })
  readStoredDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.documents.readStored(id, docId, actorId);
  }

  @Patch(':id/documents/:docId')
  @RequirePermission('hrm', 'edit')
  @ApiOperation({
    summary: "Edit a rep document's type and dates",
    description:
      'Requires hrm:edit. Type and, for IDs, HR-confirmed issue/expiry dates; null clears a date, an omitted field is ' +
      'unchanged, a type without dates clears them. A headshot must be a JPG/PNG. Audited.',
  })
  @ApiOkResponse({ type: RepDocumentResponse })
  updateDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body() dto: UpdateRepDocumentDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.documents.update(id, docId, dto, actorId);
  }

  @Post(':id/documents/:docId/replace')
  @RequirePermission('hrm', 'edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_REP_DOC_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        issued_on: { type: 'string', example: '2022-06-30' },
        expires_on: { type: 'string', example: '2032-06-30' },
      },
    },
  })
  @ApiOperation({
    summary: "Replace a rep document's file",
    description:
      'Requires hrm:edit. The new file becomes the live document with the same type; the old one moves to Recently ' +
      'deleted (restorable for 30 days). Omitted dates carry over.',
  })
  @ApiCreatedResponse({ type: RepDocumentResponse })
  replaceDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body() dto: ReplaceRepDocumentDto,
    @UploadedFile(repDocFilePipe()) file: UploadedFileShape,
    @CurrentUser('id') actorId: string,
  ) {
    return this.documents.replaceFile(id, docId, dto, file, actorId);
  }

  @Delete(':id/documents/:docId')
  @RequirePermission('hrm', 'delete')
  @ApiOperation({
    summary: 'Move a rep document to Recently deleted',
    description:
      'Requires hrm:delete. Restorable for 30 days; after that the daily purge removes the file from storage for ' +
      'good. Audited.',
  })
  @ApiOkResponse({ type: RemovedRepDocumentResponse })
  deleteDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.documents.remove(id, docId, actorId);
  }

  @Get(':id/data-accuracy')
  @RequirePermission('hrm', 'edit')
  @ApiOperation({
    summary: "Compare a rep's profile with their IDs",
    description:
      'Requires hrm:edit. The profile name and date of birth beside the HR-confirmed details of the latest live ID of each kind, with server-computed match flags. Document numbers are masked.',
  })
  @ApiOkResponse({ type: DataAccuracyResponse })
  dataAccuracy(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.dataAccuracy(id);
  }

  @Get(':id/documents/deleted')
  @RequirePermission('hrm', 'delete')
  @ApiOperation({
    summary: "A rep's recently deleted documents",
    description: 'Requires hrm:delete. Documents that can still be restored, with who deleted them and when they go for good.',
  })
  @ApiOkResponse({ type: DeletedRepDocumentResponse, isArray: true })
  listDeletedDocuments(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.listDeleted(id);
  }

  @Post(':id/documents/:docId/restore')
  @RequirePermission('hrm', 'delete')
  @ApiOperation({
    summary: 'Restore a recently deleted rep document',
    description: 'Requires hrm:delete. 409 once the 30 days have passed. Audited.',
  })
  @ApiCreatedResponse({ type: RepDocumentResponse })
  restoreDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.documents.restore(id, docId, actorId);
  }

  @Get(':id/documents/:docId/file-url')
  @RequirePermission('hrm', 'edit')
  @ApiOperation({
    summary: 'Get an access-controlled URL for a rep document',
    description: 'Requires hrm:edit (identity docs are sensitive). Returns a short-TTL signed URL.',
  })
  @ApiOkResponse({ type: FileUrlResponse })
  documentFileUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.documents.fileUrl(id, docId);
  }

  // ── Nested: equipment ───────────────────────────────────────────────────────────────────────

  @Get(':id/equipment')
  @RequirePermission('hrm', 'view')
  @ApiOperation({ summary: "List a rep's equipment", description: 'Requires hrm:view.' })
  @ApiOkResponse({ type: RepEquipmentResponse, isArray: true })
  listEquipment(@Param('id', ParseUUIDPipe) id: string) {
    return this.equipment.list(id);
  }

  @Post(':id/equipment')
  @RequirePermission('hrm', 'edit')
  @ApiOperation({
    summary: 'Assign equipment to a rep',
    description: 'Requires hrm:edit. Deposit is exact Decimal.',
  })
  @ApiCreatedResponse({ type: RepEquipmentResponse })
  assignEquipment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRepEquipmentDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.equipment.assign(id, dto, actorId);
  }
}
