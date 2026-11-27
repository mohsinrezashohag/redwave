/**
 * LLM provider seam — the chatbot's natural-language → INTENT boundary. The provider returns ONLY an
 * allow-listed intent (never ids, never SQL, never raw data access). The real Gemini integration
 * rebinds `LLM_PROVIDER` later; the `StubLlmProvider` here is a deterministic keyword router so the
 * scoped tool layer (the real security surface) can be built and tested without a key. — SRS RPT-011, CLAUDE §12
 *
 * SECURITY: because the provider yields only an intent enum (no rep_id), a prompt asking for another
 * rep's data can at most resolve to a `my_*` intent, which the tool then scopes to the CALLER. The LLM
 * can never widen scope. `rep_lookup` reads a rep CODE from the prompt, and its tool scopes that lookup
 * to the caller's reps in the query (an out-of-scope code answers like an unknown one).
 */
import { Injectable } from '@nestjs/common';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** The fixed, scoped tool set the chatbot can route to. No free-form queries. */
export type ChatTool =
  | 'my_sales_count'
  | 'my_commission'
  | 'roster_summary'
  | 'business_summary'
  | 'greeting'
  | 'help'
  | 'rep_lookup'
  | 'unknown';

export interface ChatIntent {
  tool: ChatTool;
}

/** The allow-listed intents — exactly the ChatTool union. Used to validate a resolved intent. */
export const CHAT_TOOLS: readonly ChatTool[] = [
  'my_sales_count',
  'my_commission',
  'roster_summary',
  'business_summary',
  'greeting',
  'help',
  'rep_lookup',
  'unknown',
];

/** Narrow an arbitrary string to a ChatTool. */
export function isChatTool(value: string): value is ChatTool {
  return (CHAT_TOOLS as readonly string[]).includes(value);
}

export interface LlmProvider {
  /** Map a free-text prompt to ONE allow-listed intent. Pure routing — no ids, no SQL, no data. */
  resolveIntent(prompt: string): Promise<ChatIntent>;
}

// Small talk and "what can you do" get a real answer instead of the refusal (App Review Feedback #4,
// 2026-11-28). Checked before the data intents so "how are you" is not read as a question about sales.
const WHO_IS = /\bwho(?: is|'s)\b/;
const HELP = /what can (?:you|i)\b|what do i have access|\baccess to\b|^help\b|how do i use|what are you/;
const GREETING = /^(?:hi|hello|hey|yo|good (?:morning|afternoon|evening))\b|how are you|^thanks?\b|thank you/;

/** Deterministic keyword router — the FALLBACK when Gemini is off/unavailable. */
@Injectable()
export class StubLlmProvider implements LlmProvider {
  async resolveIntent(prompt: string): Promise<ChatIntent> {
    const p = prompt.toLowerCase().trim();
    if (WHO_IS.test(p)) return { tool: 'rep_lookup' };
    if (HELP.test(p)) return { tool: 'help' };
    if (GREETING.test(p)) return { tool: 'greeting' };
    if (/\b(company|business|org|total revenue|payout|margin)\b/.test(p)) return { tool: 'business_summary' };
    if (/\b(roster|team|my reps|my distributors)\b/.test(p)) return { tool: 'roster_summary' };
    if (/\b(commission|earn|earning|pay|paid|net)\b/.test(p)) return { tool: 'my_commission' };
    if (/\b(sale|sales|count|activation|tier)\b/.test(p)) return { tool: 'my_sales_count' };
    return { tool: 'unknown' };
  }
}

/** The rep code a "who is …" question names ("Who is Redwave 05?" → "REDWAVE05"), else null. */
export function repCodeFromPrompt(prompt: string): string | null {
  const m = /\bwho(?: is|'s)\s+(.+?)\s*\??\s*$/i.exec(prompt.trim());
  if (!m) return null;
  const code = m[1].replace(/[\s_-]+/g, '').toUpperCase();
  return /^[A-Z0-9]{1,32}$/.test(code) ? code : null;
}
