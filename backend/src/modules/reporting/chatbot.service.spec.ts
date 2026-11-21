import { ChatbotService } from './chatbot.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { ChatTool } from './chatbot/llm.provider';

const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u1',
  email: 'u@x.co',
  full_name: 'U',
  status: 'active',
  roleNames: [],
  isSuperAdmin: false,
  permissions: new Set(),
  repId: 'rep-1',
  ...over,
});

interface MakeOpts {
  scopeLevel?: 'all' | 'roster' | 'self';
  cfg?: Record<string, string>;
  chatbotConfig?: { is_active: boolean; provider: string; model: string } | null;
}

function make(tool: ChatTool, opts: MakeOpts = {}) {
  const { scopeLevel = 'self', cfg = {}, chatbotConfig = null } = opts;
  const prisma = {
    chatbotConversation: {
      create: jest.fn().mockResolvedValue({ id: 'conv-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    chatbotMessage: {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    chatbotConfig: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'cfg-1', ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'cfg-1', ...data })),
    },
    // Used by the AI toolbox.
    payRunLine: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const scope = {
    getRepScope: jest.fn().mockResolvedValue(scopeLevel === 'all' ? { level: 'all' } : { level: scopeLevel, repIds: ['rep-1'] }),
  };
  const dashboards = {
    rep: jest.fn().mockResolvedValue({ internet_activations: 5, commission: { commission: '100.00', net_payout: '120.00' } }),
    manager: jest.fn().mockResolvedValue({ team_internet_activations: 40, pending_validations: 3 }),
    business: jest.fn().mockResolvedValue({ revenue: '1000.00', rep_payout: '600.00', net_margin: '400.00' }),
  };
  const config = { get: jest.fn((k: string) => cfg[k]) };
  const llm = { resolveIntent: jest.fn().mockResolvedValue({ tool }) };
  const cache = { get: jest.fn().mockResolvedValue(chatbotConfig), invalidate: jest.fn() };
  const leaderboard = { list: jest.fn().mockResolvedValue({ period: null, rankings: [] }) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new ChatbotService(
    prisma as never,
    scope as never,
    dashboards as never,
    config as never,
    llm as never,
    cache as never,
    leaderboard as never,
    audit as never,
  );
  return { service, prisma, scope, dashboards, llm, config, cache, audit };
}

describe('ChatbotService scoping (RPT-011 — cannot leak across scope)', () => {
  it('a rep query is answered ONLY from the caller’s own scope (foreign id in prompt is ignored)', async () => {
    const { service, dashboards } = make('my_commission');
    const result = await service.query({ prompt: "what is rep R-999's commission?" }, user({ repId: 'rep-1' }));
    expect(dashboards.rep).toHaveBeenCalledTimes(1);
    expect(dashboards.rep.mock.calls[0][0]).toEqual(expect.objectContaining({ repId: 'rep-1' })); // the caller
    expect(dashboards.manager).not.toHaveBeenCalled();
    expect(dashboards.business).not.toHaveBeenCalled();
    expect(result.answer).toContain('100.00');
    expect(result.mode).toBe('basic');
  });

  it('a rep routed to a roster tool is REFUSED (not entitled) — no roster query runs', async () => {
    const { service, dashboards } = make('roster_summary');
    const result = await service.query({ prompt: 'show my whole team' }, user());
    expect(dashboards.manager).not.toHaveBeenCalled();
    expect(result.answer).toMatch(/can't answer/i);
  });

  it('a rep routed to the business tool is REFUSED — no business query runs', async () => {
    const { service, dashboards } = make('business_summary');
    const result = await service.query({ prompt: 'company revenue please' }, user());
    expect(dashboards.business).not.toHaveBeenCalled();
    expect(result.answer).toMatch(/can't answer/i);
  });

  it('a Super Admin IS entitled to the business tool', async () => {
    const { service, dashboards } = make('business_summary', { scopeLevel: 'all' });
    await service.query({ prompt: 'company revenue' }, user({ isSuperAdmin: true }));
    expect(dashboards.business).toHaveBeenCalledTimes(1);
  });

  it('persists the conversation + user/assistant messages', async () => {
    const { service, prisma } = make('my_commission');
    const result = await service.query({ prompt: 'my commission?' }, user());
    expect(prisma.chatbotConversation.create).toHaveBeenCalled();
    const msgs = (prisma.chatbotMessage.createMany.mock.calls[0][0] as { data: { role: string }[] }).data;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(result.conversation_id).toBe('conv-1');
  });

  it('continues an OWN conversation; a foreign conversation id starts a new one', async () => {
    const { service, prisma } = make('my_commission');
    prisma.chatbotConversation.findFirst.mockResolvedValueOnce({ id: 'mine' });
    const r1 = await service.query({ prompt: 'a', conversation_id: '11111111-1111-1111-1111-111111111111' }, user());
    expect(prisma.chatbotConversation.findFirst.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ user_id: 'u1' }), // ownership is in the query
    );
    expect(r1.conversation_id).toBe('mine');
    expect(prisma.chatbotConversation.create).not.toHaveBeenCalled();

    const r2 = await service.query({ prompt: 'b', conversation_id: '22222222-2222-2222-2222-222222222222' }, user());
    expect(r2.conversation_id).toBe('conv-1'); // not owned → new conversation
  });
});

describe('ChatbotService AI mode (Gemini function calling)', () => {
  const AI = { is_active: true, provider: 'gemini', model: 'gemini-2.5-flash' };
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const reply = (parts: unknown[]) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { role: 'model', parts } }] }) });

  it('runs the model’s tool call with the CALLER only, then returns the model’s answer', async () => {
    const { service, prisma, llm } = make('unknown', { cfg: { GEMINI_API_KEY: 'k' }, chatbotConfig: AI });
    prisma.payRunLine.findFirst.mockResolvedValue({
      commission: { toFixed: () => '500.00' },
      expense_total: { toFixed: () => '0.00' },
      incentive_total: { toFixed: () => '0.00' },
      bonus_amount: { toFixed: () => '0.00' },
      clawback_total: { toFixed: () => '30.00' },
      net_payout: { toFixed: () => '470.00' },
      pay_run: { label: null, run_date: new Date('2026-11-14T00:00:00Z'), date_from: null, date_to: null, pay_period: null },
    });
    const fetchMock = jest
      .fn()
      // The model tries to smuggle another rep's id; the tool ignores args it doesn't declare.
      .mockResolvedValueOnce(reply([{ functionCall: { name: 'my_pay_summary', args: { rep_id: 'rep-OTHER' } } }]))
      .mockResolvedValueOnce(reply([{ text: 'Your last net payout was $470.00.' }]));
    global.fetch = fetchMock as never;

    const result = await service.query({ prompt: 'what did I get paid?' }, user());
    expect(result).toEqual(expect.objectContaining({ mode: 'ai', intent: 'ai', tools_used: ['my_pay_summary'] }));
    expect(result.answer).toBe('Your last net payout was $470.00.');
    expect(prisma.payRunLine.findFirst.mock.calls[0][0].where.rep_id).toBe('rep-1');
    expect(llm.resolveIntent).not.toHaveBeenCalled();
    // The second model call carries the tool result back as a functionResponse.
    const body2 = JSON.parse(fetchMock.mock.calls[1][1].body);
    const last = body2.contents[body2.contents.length - 1];
    expect(last.parts[0].functionResponse.response.net_payout).toBe('470.00');
    expect(fetchMock.mock.calls[0][1].headers['x-goog-api-key']).toBe('k');
  });

  it('a tool the caller is not entitled to is refused to the model (never executed)', async () => {
    const { service, dashboards } = make('unknown', { cfg: { GEMINI_API_KEY: 'k' }, chatbotConfig: AI });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(reply([{ functionCall: { name: 'business_summary', args: {} } }]))
      .mockResolvedValueOnce(reply([{ text: 'That is outside your access.' }]));
    global.fetch = fetchMock as never;
    const result = await service.query({ prompt: 'company revenue?' }, user());
    expect(dashboards.business).not.toHaveBeenCalled();
    const body2 = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(JSON.stringify(body2.contents)).toMatch(/outside their access/);
    expect(result.mode).toBe('ai');
  });

  it('falls back to the basic assistant when Gemini errors (never a 500)', async () => {
    const { service, dashboards } = make('unknown', { cfg: { GEMINI_API_KEY: 'k' }, chatbotConfig: AI });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }) as never;
    const result = await service.query({ prompt: 'how many sales do I have?' }, user());
    expect(result.mode).toBe('basic');
    expect(result.intent).toBe('my_sales_count'); // the built-in keyword router, not the Gemini classifier
    expect(dashboards.rep).toHaveBeenCalledTimes(1);
  });

  it('uses basic mode without a key even when the config is active', async () => {
    const { service } = make('my_sales_count', { chatbotConfig: AI });
    global.fetch = jest.fn() as never;
    const result = await service.query({ prompt: 'sales?' }, user());
    expect(result.mode).toBe('basic');
    expect(global.fetch).not.toHaveBeenCalled();
    await expect(service.status()).resolves.toEqual({ mode: 'basic' });
  });

  it('sends the last messages of an own conversation as history', async () => {
    const { service, prisma } = make('unknown', { cfg: { GEMINI_API_KEY: 'k' }, chatbotConfig: AI });
    prisma.chatbotConversation.findFirst.mockResolvedValue({ id: 'mine' });
    prisma.chatbotMessage.findMany.mockResolvedValue([
      { role: 'assistant', content: 'You have 3.' },
      { role: 'user', content: 'How many sales?' },
    ]); // newest first, as queried
    const fetchMock = jest.fn().mockResolvedValue(reply([{ text: 'Sure.' }]));
    global.fetch = fetchMock as never;
    await service.query({ prompt: 'and pending?', conversation_id: '11111111-1111-1111-1111-111111111111' }, user());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
    expect(body.contents[2].parts[0].text).toBe('and pending?');
  });
});

