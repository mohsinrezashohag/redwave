/**
 * RolesController — /v1/roles (+ /v1/modules, /v1/permissions catalogue).
 * Every route declares its required (module, action); PermissionsGuard enforces it. — arch §6.1
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesService } from './roles.service';
import { CreateRoleDto, SetRolePermissionsDto, UpdateRoleDto } from './dto/role.dto';
import {
  ModuleResponse,
  PermissionResponse,
  RoleDetailResponse,
  RoleSummaryResponse,
} from './dto/role.response';

@ApiTags('Roles')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('roles', 'view')
  @ApiOperation({ summary: 'List roles', description: 'Requires roles:view.' })
  @ApiOkResponse({ type: RoleSummaryResponse, isArray: true })
  findAll() {
    return this.roles.findAll();
  }

  @Post()
  @RequirePermission('roles', 'create')
  @ApiOperation({ summary: 'Create a custom role', description: 'Requires roles:create.' })
  @ApiCreatedResponse({ type: RoleDetailResponse })
  create(@Body() dto: CreateRoleDto, @CurrentUser('id') actorId: string) {
    return this.roles.create(dto, actorId);
  }

  @Get(':id')
  @RequirePermission('roles', 'view')
  @ApiOperation({
    summary: 'Get a role + its granted permissions',
    description: 'Requires roles:view.',
  })
  @ApiOkResponse({ type: RoleDetailResponse })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('roles', 'edit')
  @ApiOperation({
    summary: 'Rename / edit a role',
    description: 'Requires roles:edit. Built-in roles cannot be renamed.',
  })
  @ApiOkResponse({ type: RoleDetailResponse })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.roles.update(id, dto, actorId);
  }

  @Put(':id/permissions')
  @RequirePermission('roles', 'edit')
  @ApiOperation({
    summary: 'Set a role’s module×action grants',
    description: 'Requires roles:edit.',
  })
  @ApiOkResponse({ type: RoleDetailResponse })
  setPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.roles.setPermissions(id, dto, actorId);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('roles', 'delete')
  @ApiOperation({
    summary: 'Delete a custom role',
    description: 'Requires roles:delete. Built-in roles → 409.',
  })
  @ApiNoContentResponse({ description: 'Role deleted.' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.roles.remove(id, actorId);
  }
}

/** Catalogue endpoints for the Role Builder matrix — /v1/modules and /v1/permissions. */
@ApiTags('Roles')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller()
export class RbacCatalogueController {
  constructor(private readonly roles: RolesService) {}

  @Get('modules')
  @RequirePermission('roles', 'view')
  @ApiOperation({ summary: 'List system modules', description: 'Requires roles:view.' })
  @ApiOkResponse({ type: ModuleResponse, isArray: true })
  listModules() {
    return this.roles.listModules();
  }

  @Get('permissions')
  @RequirePermission('roles', 'view')
  @ApiOperation({
    summary: 'List all (module, action) permissions',
    description: 'Requires roles:view.',
  })
  @ApiOkResponse({ type: PermissionResponse, isArray: true })
  listPermissions() {
    return this.roles.listPermissions();
  }
}
