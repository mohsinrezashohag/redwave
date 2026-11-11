/**
 * ChatbotService — the read-only NL assistant's SCOPED query layer. A prompt is mapped to ONE
 * allow-listed intent by the (stubbed) LLM, gated by `isToolAllowed`, then answered by calling the
 * SAME scoped DashboardsService methods — which take only the AuthUser and scope to the caller. No
 * rep_id ever flows from the prompt, so the chatbot CANNOT return another role's/rep's data regardless
 * of what is asked. The LLM never touches the DB. Conversation + messages are persisted. — SRS RPT-011, CLAUDE §5
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { DashboardsService } from './dashboards.service';
import { ChatbotQueryDto } from './dto/chatbot-query.dto';
import { ChatTool, LLM_PROVIDER, LlmProvider } from './chatbot/llm.provider';
import { isToolAllowed } from './chatbot/tools';

const REFUSAL = "Sorry, I can't answer that. It's outside what you have access to.";
const RATE_MESSAGE = "You're sending messages quickly. Please wait a moment and try again.";
const DAILY_MESSAGE = "You've reached today's assistant limit. It resets tomorrow, so please try again then.";

const intCfg = (config: ConfigService, key: string, fallback: number): number => {
  const raw = config.get<string>(key);
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

@Injectable()
export class ChatbotService {
  // Per-user sliding 60s window (in-memory; fine for a single-instance internal ERP). Caps abuse cheaply
  // BEFORE any DB work; the durable daily cap (below) bounds Gemini spend. — arch §security (rate limit)
  private readonly minuteHits = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly dashboards: DashboardsService,
    private readonly config: ConfigService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async query(dto: ChatbotQueryDto, user: AuthUser) {
    // Rate-limit / cost-cap — a GRACEFUL capped answer (HTTP 200), never an error toast. The per-minute
    // check is in-memory + first (no DB hit under a flood); the daily cap reads the persisted count. — RPT-011
    if (this.overPerMinute(user.id)) {
      return this.capped(RATE_MESSAGE);
    }
    if (await this.overDailyCap(user.id)) {
      return this.capped(DAILY_MESSAGE);
    }

    const { tool } = await this.llm.resolveIntent(dto.prompt);
    const scope = await this.scope.getRepScope(user);
    const allowed = isToolAllowed(tool, user, scope.level);

    // The tool is executed ONLY with the AuthUser — never with any id from the prompt. Scope is the
    // caller's; a forbidden/unknown intent never runs a query.
    const answer = allowed ? await this.runTool(tool, user) : REFUSAL;

    // Persist the exchange (audit trail of what was asked/answered).
    const conversation = await this.prisma.chatbotConversation.create({ data: { user_id: user.id } });
    await this.prisma.chatbotMessage.createMany({
      data: [
        { conversation_id: conversation.id, role: 'user', content: dto.prompt },
        { conversation_id: conversation.id, role: 'assistant', content: answer },
      ],
    });

    return { conversation_id: conversation.id, intent: tool, answer };
  }

  /** Each tool calls a SCOPED dashboard method with (user) only — scope is enforced inside. */
  private async runTool(tool: ChatTool, user: AuthUser): Promise<string> {
    switch (tool) {
      case 'my_sales_count': {
        const d = await this.dashboards.rep(user);
        return `You have ${d.internet_activations} internet activation(s) this period (Tier ${d.tier?.tier_number ?? '—'}).`;
      }
      case 'my_commission': {
        const d = await this.dashboards.rep(user);
        return `Your commission this period: $${d.commission.commission_70} (net payout $${d.commission.net_payout}).`;
      }
      case 'my_holdback': {
        const d = await this.dashboards.rep(user);
        return `You have $${d.holdback_pending_release} in holdback pending release.`;
      }
      case 'roster_summary': {
        const d = await this.dashboards.manager(user);
        return `Your roster has ${d.team_internet_activations} internet activation(s) and ${d.pending_validations} sale(s) pending validation.`;
      }
      case 'business_summary': {
        const d = await this.dashboards.business(user, {});
        return `Company: revenue $${d.revenue}, rep payout $${d.rep_payout}, net margin $${d.net_margin}.`;
      }
      default:
        return REFUSAL;
    }
  }

  /** A graceful capped response — no conversation is persisted (cheap; no Gemini call). */
  private capped(answer: string) {
    return { conversation_id: '', intent: 'rate_limited' as const, answer };
  }

  /** True if the user has hit CHATBOT_RPM messages in the last 60s (default 10). Records the hit otherwise. */
  private overPerMinute(userId: string): boolean {
    const limit = intCfg(this.config, 'CHATBOT_RPM', 10);
    const now = Date.now();
    const recent = (this.minuteHits.get(userId) ?? []).filter((t) => t > now - 60_000);
    if (recent.length >= limit) {
      this.minuteHits.set(userId, recent);
      return true;
    }
    recent.push(now);
    this.minuteHits.set(userId, recent);
    return false;
  }

  /** True if the user has already had CHATBOT_DAILY_CAP conversations today (UTC day; default 100). */
  private async overDailyCap(userId: string): Promise<boolean> {
    const cap = intCfg(this.config, 'CHATBOT_DAILY_CAP', 100);
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const used = await this.prisma.chatbotConversation.count({
      where: { user_id: userId, started_at: { gte: startOfDay } },
    });
    return used >= cap;
  }
}