describe('ChatbotService settings', () => {
  it('only the Super Admin may change the config; the change is audited and the cache dropped', async () => {
    const { service, audit, cache } = make('unknown');
    await expect(service.updateConfig({ is_active: true }, user())).rejects.toThrow(/Super Admin/);
    const result = await service.updateConfig({ is_active: true, model: 'gemini-2.5-pro' }, user({ isSuperAdmin: true }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'chatbot_config', action: 'create' }));
    expect(cache.invalidate).toHaveBeenCalled();
    expect(result).toHaveProperty('api_key_configured', false);
    expect(JSON.stringify(result)).not.toMatch(/GEMINI_API_KEY/);
  });
});

describe('ChatbotService rate-limit / cost cap (graceful 200, not an error)', () => {
  it('caps at CHATBOT_RPM messages/minute with a friendly answer (no LLM call, no persist)', async () => {
    const { service, llm, prisma } = make('my_commission', { cfg: { CHATBOT_RPM: '2' } });
    const u = user();
    await service.query({ prompt: 'a' }, u); // 1
    await service.query({ prompt: 'b' }, u); // 2
    const capped = await service.query({ prompt: 'c' }, u); // 3 → capped
    expect(capped.intent).toBe('rate_limited');
    expect(capped.answer).toMatch(/try again/i);
    expect(llm.resolveIntent).toHaveBeenCalledTimes(2);
    expect(prisma.chatbotMessage.createMany).toHaveBeenCalledTimes(2);
  });

  it('caps at the daily limit (persisted user-message count) with a friendly answer', async () => {
    const { service, prisma } = make('my_commission', { cfg: { CHATBOT_DAILY_CAP: '5' } });
    prisma.chatbotMessage.count.mockResolvedValue(5); // already used today
    const capped = await service.query({ prompt: 'hi' }, user());
    expect(capped.intent).toBe('rate_limited');
    expect(capped.answer).toMatch(/limit/i);
    expect(prisma.chatbotMessage.count.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ role: 'user', conversation: { user_id: 'u1' } }),
    );
  });

  it('allows the request when under both limits', async () => {
    const { service } = make('my_commission', { cfg: { CHATBOT_RPM: '10', CHATBOT_DAILY_CAP: '100' } });
    const result = await service.query({ prompt: 'my commission' }, user());
    expect(result.intent).toBe('my_commission');
  });
});
