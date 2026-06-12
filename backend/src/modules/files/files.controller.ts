/**
 * Files controller — POST /v1/files: the ONE multipart upload endpoint behind every user file (receipts,
 * document originals). AUTHENTICATED (no module permission — uploading creates only the caller's own
 * stored_files row; consumers re-gate at CLAIM time: receipts under the expenses rules, documents under
 * documents:create) + the global CSRF guard like every mutation. Mime/size enforced here (422) AND in the
 * service; storage unconfigured → 503. Returns the stored_files row — NO signed URL (downloads are
 * per-domain, RBAC-gated). — arch §11 / security.md (file storage)
 */
import {
  Body,
  Controller,
  HttpStatus,
  Post,
  UploadedFile as UploadedFileDecorator,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ParseFilePipeBuilder, UnprocessableEntityException } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { UploadedFile } from '../../common/storage/storage.service';
import { FilesService } from './files.service';
import { CreateFileDto, StoredFileResponse } from './dto/stored-file.dto';
import { MAX_FILE_BYTES } from './stored-files.logic';

@ApiTags('Files')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a file (unified pipeline)',
    description:
      'Authenticated. JPEG/PNG/PDF up to 10 MB. The storage path is SERVER-generated; the response is the ' +
      'stored_files metadata row (no signed URL — downloads are per-domain, RBAC-gated). 503 when file ' +
      'storage is not configured.',
  })
  @ApiCreatedResponse({ type: StoredFileResponse })
  upload(
    @Body() dto: CreateFileDto,
    @UploadedFileDecorator(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^(image\/(jpeg|png)|application\/pdf)$/ })
        .addMaxSizeValidator({ maxSize: MAX_FILE_BYTES })
        .build({
          fileIsRequired: true,
          errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          exceptionFactory: (error: string) =>
            new UnprocessableEntityException(
              error.includes('size') ? 'the file exceeds the 10 MB limit' : 'only JPEG, PNG, or PDF files are accepted',
            ),
        }),
    )
    file: UploadedFile,
    @CurrentUser() user: AuthUser,
  ) {
    return this.files.upload(file, dto, user);
  }
}
