/**
 * Chatbot types — the assistant is a THIN SURFACE over a scoped backend. In AI mode the model can only call
 * allow-listed, entitlement-gated tools that take ONLY the AuthUser; in basic mode a keyword router picks one
 * scoped intent. Either way a user only ever gets their own-scope data. This UI sends a prompt (plus the
 * conversation id for follow-ups) and renders the SERVER's text answer; it does NO data access and enforces
 * NO scope. Types alias the generated schema.
 */
import type { components } from '../../api/generated/schema';

/** The intent echoed back on every answer ('ai' = the language model answered). */
export type ChatTool = components['schemas']['ChatResponse']['intent'];

/** The server's response: text only (no structured data). Refusals/unknown come back as a normal 200. */
export type ChatResponse = components['schemas']['ChatResponse'];

/** Which mode the assistant is in: 'ai' (language model) or 'basic' (keyword assistant). */
export type ChatbotStatus = components['schemas']['ChatbotStatusResponse'];
export type ChatbotMode = ChatbotStatus['mode'];

/** Super Admin settings (the API key is never returned, only whether it is configured). */
export type ChatbotConfig = components['schemas']['ChatbotConfigResponse'];
export type UpdateChatbotConfigBody = components['schemas']['UpdateChatbotConfigDto'];

/** A message in the on-screen conversation (component state). */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  intent?: ChatTool; // assistant only — surfaced as a subtle chip
}

// Request body — typed from the generated schema.
export type ChatbotQueryBody = components['schemas']['ChatbotQueryDto'];

/** Suggested prompts. The basic assistant matches a few keyword intents, so its list stays honest. */
export const BASIC_SUGGESTIONS: string[] = [
  'How many sales do I have this period?',
  'What is my commission this period?',
  'Give me my roster summary.',
  'What is the company revenue and net margin?',
];

/** With the AI model on, the assistant can answer a wider set (every answer is still scoped server-side). */
export const AI_SUGGESTIONS: string[] = [
  'How many of my sales are waiting for review?',
  'What was on my last pay statement?',
  'Where am I on the leaderboard?',
  'What is the status of my expenses?',
];


/** A friendly label for the intent chip. */
export const INTENT_LABELS: Record<ChatTool, string> = {
  my_sales_count: 'My sales',
  my_commission: 'My commission',
  roster_summary: 'Roster',
  business_summary: 'Business',
  unknown: 'Not understood',
  rate_limited: 'Slow down', // a graceful "try again shortly" cap — rendered as a normal assistant bubble
  ai: 'AI answer',
};

/** Suggested Gemini model ids for the settings picker (any valid id may be typed). */
export const MODEL_SUGGESTIONS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];
