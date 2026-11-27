/**
 * ChatbotService — the read-only assistant. Two modes, picked per request:
 *
 *  - **ai**: ChatbotConfig is active (provider gemini) AND `GEMINI_API_KEY` is set. Gemini runs a
 *    function-calling loop (`chatbot/gemini-agent.ts`) over the allow-listed tools in `chatbot/ai-tools.ts`;
 *    every call is entitlement-gated by `isToolAllowed` and executed by `ChatToolbox` with ONLY the AuthUser +
 *    the caller's ScopeService scope, so the model can never widen what the caller can see. The model writes
 *    the answer from the tool results.
 *  - **basic**: the keyword router (`LLM_PROVIDER`) picks ONE intent, answered by a fixed sentence from the
 *    SAME scoped dashboard methods. Also the fallback whenever the AI path fails (never a 500 to the user).
 *
 * Conversations + messages are persisted; a follow-up carries `conversation_id` (own conversations only) and
 * the last ~10 messages are sent as history. Rate limits cap abuse/spend before any model call.
 * — SRS RPT-011, CLAUDE §5
 */
import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService, RepScope } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { AuditService } from '../../common/audit/audit.service';
import { todayInWinnipeg } from '../../common/timezone';
import { DashboardsService } from './dashboards.service';
import { LeaderboardService } from './leaderboard.service';
import { ChatbotQueryDto } from './dto/chatbot-query.dto';
import { UpdateChatbotConfigDto } from './dto/chatbot.dto';
import { ChatTool, LLM_PROVIDER, LlmProvider, repCodeFromPrompt, StubLlmProvider } from './chatbot/llm.provider';
import { isToolAllowed } from './chatbot/tools';
import { ChatbotConfigCache } from './chatbot/chatbot-config.cache';
import { ChatToolbox } from './chatbot/chat-toolbox';
import { FUNCTION_DECLARATIONS, isAiTool } from './chatbot/ai-tools';
import { GeminiContent, runGeminiAgent } from './chatbot/gemini-agent';

const REFUSAL = "Sorry, I can't answer that. It's outside what you have access to.";
const RATE_MESSAGE = "You're sending messages quickly. Please wait a moment and try again.";
const DAILY_MESSAGE = "You've reached today's assistant limit. It resets tomorrow, so please try again then.";
export const DEFAULT_CHATBOT_MODEL = 'gemini-2.5-flash';
const HISTORY_MESSAGES = 10;

type ChatMode = 'ai' | 'basic';
type ChatIntentOut = ChatTool | 'ai' | 'rate_limited';

export interface ChatAnswer {
  conversation_id: string;
  intent: ChatIntentOut;
  answer: string;
  mode: ChatMode;
  tools_used: string[];
}

