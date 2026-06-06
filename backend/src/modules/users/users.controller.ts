/**
 * UsersController — /v1/users. Admin user management (gated by users:* permissions). — arch §6.1
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
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
import { UsersService } from './users.service';
import { CreateUserDto, SetUserRolesDto, UpdateUserDto } from './dto/user.dto';
import { AdminUserResponse } from './dto/user.response';

@ApiTags('Users')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('users', 'view')
  @ApiOperation({ summary: 'List users', description: 'Requires users:view.' })
  @ApiOkResponse({ type: AdminUserResponse, isArray: true })
  findAll() {
    return this.users.findAll();
  }

  @Post()
  @RequirePermission('users', 'create')
  @ApiOperation({
    summary: 'Create a user and assign roles',
    description: 'Requires users:create.',
  })
  @ApiCreatedResponse({ type: AdminUserResponse })
  create(@Body() dto: CreateUserDto, @CurrentUser('id') actorId: string) {
    return this.users.create(dto, actorId);
  }

  @Get(':id')
  @RequirePermission('users', 'view')
  @ApiOperation({ summary: 'Get a user', description: 'Requires users:view.' })
  @ApiOkResponse({ type: AdminUserResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('users', 'edit')
  @ApiOperation({
    summary: 'Edit / deactivate a user',
    description: 'Requires users:edit. status=inactive revokes access immediately.',
  })
  @ApiOkResponse({ type: AdminUserResponse })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.users.update(id, dto, actorId);
  }

  @Put(':id/roles')
  @RequirePermission('users', 'edit')
  @ApiOperation({ summary: 'Set a user’s roles', description: 'Requires users:edit.' })
  @ApiOkResponse({ type: AdminUserResponse })
  setRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserRolesDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.users.setRoles(id, dto, actorId);
  }
}
