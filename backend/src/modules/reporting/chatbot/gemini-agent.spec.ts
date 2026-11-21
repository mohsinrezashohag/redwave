import { MAX_TOOL_ROUNDS, runGeminiAgent } from './gemini-agent';

const reply = (parts: unknown[]) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { role: 'model', parts } }] }) });
const base = (fetchFn: jest.Mock, execute = jest.fn().mockResolvedValue({ n: 1 })) => ({
  apiKey: 'k',
  model: 'gemini-2.5-flash',
  systemPrompt: 'sys',
  history: [],
  prompt: 'hello',
  functionDeclarations: [{ name: 'pending_validation_count' }],
  execute,
  fetchFn: fetchFn as never,
});

describe('runGeminiAgent (function-calling loop)', () => {
  it('answers directly when the model returns text', async () => {
    const f = jest.fn().mockResolvedValue(reply([{ text: 'Hi there.' }]));
    await expect(runGeminiAgent(base(f))).resolves.toEqual({ text: 'Hi there.', toolsUsed: [] });
    const [url, init] = f.mock.calls[0];
    expect(url).toContain('/models/gemini-2.5-flash:generateContent');
    const body = JSON.parse(init.body);
    expect(body.tools[0].functionDeclarations).toHaveLength(1);
    expect(body.toolConfig.functionCallingConfig.mode).toBe('AUTO');
  });

  it('never executes a function name outside the allow-list', async () => {
    const execute = jest.fn();
    const f = jest
      .fn()
      .mockResolvedValueOnce(reply([{ functionCall: { name: 'run_sql', args: { q: 'x' } } }]))
      .mockResolvedValueOnce(reply([{ text: 'I cannot do that.' }]));
    const r = await runGeminiAgent(base(f, execute));
    expect(execute).not.toHaveBeenCalled();
    expect(r.toolsUsed).toEqual([]);
  });

  it(`stops after ${MAX_TOOL_ROUNDS} tool rounds and forces a text answer`, async () => {
    const execute = jest.fn().mockResolvedValue({ n: 1 });
    const f = jest.fn().mockImplementation(async (_u: string, init: { body: string }) => {
      const mode = JSON.parse(init.body).toolConfig.functionCallingConfig.mode;
      return mode === 'NONE' ? reply([{ text: 'Done.' }]) : reply([{ functionCall: { name: 'pending_validation_count' } }]);
    });
    const r = await runGeminiAgent(base(f, execute));
    expect(execute).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
    expect(f).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
    expect(r.text).toBe('Done.');
  });

  it('a failing tool returns an error result to the model instead of throwing', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('db down'));
    const f = jest
      .fn()
      .mockResolvedValueOnce(reply([{ functionCall: { name: 'pending_validation_count' } }]))
      .mockResolvedValueOnce(reply([{ text: 'Sorry, unavailable.' }]));
    const r = await runGeminiAgent(base(f, execute));
    expect(r.text).toBe('Sorry, unavailable.');
    expect(JSON.parse(f.mock.calls[1][1].body).contents[2].parts[0].functionResponse.response.error).toMatch(/unavailable/);
  });

  it('throws on an HTTP error or an empty answer (the service then falls back)', async () => {
    await expect(runGeminiAgent(base(jest.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })))).rejects.toThrow(
      'gemini-http-429',
    );
    await expect(runGeminiAgent(base(jest.fn().mockResolvedValue(reply([]))))).rejects.toThrow('gemini-empty-answer');
  });

  it('aborts a hung call after the timeout', async () => {
    const f = jest.fn().mockImplementation(
      (_u: string, init: { signal: AbortSignal }) =>
        new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))),
    );
    await expect(runGeminiAgent({ ...base(f), timeoutMs: 10 })).rejects.toThrow('aborted');
  });
});
