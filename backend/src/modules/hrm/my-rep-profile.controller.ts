/**
 * MyRepProfileController — /v1/account/rep-profile*: a rep's OWN profile, equipment and documents, read-only.
 * — client request 2026-11-11 (who controls which field)
 *
 * SELF-SCOPING COMES FROM THE TOKEN: no route takes a rep id, so "show me another rep's profile" is not a
 * request this API can express (the same structural guarantee as /v1/pay-statements). Authenticated-only —
 * no module permission — and a user with no linked rep is 403, not an empty 200.
 *
 * What the rep sees: their whole profile, the SIN MASKED only (no reveal — they know their own SIN, and every
 * reveal is an audit event), their equipment + deposits, and their documents (list + open). Changes go
 * through /v1/account/profile-change-requests for reviewer approval; admin-only fields are not editable here
 * at all.
 */
import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { FileUrlResponse } from '../documents/dto/document.response';
import { RepsService } from './reps.service';
import { RepDocumentsService } from './rep-documents.service';
import { RepEquipmentService } from './rep-equipment.service';
import { MyRepProfileResponse, RepDocumentResponse, RepEquipmentResponse } from './dto/hrm.response';

function ownRepId(user: AuthUser): string {
  if (!user.repId) {
    throw new ForbiddenException('Your account is not linked to a rep');
  }
  return user.repId;
}

@ApiTags('Account / Rep profile')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('account/rep-profile')
export class MyRepProfileController {
  constructor(
    private readonly reps: RepsService,
    private readonly documents: RepDocumentsService,
    private readonly equipment: RepEquipmentService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'My rep profile (read-only)',
    description: 'Authenticated; the rep comes from the token. SIN is masked only. 403 when not linked to a rep.',
  })
  @ApiOkResponse({ type: MyRepProfileResponse })
  profile(@CurrentUser() user: AuthUser) {
    return this.reps.findOwn(ownRepId(user));
  }

  @Get('equipment')
  @ApiOperation({ summary: 'Equipment issued to me (read-only)' })
  @ApiOkResponse({ type: RepEquipmentResponse, isArray: true })
  myEquipment(@CurrentUser() user: AuthUser) {
    return this.equipment.list(ownRepId(user));
  }

  @Get('documents')
  @ApiOperation({ summary: 'My documents (read-only list)' })
  @ApiOkResponse({ type: RepDocumentResponse, isArray: true })
  myDocuments(@CurrentUser() user: AuthUser) {
    return this.documents.list(ownRepId(user), user);
  }

  @Get('documents/:docId/file-url')
  @ApiOperation({
    summary: 'Open one of my documents',
    description: 'A short-TTL signed URL. Only a document belonging to the caller’s own rep resolves (else 404).',
  })
  @ApiOkResponse({ type: FileUrlResponse })
  myDocumentUrl(@CurrentUser() user: AuthUser, @Param('docId', ParseUUIDPipe) docId: string) {
    return this.documents.fileUrl(ownRepId(user), docId);
  }
}
