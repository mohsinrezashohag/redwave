/**
 * GeminiLlmProvider — the REAL natural-language → intent classifier (used when ChatbotConfig is active).
 * Sends ONLY the user's prompt text to Gemini (never any Redwave data) and constrains the output to the
 * six allow-listed intents via a responseSchema enum. On ANY error, an ~8s timeout, or an out-of-enum
 * result it returns `unknown` → the service degrades to the existing refusal path. NEVER throws. The model
 * yields only an intent enum (no ids/SQL), and the scoped tool layer still gates + scopes every answer to
 * the caller, so this cannot widen scope. — SRS RPT-011, CLAUDE §5/§12
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';
import { CHAT_TOOLS, ChatIntent, isChatTool, LlmProvider } from './llm.provider';
import { ChatbotConfigCache } from './chatbot-config.cache';

const TIMEOUT_MS = 8_000;
const DEFAULT_MODEL = 'gemini-3.1-flash-lite'; // matches the seeded ChatbotConfig; current GA id

const SYSTEM_INSTRUCTION = [
  'You are an intent classifier for the Redwave ERP assistant.',
  'Map the user prompt to EXACTLY ONE of these intents and output only that value:',
  "- my_sales_count: the asker's own sales / internet activation count / tier this period.",
  "- my_commission: the asker's own commission / earnings / net payout.",
  '- roster_summary: a manager’s team/roster totals (team activations, pending validations).',
  '- business_summary: company-wide revenue / rep payout / net margin.',
  '- unknown: anything else, or if you are unsure.',
  'Never infer a specific person or id from the prompt; only choose the intent. If in doubt, return unknown.',
].join('\n');

@Injectable()
export class GeminiLlmProvider implements LlmProvider {
  constructor(
    private readonly config: ConfigService,
    private readonly cache: ChatbotConfigCache,
  ) {}

  async resolveIntent(prompt: string): Promise<ChatIntent> {
    try {
      const apiKey = this.config.get<string>('GEMINI_API_KEY');
      if (!apiKey) {
        return { tool: 'unknown' };
      }
      const cfg = await this.cache.get();
      const model = cfg?.model ?? DEFAULT_MODEL;

      const ai = new GoogleGenAI({ apiKey });
      const call = ai.models.generateContent({
        model,
        contents: prompt, // ONLY the user's text — never any Redwave data
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'text/x.enum',
          responseSchema: { type: Type.STRING, enum: [...CHAT_TOOLS] },
        },
      });
      // Swallow a late rejection from the loser of the timeout race (avoid an unhandledRejection).
      call.catch(() => undefined);

      const response = await withTimeout(call, TIMEOUT_MS);
      const raw = (response.text ?? '').trim();
      return { tool: isChatTool(raw) ? raw : 'unknown' };
    } catch {
      return { tool: 'unknown' }; // any error / timeout → degrade to the refusal path
    }
  }
}

/** Reject after `ms` so a slow/hung model call can never block the request. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('gemini-timeout')), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}
