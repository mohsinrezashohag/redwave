/**
 * LLM provider seam — the chatbot's natural-language → INTENT boundary. The provider returns ONLY an
 * allow-listed intent (never ids, never SQL, never raw data access). The real Gemini integration
 * rebinds `LLM_PROVIDER` later; the `StubLlmProvider` here is a deterministic keyword router so the
 * scoped tool layer (the real security surface) can be built and tested without a key. — SRS RPT-011, CLAUDE §12
 *
 * SECURITY: because the provider yields only an intent enum (no rep_id), a prompt asking for another
 * rep's data can at most resolve to a `my_*` intent, which the tool then scopes to the CALLER. The LLM
 * can never widen scope.
 */
import { Injectable } from '@nestjs/common';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** The fixed, scoped tool set the chatbot can route to. No free-form queries. */
export type ChatTool =
  | 'my_sales_count'
  | 'my_commission'
  | 'roster_summary'
  | 'business_summary'
  | 'unknown';

export interface ChatIntent {
  tool: ChatTool;
}

/** The five allow-listed intents — exactly the ChatTool union. Reused as the Gemini responseSchema enum
 *  and to validate the model's output. */
export const CHAT_TOOLS: readonly ChatTool[] = [
  'my_sales_count',
  'my_commission',
  'roster_summary',
  'business_summary',
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

/** Deterministic keyword router — the FALLBACK when Gemini is off/unavailable. */
@Injectable()
export class StubLlmProvider implements LlmProvider {
  async resolveIntent(prompt: string): Promise<ChatIntent> {
    const p = prompt.toLowerCase();
    if (/\b(company|business|org|total revenue|payout|margin)\b/.test(p)) return { tool: 'business_summary' };
    if (/\b(roster|team|my reps|my distributors)\b/.test(p)) return { tool: 'roster_summary' };
    if (/\b(commission|earn|earning|pay|paid|net)\b/.test(p)) return { tool: 'my_commission' };
    if (/\b(sale|sales|count|activation|tier)\b/.test(p)) return { tool: 'my_sales_count' };
    return { tool: 'unknown' };
  }
}
