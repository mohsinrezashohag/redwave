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

function make(tool: ChatTool, scopeLevel: 'all' | 'roster' | 'self' = 'self', cfg: Record<string, string> = {}) {
  const prisma = {
    chatbotConversation: { create: jest.fn().mockResolvedValue({ id: 'conv-1' }), count: jest.fn().mockResolvedValue(0) },
    chatbotMessage: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  const scope = { getRepScope: jest.fn().mockResolvedValue(scopeLevel === 'all' ? { level: 'all' } : { level: scopeLevel, repIds: ['rep-1'] }) };
  const dashboards = {
    rep: jest.fn().mockResolvedValue({ internet_activations: 5, commission: { commission: '100.00', net_payout: '120.00' } }),
    manager: jest.fn().mockResolvedValue({ team_internet_activations: 40, pending_validations: 3 }),
    business: jest.fn().mockResolvedValue({ revenue: '1000.00', rep_payout: '600.00', net_margin: '400.00' }),
  };
  const config = { get: jest.fn((k: string) => cfg[k]) };
  const llm = { resolveIntent: jest.fn().mockResolvedValue({ tool }) };
  const service = new ChatbotService(prisma as never, scope as never, dashboards as never, config as never, llm as never);
  return { service, prisma, scope, dashboards, llm, config };
}

describe('ChatbotService scoping (RPT-011 — cannot leak across scope)', () => {
  it('a rep query is answered ONLY from the caller’s own scope (foreign id in prompt is ignored)', async () => {
    const { service, dashboards } = make('my_commission', 'self');
    // Even though the prompt names another rep, the resolved tool calls dashboards.rep(CALLER) only.
    const result = await service.query({ prompt: "what is rep R-999's commission?" }, user({ repId: 'rep-1' }));
    expect(dashboards.rep).toHaveBeenCalledTimes(1);
    expect(dashboards.rep.mock.calls[0][0]).toEqual(expect.objectContaining({ repId: 'rep-1' })); // the caller
    expect(dashboards.manager).not.toHaveBeenCalled();
    expect(dashboards.business).not.toHaveBeenCalled();
    expect(result.answer).toContain('100.00');
  });

  it('a rep routed to a roster tool is REFUSED (not entitled) — no roster query runs', async () => {
    const { service, dashboards } = make('roster_summary', 'self');
    const result = await service.query({ prompt: 'show my whole team' }, user());
    expect(dashboards.manager).not.toHaveBeenCalled();
    expect(result.answer).toMatch(/can't answer/i);
  });

  it('a rep routed to the business tool is REFUSED — no business query runs', async () => {
    const { service, dashboards } = make('business_summary', 'self');
    const result = await service.query({ prompt: 'company revenue please' }, user());
    expect(dashboards.business).not.toHaveBeenCalled();
    expect(result.answer).toMatch(/can't answer/i);
  });

  it('a Super Admin IS entitled to the business tool', async () => {
    const { service, dashboards } = make('business_summary', 'all');
    await service.query({ prompt: 'company revenue' }, user({ isSuperAdmin: true }));
    expect(dashboards.business).toHaveBeenCalledTimes(1);
  });

  it('persists the conversation + user/assistant messages', async () => {
    const { service, prisma } = make('my_commission', 'self');
    await service.query({ prompt: 'my commission?' }, user());
    expect(prisma.chatbotConversation.create).toHaveBeenCalled();
    const msgs = (prisma.chatbotMessage.createMany.mock.calls[0][0] as { data: { role: string }[] }).data;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});

describe('ChatbotService rate-limit / cost cap (graceful 200, not an error)', () => {
  it('caps at CHATBOT_RPM messages/minute with a friendly answer (no LLM call, no persist)', async () => {
    const { service, llm, prisma } = make('my_commission', 'self', { CHATBOT_RPM: '2' });
    const u = user();
    await service.query({ prompt: 'a' }, u); // 1
    await service.query({ prompt: 'b' }, u); // 2
    const capped = await service.query({ prompt: 'c' }, u); // 3 → capped
    expect(capped.intent).toBe('rate_limited');
    expect(capped.answer).toMatch(/try again/i);
    expect(llm.resolveIntent).toHaveBeenCalledTimes(2); // the capped one never reached the LLM
    expect(prisma.chatbotConversation.create).toHaveBeenCalledTimes(2); // nor was it persisted
  });

  it('caps at the daily limit (persisted count) with a friendly answer', async () => {
    const { service, prisma } = make('my_commission', 'self', { CHATBOT_DAILY_CAP: '5' });
    prisma.chatbotConversation.count.mockResolvedValue(5); // already used today
    const capped = await service.query({ prompt: 'hi' }, user());
    expect(capped.intent).toBe('rate_limited');
    expect(capped.answer).toMatch(/limit/i);
  });

  it('allows the request when under both limits', async () => {
    const { service } = make('my_commission', 'self', { CHATBOT_RPM: '10', CHATBOT_DAILY_CAP: '100' });
    const result = await service.query({ prompt: 'my commission' }, user());
    expect(result.intent).toBe('my_commission');
  });
});
