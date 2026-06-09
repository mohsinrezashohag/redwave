/**
 * RepsController — /v1/reps and its nested documents & equipment. — arch §6.2
 * Every route declares its (hrm, action) permission; the global guard enforces it server-side.
 * Read endpoints pass the AuthUser so the service can redact sensitive PII (hrm:edit gate).
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
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
import { RepsService } from './reps.service';
import { RepDocumentsService } from './rep-documents.service';
import { RepEquipmentService } from './rep-equipment.service';
import { CreateRepDto, ListRepsQuery, UpdateRepDto } from './dto/rep.dto';
import { CreateRepDocumentDto } from './dto/rep-document.dto';
import { CreateRepEquipmentDto } from './dto/rep-equipment.dto';
import { RepDocumentResponse, RepEquipmentResponse, RepPageResponse, RepResponse } from './dto/hrm.response';

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
  create(@Body() dto: CreateRepDto, @CurrentUser('id') actorId: string) {
    return this.reps.create(dto, actorId);
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
    @CurrentUser('id') actorId: string,
  ) {
    return this.reps.update(id, dto, actorId);
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
  @ApiOperation({
    summary: 'Attach a document to a rep',
    description: 'Requires hrm:edit. Stores a storage reference.',
  })
  @ApiCreatedResponse({ type: RepDocumentResponse })
  createDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRepDocumentDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.documents.create(id, dto, actorId);
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
