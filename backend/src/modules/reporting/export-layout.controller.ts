/**
 * ExportLayoutController — /v1/export-layouts: admin-configurable export columns.
 *
 * Reads are `reports:view` (an admin needs to see what a report will contain); writes are `settings:edit`,
 * because a layout governs the shape of documents leaving the business. No new permission.
 *
 * The #3 boundary is not enforced here — it lives in the field registry, so a payroll layout naming a
 * client-rate field is rejected at validation rather than merely hidden from a picker. — arch §6
 */
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { ExportLayoutService } from '../../common/export/export-layout.service';
import { SaveExportLayoutDto } from './dto/export-layout.dto';
import { ExportLayoutResponse, ExportRegistryEntryResponse } from './dto/export-layout.response';

@ApiTags('Reporting & Dashboards')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('export-layouts')
export class ExportLayoutController {
  constructor(private readonly layouts: ExportLayoutService) {}

  @Get('registry')
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'The fields each report type may put in a column, plus its default layout and a sample row',
    description:
      'Requires reports:view. This is the #3 boundary made visible: the payroll report offers no ' +
      'client-rate field and the statement offers no rep-pay field. The sample row is the export ' +
      'analogue of an import template.',
  })
  @ApiOkResponse({ type: ExportRegistryEntryResponse, isArray: true })
  registry() {
    return this.layouts.registry();
  }

  @Get()
  @RequirePermission('reports', 'view')
  @ApiOperation({ summary: 'List saved export layouts', description: 'Requires reports:view.' })
  @ApiQuery({ name: 'report_type', required: false, description: 'Narrow to one report type.' })
  @ApiOkResponse({ type: ExportLayoutResponse, isArray: true })
  list(@Query('report_type') reportType?: string) {
    return this.layouts.list(reportType);
  }

  @Post()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Save an export layout',
    description:
      'Requires settings:edit. Validated against the registry BEFORE it is stored — an unrenderable ' +
      'layout never reaches the database, so a download cannot fail in front of whoever needed the file. ' +
      'A field from another report type is rejected (#3), as is a layout that would break a workbook’s ' +
      'SUBTOTAL strip.',
  })
  @ApiOkResponse({ type: ExportLayoutResponse })
  save(@Body() dto: SaveExportLayoutDto, @CurrentUser() user: AuthUser) {
    return this.layouts.save(dto, user);
  }

  @Delete(':id')
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Deactivate an export layout',
    description:
      'Requires settings:edit. Deactivates rather than deletes — an issued statement may reference it, ' +
      'and that document must stay reproducible (#2).',
  })
  @ApiOkResponse({ type: ExportLayoutResponse })
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.layouts.deactivate(id, user);
  }
}
