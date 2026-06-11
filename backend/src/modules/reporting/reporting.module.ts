import { Module } from '@nestjs/common';
import { NotificationsModule } from './notifications.module';
import { DashboardsController, LeaderboardController } from './dashboards.controller';
import { TargetsController } from './targets.controller';
import { ReportExportsController } from './report-exports.controller';
import { ReportExportsService } from './report-exports.service';
import { NotificationsController, NotificationSettingsController } from './notifications.controller';
import { ChatbotController } from './chatbot.controller';
import { DashboardsService } from './dashboards.service';
import { TargetsService } from './targets.service';
import { LeaderboardService } from './leaderboard.service';
import { ChatbotService } from './chatbot.service';
import { LLM_PROVIDER, StubLlmProvider } from './chatbot/llm.provider';
import { GeminiLlmProvider } from './chatbot/gemini.provider';
import { LlmProviderRouter } from './chatbot/llm-router.provider';
import { ChatbotConfigCache } from './chatbot/chatbot-config.cache';

/**
 * ReportingModule — the read-layer: four role-scoped dashboards, the counts-only leaderboard, the
 * notification API, and the scoped read-only chatbot. Read-only over existing data — no money recompute,
 * no schema change. Imports NotificationsModule (NotificationsService + the email/emitter stubs); binds
 * the chatbot LLM stub. Every read is scoped server-side. — SRS §14, arch §6.12
 */
@Module({
  imports: [NotificationsModule],
  controllers: [
    DashboardsController,
    LeaderboardController,
    TargetsController,
    ReportExportsController,
    NotificationsController,
    NotificationSettingsController,
    ChatbotController,
  ],
  providers: [
    DashboardsService,
    TargetsService,
    ReportExportsService,
    LeaderboardService,
    ChatbotService,
    ChatbotConfigCache,
    StubLlmProvider,
    GeminiLlmProvider,
    LlmProviderRouter,
    // Router picks Gemini when ChatbotConfig is active + provider 'gemini' + GEMINI_API_KEY present; else stub.
    { provide: LLM_PROVIDER, useExisting: LlmProviderRouter },
  ],
})
export class ReportingModule {}
