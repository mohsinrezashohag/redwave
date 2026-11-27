import { repCodeFromPrompt, StubLlmProvider } from './llm.provider';

describe('StubLlmProvider small talk routing (2026-11-28)', () => {
  const stub = new StubLlmProvider();
  const tool = async (p: string) => (await stub.resolveIntent(p)).tool;

  it.each([
    ['How are you?', 'greeting'],
    ['hello', 'greeting'],
    ['What do I have access to?', 'help'],
    ['what can you do', 'help'],
    ['Who is Redwave 05?', 'rep_lookup'],
    ['how are my sales this period', 'my_sales_count'],
    ['what is my commission', 'my_commission'],
  ])('%s → %s', async (prompt, expected) => {
    expect(await tool(prompt)).toBe(expected);
  });

  it('extracts the rep code from a who-is question', () => {
    expect(repCodeFromPrompt('Who is Redwave 05?')).toBe('REDWAVE05');
    expect(repCodeFromPrompt("who's rw-900")).toBe('RW900');
    expect(repCodeFromPrompt('who is')).toBeNull();
  });
});
