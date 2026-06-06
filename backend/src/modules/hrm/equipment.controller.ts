/**
 * EquipmentController — /v1/equipment/{id}. Equipment state transition (assigned → returned /
 * withheld). — arch §6.2
 */
import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RepEquipmentService } from './rep-equipment.service';
import { UpdateRepEquipmentDto } from './dto/rep-equipment.dto';
import { RepEquipmentResponse } from './dto/hrm.response';

@ApiTags('HRM / Reps')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('equipment')
export class EquipmentController {
  constructor(private readonly equipment: RepEquipmentService) {}

  @Patch(':id')
  @RequirePermission('hrm', 'edit')
  @ApiOperation({
    summary: 'Update equipment state',
    description: 'Requires hrm:edit. Transition to returned (sets returned_date) or withheld.',
  })
  @ApiOkResponse({ type: RepEquipmentResponse })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRepEquipmentDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.equipment.update(id, dto, actorId);
  }
}
