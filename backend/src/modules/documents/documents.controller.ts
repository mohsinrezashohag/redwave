/**
 * DocumentsController — /v1/documents and its nested signature-requests. — arch §6.10
 * Upload + request-signature require documents:create; reads require documents:view (visibility-scoped).
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
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { CreateSignatureRequestDto } from './dto/create-signature-request.dto';
import { ListDocumentsQuery } from './dto/list-documents.query';
import { DocumentResponse, SignatureRequestResponse } from './dto/document.response';

@ApiTags('Documents & E-Signature')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @RequirePermission('documents', 'create')
  @ApiOperation({
    summary: 'Upload a document',
    description: 'Requires documents:create. Stores a stubbed original_file_url; status draft, owner = caller.',
  })
  @ApiCreatedResponse({ type: DocumentResponse })
  upload(@Body() dto: CreateDocumentDto, @CurrentUser() user: AuthUser) {
    return this.documents.upload(dto, user);
  }

  @Get()
  @RequirePermission('documents', 'view')
  @ApiOperation({
    summary: 'List documents',
    description: 'Requires documents:view. Scoped to owned or shared-with (Admin/Super Admin see all).',
  })
  @ApiOkResponse({ type: DocumentResponse, isArray: true })
  list(@Query() query: ListDocumentsQuery, @CurrentUser() user: AuthUser) {
    return this.documents.list(query, user);
  }

  @Get(':id')
  @RequirePermission('documents', 'view')
  @ApiOperation({
    summary: 'Get a document (requests + per-signer status)',
    description: 'Requires documents:view. 404 if not visible to the caller.',
  })
  @ApiOkResponse({ type: DocumentResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.documents.findOne(id, user);
  }

  @Post(':id/signature-requests')
  @RequirePermission('documents', 'create')
  @ApiOperation({
    summary: 'Share + request a signature from one or many recipients',
    description: 'Requires documents:create AND ownership of the document (else 403). Recipients become the shared-with set.',
  })
  @ApiCreatedResponse({ type: SignatureRequestResponse })
  requestSignature(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSignatureRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.documents.requestSignature(id, dto, user);
  }
}
