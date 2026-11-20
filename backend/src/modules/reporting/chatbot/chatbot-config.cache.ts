/**
 * ChatbotConfigCache — reads the single ChatbotConfig row (is_active / provider / model) and caches it
 * in-memory for ~30s, so the per-request LLM router + the Gemini provider don't hit the DB on every
 * chatbot call. Read-only; no writes. — SRS RPT-011
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ActiveChatbotConfig {
  is_active: boolean;
  provider: string;
  model: string;
}

@Injectable()
export class ChatbotConfigCache {
  private static readonly TTL_MS = 30_000;
  private cache: { value: ActiveChatbotConfig | null; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** The current ChatbotConfig (cached ~30s). Null if no row exists. */
  async get(): Promise<ActiveChatbotConfig | null> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < ChatbotConfigCache.TTL_MS) {
      return this.cache.value;
    }
    const row = await this.prisma.chatbotConfig.findFirst({
      select: { is_active: true, provider: true, model: true },
    });
    this.cache = { value: row, at: now };
    return row;
  }

  /** Drop the cached row (after the Super Admin changes the config) so the next call re-reads it. */
  invalidate(): void {
    this.cache = null;
  }
}
