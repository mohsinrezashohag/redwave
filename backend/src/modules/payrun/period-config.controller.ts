/**
 * PeriodConfigController — /v1/period-configs: the pay and billing CALENDARS as admin configuration.
 *
 * Reads are `payrun:view`; writes and regeneration are `settings:edit` (Super Admin), because changing a
 * calendar shape reaches every module that derives a period — sales (#7), pay runs, expenses, billing. No
 * new permission: it rides `settings`, which already gates system-wide configuration.
 *
 * Regeneration is FORWARD-ONLY and the guard lives in the service, not here — a UI warning is not a
 * control. Preview and apply share one planner, so what an admin is shown is what would happen. — arch §6
 */
import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { PeriodConfigService } from './period-config.service';
import { RegeneratePeriodsDto, SetPeriodConfigDto } from './dto/period-config.dto';
import {
  CalendarOverlapResponse,
  PeriodConfigResponse,
  RegenerationPlanResponse,
} from './dto/period-config.response';

@ApiTags('Pay Run & Holdback')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('period-configs')
export class PeriodConfigController {
  constructor(private readonly periodConfigs: PeriodConfigService) {}

  @Get()
  @RequirePermission('payrun', 'view')
  @ApiOperation({
    summary: 'List the configured calendar shapes (pay + billing)',
    description:
      'Requires payrun:view. Effective-dated history (#10). An empty list means both calendars still use ' +
      'the seeded genesis shapes.',
  })
  @ApiOkResponse({ type: PeriodConfigResponse, isArray: true })
  list() {
    return this.periodConfigs.list();
  }

  @Post()
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Record a new calendar shape',
    description:
      'Requires settings:edit. Records intent ONLY — it moves no period. Periods change when an admin ' +
      'then regenerates, which is a separate, guarded action.',
  })
  @ApiOkResponse({ type: PeriodConfigResponse })
  set(@Body() dto: SetPeriodConfigDto, @CurrentUser() user: AuthUser) {
    return this.periodConfigs.set(dto, user);
  }

  @Post('regenerate/preview')
  @HttpCode(200)
  @RequirePermission('payrun', 'view')
  @ApiOperation({
    summary: 'Preview a regeneration — what would change, and what is refused',
    description:
      'Requires payrun:view. Writes NOTHING. Shares its planner with the apply, so the preview cannot ' +
      'disagree with the outcome. `blocked[]` names each frozen period and the document freezing it.',
  })
  @ApiOkResponse({ type: RegenerationPlanResponse })
  preview(@Body() dto: RegeneratePeriodsDto) {
    return this.periodConfigs.previewRegeneration(dto.kind, dto.count);
  }

  @Post('regenerate')
  @HttpCode(200)
  @RequirePermission('settings', 'edit')
  @ApiOperation({
    summary: 'Regenerate FUTURE periods from the configured shape',
    description:
      'Requires settings:edit. Forward-only: refuses with 422 (carrying `blocked[]`) if any period in ' +
      'range holds a finalized pay run or an issued statement/invoice — a partial move is worse than a ' +
      'refusal. Existing rows are updated in place, never deleted (#2).',
  })
  @ApiOkResponse({ type: RegenerationPlanResponse })
  regenerate(@Body() dto: RegeneratePeriodsDto, @CurrentUser() user: AuthUser) {
    return this.periodConfigs.regenerate(dto.kind, dto.count, user);
  }

  @Get('overlap/:payPeriodNumber')
  @RequirePermission('payrun', 'view')
  @ApiOperation({
    summary: 'Which billing weeks fall inside one pay period',
    description:
      'Requires payrun:view. The two-calendar boundary made visible (§14 rule 1): a bill straddles two ' +
      'pay periods by design, so a period will never reconcile exactly against a billing week.',
  })
  @ApiOkResponse({ type: CalendarOverlapResponse })
  overlap(@Param('payPeriodNumber', ParseIntPipe) payPeriodNumber: number) {
    return this.periodConfigs.calendarOverlap(payPeriodNumber);
  }
}
