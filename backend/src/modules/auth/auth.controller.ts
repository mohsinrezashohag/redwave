/**
 * AuthController — /v1/auth: login, refresh, logout, me.
 * login & refresh are @Public; logout & me require authentication only. — arch §6.1
 */
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { SuccessResponse } from '../../common/dto/success.response';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LoginResponse, MeResponse, RefreshResponse } from './dto/auth.response';

@ApiTags('Auth')
@ApiErrorResponses()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Authenticate with email + password',
    description: 'Public. Returns { access_token, refresh_token }. Invalid credentials → 401.',
  })
  @ApiOkResponse({ type: LoginResponse })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new access token',
    description: 'Public. Invalid/expired refresh token → 401.',
  })
  @ApiOkResponse({ type: RefreshResponse })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refresh_token);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Log out (stateless)',
    description: 'Requires authentication. The client discards its tokens; recorded for audit.',
  })
  @ApiOkResponse({ type: SuccessResponse })
  async logout(@CurrentUser() user: AuthUser) {
    await this.auth.logout(user);
    return { success: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Current user + effective permissions',
    description: 'Requires authentication. Returns the profile, roles, and union of permissions.',
  })
  @ApiOkResponse({ type: MeResponse })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}
