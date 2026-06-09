/**
 * Dashboards + leaderboard controllers — /v1/dashboards/* and /v1/leaderboard. — arch §6.12
 * Rep dashboard is authenticated-only (scoped to the caller's own rep in the service). Manager/admin require
 * reports:view + a service scope-gate (manager=roster, admin=Admin/SA); the business dashboard + trends
 * require the off-grid reports:business (Super Admin only). The leaderboard is counts-only.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/errors/api-error-responses.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { DashboardsService } from './dashboards.service';
import { LeaderboardService } from './leaderboard.service';
import { DashboardQuery } from './dto/dashboard-query.dto';
import {
  AdminDashboardResponse,
  LeaderboardResponse,
  ManagerDashboardResponse,
  RepDashboardResponse,
} from './dto/reporting.response';
import { BusinessDashboardResponse } from './dto/business-dashboard.response';

@ApiTags('Reporting & Dashboards')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get('rep')
  @ApiOperation({ summary: "Rep's own dashboard", description: 'Authenticated; scoped to the caller’s own rep.' })
  @ApiOkResponse({ type: RepDashboardResponse })
  rep(@CurrentUser() user: AuthUser) {
    return this.dashboards.rep(user);
  }

  @Get('manager')
  @RequirePermission('reports', 'view')
  @ApiOperation({ summary: 'Manager dashboard', description: 'Requires reports:view; scoped to the caller’s roster (bare rep → 403).' })
  @ApiOkResponse({ type: ManagerDashboardResponse })
  manager(@CurrentUser() user: AuthUser) {
    return this.dashboards.manager(user);
  }

  @Get('business')
  @RequirePermission('reports', 'business')
  @ApiOperation({ summary: 'Business / executive dashboard', description: 'Requires reports:business (Super Admin only).' })
  @ApiOkResponse({ type: BusinessDashboardResponse })
  business(@CurrentUser() user: AuthUser, @Query() query: DashboardQuery) {
    return this.dashboards.business(user, query);
  }

  @Get('admin')
  @RequirePermission('reports', 'view')
  @ApiOperation({ summary: 'Admin operational home (queues)', description: 'Requires reports:view AND Admin/Super Admin.' })
  @ApiOkResponse({ type: AdminDashboardResponse })
  admin(@CurrentUser() user: AuthUser) {
    return this.dashboards.admin(user);
  }
}

@ApiTags('Reporting & Dashboards')
@ApiBearerAuth()
@ApiErrorResponses()
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  @Get()
  @RequirePermission('reports', 'view')
  @ApiOperation({
    summary: 'Company-wide leaderboard (counts only)',
    description: 'Requires reports:view. Ranked by internet activation count for the period — no earnings.',
  })
  @ApiOkResponse({ type: LeaderboardResponse })
  list() {
    return this.leaderboard.list();
  }
}
