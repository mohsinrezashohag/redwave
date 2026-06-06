/**
 * Account controllers.
 *  • AccountController (/v1/account)            — every authenticated user; self-service. — AUTH-009/010/011
 *  • ProfileChangeReviewController (/v1/profile-change-requests) — reviewers; gated by profile:approve. — AUTH-012
 */
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { SuccessResponse } from '../../common/dto/success.response';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { AccountService } from './account.service';
import { ChangePasswordDto, ProfileChangeRequestDto, SetThemeDto } from './dto/account.dto';
import {
  AccountProfileResponse,
  MyProfileRequestResponse,
  ProfileChangeRequestResponse,
  ReviewRequestResponse,
  ThemeResponse,
} from './dto/account.response';

@ApiTags('Account')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('profile')
  @ApiOperation({
    summary: 'View my profile',
    description: 'Authenticated. Flags any change pending review.',
  })
  @ApiOkResponse({ type: AccountProfileResponse })
  getProfile(@CurrentUser() user: AuthUser) {
    return this.account.getProfile(user);
  }

  @Post('change-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Change my password',
    description: 'Authenticated. Verifies the current password.',
  })
  @ApiOkResponse({ type: SuccessResponse })
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.account.changePassword(user, dto);
  }

  @Patch('theme')
  @ApiOperation({
    summary: 'Set my theme preference',
    description: 'Authenticated. Applies immediately, no review.',
  })
  @ApiOkResponse({ type: ThemeResponse })
  setTheme(@CurrentUser() user: AuthUser, @Body() dto: SetThemeDto) {
    return this.account.setTheme(user, dto);
  }

  @Post('profile-change-requests')
  @ApiOperation({
    summary: 'Request a profile HR-field change',
    description:
      'Authenticated. Creates a PENDING request; the live profile is not changed until approved.',
  })
  @ApiCreatedResponse({ type: MyProfileRequestResponse })
  requestProfileChange(@CurrentUser() user: AuthUser, @Body() dto: ProfileChangeRequestDto) {
    return this.account.requestProfileChange(user, dto);
  }

  @Get('profile-change-requests')
  @ApiOperation({ summary: 'List my profile-change requests', description: 'Authenticated.' })
  @ApiOkResponse({ type: MyProfileRequestResponse, isArray: true })
  listMyRequests(@CurrentUser() user: AuthUser) {
    return this.account.listMyRequests(user);
  }
}

@ApiTags('Account')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('profile-change-requests')
export class ProfileChangeReviewController {
  constructor(private readonly account: AccountService) {}

  @Get()
  @RequirePermission('profile', 'approve')
  @ApiOperation({
    summary: 'Review queue of pending profile changes',
    description:
      'Requires profile:approve. Scoped by routing (Field Manager / Admin / Super Admin).',
  })
  @ApiOkResponse({ type: ReviewRequestResponse, isArray: true })
  listQueue(@CurrentUser() user: AuthUser) {
    return this.account.listReviewQueue(user);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('profile', 'approve')
  @ApiOperation({
    summary: 'Approve a profile change',
    description: 'Requires profile:approve + routing authorization.',
  })
  @ApiOkResponse({ type: ProfileChangeRequestResponse })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.account.approve(user, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('profile', 'approve')
  @ApiOperation({
    summary: 'Reject a profile change',
    description: 'Requires profile:approve + routing authorization.',
  })
  @ApiOkResponse({ type: ProfileChangeRequestResponse })
  reject(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.account.reject(user, id);
  }
}
