/**
 * Chatbot types — the assistant is a THIN SURFACE over a leak-proof, intent-only backend. The (stubbed) LLM
 * returns an INTENT only; the entitlement-gated tools take ONLY the AuthUser, so a user can only ever get
 * their own-scope data. This UI sends a prompt and renders the SERVER's text answer — it does NO data access
 * and enforces NO scope. The response is `never`-typed in the contract → the response type is hand-written;
 * the request body is re-exported from the generated schema.
 */
import type { components } from '../../api/generated/schema';

/** The intents the stubbed keyword router recognises (echoed back on every answer). */
export type ChatTool = components['schemas']['ChatResponse']['intent'];

/** The server's response — text only (no structured data). Refusals/unknown come back as a normal 200. */
export type ChatResponse = components['schemas']['ChatResponse'];

/** A message in the SESSION-ONLY conversation (component state — there is no history endpoint). */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  intent?: ChatTool; // assistant only — surfaced as a subtle chip
}

// Request body — typed from the generated schema.
export type ChatbotQueryBody = components['schemas']['ChatbotQueryDto'];

/**
 * Suggested prompts — the stubbed LLM only matches a few keyword intents, so these make the preview usable
 * and are honest about what it can answer. Each maps (via the backend's keywords) to one of the tools above.
 */
export const SUGGESTIONS: string[] = [
  'How many sales do I have this period?',
  'What is my commission this period?',
  'How much holdback do I have pending release?',
  'Give me my roster summary.',
  'What is the company revenue and net margin?',
];

/** A friendly label for the intent chip. */
export const INTENT_LABELS: Record<ChatTool, string> = {
  my_sales_count: 'My sales',
  my_commission: 'My commission',
  my_holdback: 'My holdback',
  roster_summary: 'Roster',
  business_summary: 'Business',
  unknown: 'Not understood',
};