const intCfg = (config: ConfigService, key: string, fallback: number): number => {
  const raw = config.get<string>(key);
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  // Per-user sliding 60s window (in-memory; fine for a single-instance internal ERP). Caps abuse cheaply
  // BEFORE any DB work; the durable daily cap (below) bounds Gemini spend. — arch §security (rate limit)
  private readonly minuteHits = new Map<string, number[]>();
  /** The deterministic keyword router, used directly when the AI path fails. */
  private readonly fallback = new StubLlmProvider();
  private readonly toolbox: ChatToolbox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly dashboards: DashboardsService,
    private readonly config: ConfigService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly configCache: ChatbotConfigCache,
    leaderboard: LeaderboardService,
    private readonly audit: AuditService,
  ) {
    this.toolbox = new ChatToolbox(prisma, leaderboard, dashboards);
  }

  async query(dto: ChatbotQueryDto, user: AuthUser): Promise<ChatAnswer> {
    // Rate-limit / cost-cap — a GRACEFUL capped answer (HTTP 200), never an error toast. The per-minute
    // check is in-memory + first (no DB hit under a flood); the daily cap reads the persisted count. — RPT-011
    if (this.overPerMinute(user.id)) {
      return this.capped(RATE_MESSAGE);
    }
    if (await this.overDailyCap(user.id)) {
      return this.capped(DAILY_MESSAGE);
    }

    const scope = await this.scope.getRepScope(user);
    const conversationId = await this.ownConversation(dto.conversation_id, user);
    const { mode, model } = await this.resolveMode();

    let result: Omit<ChatAnswer, 'conversation_id'> | null = null;
    if (mode === 'ai') {
      try {
        const history = conversationId ? await this.history(conversationId) : [];
        const { text, toolsUsed } = await runGeminiAgent({
          apiKey: this.config.get<string>('GEMINI_API_KEY')!,
          model,
          systemPrompt: this.systemPrompt(user, scope),
          history,
          prompt: dto.prompt,
          functionDeclarations: FUNCTION_DECLARATIONS,
          // The model only NAMES a tool; the gate + the caller's scope decide everything else.
          execute: async (name, args) => {
            if (!isAiTool(name) || !isToolAllowed(name, user, scope.level)) {
              return { error: 'Not available to this user. Tell them it is outside their access.' };
            }
            return this.toolbox.run(name, args, user, scope);
          },
        });
        result = { intent: 'ai', answer: text, mode: 'ai', tools_used: toolsUsed };
      } catch (err) {
        // Never surface a model/transport failure: degrade to the keyword assistant. (No prompt logged.)
        this.logger.warn(`AI assistant unavailable, using the basic assistant: ${(err as Error).message}`);
      }
    }
    if (!result) {
      result = await this.basicAnswer(mode === 'ai' ? this.fallback : this.llm, dto.prompt, user, scope);
    }

    // Persist the exchange (audit trail of what was asked/answered).
    const convId = conversationId ?? (await this.prisma.chatbotConversation.create({ data: { user_id: user.id } })).id;
    await this.prisma.chatbotMessage.createMany({
      data: [
        { conversation_id: convId, role: 'user', content: dto.prompt },
        { conversation_id: convId, role: 'assistant', content: result.answer },
      ],
    });
    return { conversation_id: convId, ...result };
  }

  /** The assistant's current mode, for the UI banner. */
  async status(): Promise<{ mode: ChatMode }> {
    const { mode } = await this.resolveMode();
    return { mode };
  }

  /** Super Admin settings read. The API key is never returned, only whether one is set. */
  async getConfig() {
    const row = await this.prisma.chatbotConfig.findFirst({ select: { is_active: true, provider: true, model: true } });
    const { mode } = await this.resolveMode();
    return {
      is_active: row?.is_active ?? false,
      provider: row?.provider ?? 'gemini',
      model: row?.model || this.defaultModel(),
      api_key_configured: !!this.config.get<string>('GEMINI_API_KEY'),
      mode,
    };
  }

  /** Super Admin settings write: toggle the AI model and/or set its id. Audited. */
  async updateConfig(dto: UpdateChatbotConfigDto, user: AuthUser) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException('Only the Super Admin can change the assistant settings.');
    }
    const before = await this.prisma.chatbotConfig.findFirst();
    const data = {
      provider: 'gemini', // the only supported provider
      ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
      ...(dto.model !== undefined ? { model: dto.model } : {}),
      updated_by: user.id,
    };
    const after = before
      ? await this.prisma.chatbotConfig.update({ where: { id: before.id }, data })
      : await this.prisma.chatbotConfig.create({
          data: {
            is_active: dto.is_active ?? false,
            model: dto.model ?? this.defaultModel(),
            config_json: {},
            ...data,
          },
        });
    await this.audit.log({
      actorId: user.id,
      entityType: 'chatbot_config',
      entityId: after.id,
      action: before ? 'update' : 'create',
      before: before ? { is_active: before.is_active, provider: before.provider, model: before.model } : null,
      after: { is_active: after.is_active, provider: after.provider, model: after.model },
    });
    this.configCache.invalidate();
    return this.getConfig();
  }

  // ── internals ──────────────────────────────────────────────────────────────────────────────────────

  private defaultModel(): string {
    return this.config.get<string>('CHATBOT_MODEL') || DEFAULT_CHATBOT_MODEL;
  }

  /** ai when the config is active + provider gemini + a key is set; anything else (or a read error) → basic. */
  private async resolveMode(): Promise<{ mode: ChatMode; model: string }> {
    try {
      const cfg = await this.configCache.get();
      const key = this.config.get<string>('GEMINI_API_KEY');
      const ai = !!cfg?.is_active && cfg.provider === 'gemini' && !!key;
      return { mode: ai ? 'ai' : 'basic', model: cfg?.model || this.defaultModel() };
    } catch {
      return { mode: 'basic', model: this.defaultModel() };
    }
  }

  /** The keyword path: one intent → one scoped fixed-sentence answer. */
  private async basicAnswer(provider: LlmProvider, prompt: string, user: AuthUser, scope: RepScope) {
    const { tool } = await provider.resolveIntent(prompt);
    const allowed = isToolAllowed(tool, user, scope.level);
    // Executed ONLY with the AuthUser — never with any id from the prompt.
    // The one exception is `rep_lookup`: it reads a rep CODE, and the lookup is scoped in the query.
    let answer: string;
    if (!allowed) answer = tool === 'rep_lookup' ? this.repLookupRefusal() : REFUSAL;
    else if (tool === 'greeting') answer = `Hi ${user.full_name.split(' ')[0] || 'there'}, I'm doing well, thanks. ${this.helpText(user, scope)}`;
    else if (tool === 'help') answer = this.helpText(user, scope);
    else if (tool === 'rep_lookup') answer = await this.repLookupAnswer(prompt, scope);
    else answer = await this.runTool(tool, user);
    return { intent: tool as ChatIntentOut, answer, mode: 'basic' as const, tools_used: [] as string[] };
  }

  /** What this person can ask, by role. Never lists something their scope would refuse. — 2026-11-28 */
  private helpText(user: AuthUser, scope: RepScope): string {
    const topics: string[] = [];
    if (user.repId) topics.push('your sales this period', 'your commission and pay');
    if (scope.level === 'roster' || scope.level === 'all') topics.push(scope.level === 'all' ? 'company sales totals' : 'your team’s sales');
    if (user.repId || scope.level !== 'self') topics.push('who a rep is, by rep code (for example "Who is REDWAVE05?")');
    if (user.isSuperAdmin) topics.push('the business summary');
    if (topics.length === 0) return 'Your login has no rep profile or team, so there is no sales data I can show you yet.';
    return `You can ask me about ${topics.join(', ')}.`;
  }

  private repLookupRefusal(): string {
    return 'I can look up reps only for people with a rep profile or a team.';
  }

  /** "Who is REDWAVE05?" → name, status and manager, scoped to the caller's reps. */
  private async repLookupAnswer(prompt: string, scope: RepScope): Promise<string> {
    const code = repCodeFromPrompt(prompt);
    if (!code) return 'Tell me the rep code, for example "Who is REDWAVE05?".';
    const r = await this.toolbox.repLookup(scope, { rep_code: code });
    if (!r.found) return `I couldn't find a rep with code ${code} that you can see.`;
    const manager = r.field_manager ? ` Their field manager is ${String(r.field_manager)}.` : '';
    return `${String(r.rep_code)} is ${String(r.name)} (${String(r.status)}).${manager}`;
  }

  /** A conversation id the caller OWNS, else null (a foreign/unknown id silently starts a new one). */
  private async ownConversation(id: string | undefined, user: AuthUser): Promise<string | null> {
    if (!id) return null;
    const conv = await this.prisma.chatbotConversation.findFirst({ where: { id, user_id: user.id }, select: { id: true } });
    return conv?.id ?? null;
  }

  /** The last ~10 messages as Gemini contents, oldest first, starting on a user turn. */
  private async history(conversationId: string): Promise<GeminiContent[]> {
    const rows = await this.prisma.chatbotMessage.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'desc' },
      take: HISTORY_MESSAGES,
      select: { role: true, content: true },
    });
    const ordered = rows.reverse();
    while (ordered.length && ordered[0].role !== 'user') ordered.shift();
    return ordered.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
  }

  private systemPrompt(user: AuthUser, scope: RepScope): string {
    const who =
      scope.level === 'all' ? 'an administrator (company-wide view)' : scope.level === 'roster' ? 'a field manager' : 'a sales rep';
    return [
      'You are the Redwave assistant inside the Redwave ERP for a telecom sales agency (internet, TV and home phone sales by field reps).',
      `Today is ${todayInWinnipeg()} (America/Winnipeg). The person asking is ${user.full_name}, ${who}${user.repId ? '' : ' without a rep profile'}.`,
      'Answer ONLY from the results of the tools provided. Call a tool whenever the question needs Redwave data; never guess or invent numbers, names or statuses.',
      'Every tool already limits data to what this person may see. If a tool says something is not available, say it is outside their access. Never claim to see other reps\' earnings: the leaderboard and team tools are counts only.',
      '"Pending" means entered and waiting for validation; "approved" means validated, in a pay run, or paid.',
      'Money values are CAD unless a currency is given; show them exactly as returned with a $ sign. Do not add up or recalculate money.',
      'Write short, plain answers in Canadian English: one to three sentences, or a short list. No markdown tables, no em-dashes.',
      'Answer greetings and small talk warmly in one short sentence, then say what you can help with. If the question is not about Redwave data, briefly say what you can help with: sales counts and statuses, sales waiting for review, pay statements, expenses, the leaderboard, team summaries, and who a rep is by rep code.',
    ].join('\n');
  }

  /** Basic mode: each intent calls a SCOPED dashboard method with (user) only — scope is enforced inside. */
  private async runTool(tool: ChatTool, user: AuthUser): Promise<string> {
    switch (tool) {
      case 'my_sales_count': {
        const d = await this.dashboards.rep(user);
        return `You have ${d.internet_activations} internet activation(s) this period.`;
      }
      case 'my_commission': {
        const d = await this.dashboards.rep(user);
        return `Your commission this period: $${d.commission.commission} (net payout $${d.commission.net_payout}).`;
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

  /** A graceful capped response — nothing persisted (cheap; no model call). */
  private capped(answer: string): ChatAnswer {
    return { conversation_id: '', intent: 'rate_limited', answer, mode: 'basic', tools_used: [] };
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

  /**
   * True if the user has already sent CHATBOT_DAILY_CAP messages today (UTC day; default 100). Counts the
   * persisted USER messages (a conversation now holds many), so the cap is per question asked.
   */
  private async overDailyCap(userId: string): Promise<boolean> {
    const cap = intCfg(this.config, 'CHATBOT_DAILY_CAP', 100);
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const used = await this.prisma.chatbotMessage.count({
      where: { role: 'user', created_at: { gte: startOfDay }, conversation: { user_id: userId } },
    });
    return used >= cap;
  }
}
