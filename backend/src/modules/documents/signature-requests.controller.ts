/**
 * SignatureRequestsController — /v1/signature-requests/{id}/sign, /sign-upload, /cancel. — arch §6.10
 * SignaturesController — /v1/signatures/{id}/file-url (a per-signer signed copy).
 * These are RECIPIENT/ROW-gated, not module-permission-gated: signing carries NO @RequirePermission
 * ("any (recipient)"), and the services enforce who may act. Authenticated access only.
 */
import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Ip,
  Param,
  ParseFilePipeBuilder,
  ParseUUIDPipe,
  Post,
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { UploadedFile as UploadedFileShape } from '../../common/storage/storage.service';
import { SignaturesService } from './signatures.service';
import { SignDto } from './dto/sign.dto';
import { CancelSignatureResultResponse, FileUrlResponse, SignActionResultResponse } from './dto/document.response';

const MAX_SIGNED_BYTES = 25 * 1024 * 1024; // 25 MB

@ApiTags('Documents & E-Signature')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('signature-requests')
export class SignatureRequestsController {
  constructor(private readonly signatures: SignaturesService) {}

  @Post(':id/sign')
  @ApiOperation({
    summary: 'Sign or decline a signature request',
    description:
      'Authenticated; the caller must be a recipient of this request (else 403). decision = sign | decline. ' +
      'On signing, the server stamps the signer’s fields into a distinct per-signer copy (the original is ' +
      'never mutated) and records the event (method, IP, timestamp).',
  })
  @ApiCreatedResponse({ type: SignActionResultResponse })
  sign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
  ) {
    return this.signatures.act(id, dto, user, ip);
  }

  @Post(':id/sign-upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIGNED_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({
    summary: 'Complete your signature by uploading an externally-signed PDF',
    description:
      'Authenticated; the caller must be a recipient (else 403). Stores the uploaded PDF as the signer’s ' +
      'signed copy with method = uploaded. The original document is never mutated.',
  })
  @ApiCreatedResponse({ type: SignActionResultResponse })
  signUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: 'application/pdf' })
        .build({
          fileIsRequired: true,
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          exceptionFactory: () => new UnprocessableEntityException('a signed PDF file is required'),
        }),
    )
    file: UploadedFileShape,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
  ) {
    return this.signatures.signUpload(id, file, user, ip);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a signature request',
    description: 'Authenticated; only the requester, the document owner, or an admin may cancel (else 403).',
  })
  @ApiCreatedResponse({ type: CancelSignatureResultResponse })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.signatures.cancel(id, user);
  }
}

/** Per-signer signed-copy access — keyed on the document_signature id (visible to anyone who sees the doc). */
@ApiTags('Documents & E-Signature')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('signatures')
export class SignaturesController {
  constructor(private readonly signatures: SignaturesService) {}

  @Get(':id/file-url')
  @ApiOperation({
    summary: 'Get an access-controlled URL for a per-signer signed copy',
    description: 'Authenticated; visible to the document owner, a recipient, or an admin (else 404). Short-TTL signed URL.',
  })
  @ApiOkResponse({ type: FileUrlResponse })
  fileUrl(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.signatures.fileUrl(id, user);
  }
}
