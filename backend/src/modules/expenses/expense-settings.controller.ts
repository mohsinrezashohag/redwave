/**
 * ExpenseSettingsController — /v1/expense-settings: the org-level expense policy (the office a km trip
 * runs from).
 *
 * READ is authenticated-only with NO permission: every rep's km form defaults its first stop to the office,
 * so every rep must be able to read it. It is an org address, not sensitive data. WRITE is `settings:edit`
 * (Super Admin) — changing where trips are measured from moves money. — SRS EXP-004
 */
import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ExpenseSettingsService } from './expense-settings.service';
import { ExpenseSettingsResponse, UpdateExpenseSettingsDto } from './dto/expense-settings.dto';

@ApiTags('Expenses')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('expense-settings')
export class ExpenseSettingsController {
  constructor(private readonly settings: ExpenseSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the org expense settings (office origin for km trips)',
    description: 'Authenticated; no permission — every rep’s km form defaults its first stop to the office.',
  })
  @ApiOkResponse({ type: ExpenseSettingsResponse })
  get(): Promise<ExpenseSettingsResponse> {
    return this.settings.get();
  }

  @Patch()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Set the office address km trips run from',
    description: 'Requires settings:edit. An empty office_address clears it (and its coordinates).',
  })
  @ApiOkResponse({ type: ExpenseSettingsResponse })
  update(
    @Body() dto: UpdateExpenseSettingsDto,
    @CurrentUser('id') actorId: string,
  ): Promise<ExpenseSettingsResponse> {
    return this.settings.update(dto, actorId);
  }
}
