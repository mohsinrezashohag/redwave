/**
 * SignatureRequestsController — /v1/signature-requests/{id}/sign and /cancel. — arch §6.10
 * These are RECIPIENT/ROW-gated, not module-permission-gated: signing carries NO @RequirePermission
 * ("any (recipient)"), and the services enforce who may act. Authenticated access only.
 */
import { Body, Controller, Ip, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { SignaturesService } from './signatures.service';
import { SignDto } from './dto/sign.dto';
import { CancelSignatureResultResponse, SignActionResultResponse } from './dto/document.response';

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
      'Records the signature event (method, IP, timestamp) and stores a stubbed signed copy.',
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
