/**
 * Gemini function-calling agent — the AI assistant's conversation loop over the REST `generateContent`
 * API (plain `fetch`, no SDK). The model sees the system prompt, the recent history and the allow-listed
 * function declarations; it may call functions (up to MAX_TOOL_ROUNDS rounds), each executed by the
 * caller-supplied `execute` (which entitlement-gates + scopes to the AuthUser), and then phrases the answer
 * from the tool results. — SRS RPT-011, CLAUDE §5
 *
 * The loop never trusts the model: an unknown function name is answered with an error result (the toolbox
 * is never reached), and the caller decides every tool's scope. THROWS on transport / HTTP / timeout /
 * empty-answer errors, so ChatbotService can fall back to the basic (keyword) path. Never logs prompts.
 */
import { isAiTool } from './ai-tools';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const MAX_TOOL_ROUNDS = 4;
export const CALL_TIMEOUT_MS = 15_000;

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  [key: string]: unknown; // e.g. thoughtSignature — echoed back verbatim
}
export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface AgentRequest {
  apiKey: string;
  model: string;
  systemPrompt: string;
  history: GeminiContent[];
  prompt: string;
  functionDeclarations: ReadonlyArray<Record<string, unknown>>;
  /** Runs one model-requested tool for the CALLER. Must gate + scope; returns compact JSON. */
  execute: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface AgentResult {
  text: string;
  toolsUsed: string[];
}

export async function runGeminiAgent(req: AgentRequest): Promise<AgentResult> {
  const fetchFn = req.fetchFn ?? fetch;
  const contents: GeminiContent[] = [...req.history, { role: 'user', parts: [{ text: req.prompt }] }];
  const toolsUsed: string[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    // On the last round tools are switched off so the model must answer in text.
    const allowTools = round < MAX_TOOL_ROUNDS;
    const content = await callGemini(fetchFn, req, contents, allowTools);
    const parts = content.parts ?? [];
    const calls = parts.filter((p) => p.functionCall?.name);

    if (calls.length === 0 || !allowTools) {
      const text = parts
        .filter((p) => typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join('')
        .trim();
      if (!text) throw new Error('gemini-empty-answer');
      return { text, toolsUsed };
    }

    contents.push({ role: 'model', parts });
    const responses: GeminiPart[] = [];
    for (const part of calls) {
      const name = part.functionCall!.name;
      let response: Record<string, unknown>;
      if (!isAiTool(name)) {
        response = { error: 'This function does not exist.' };
      } else {
        toolsUsed.push(name);
        try {
          response = await req.execute(name, part.functionCall!.args ?? {});
        } catch {
          response = { error: 'This information is unavailable right now.' };
        }
      }
      responses.push({ functionResponse: { name, response } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  throw new Error('gemini-loop-exhausted'); // unreachable: the final round has tools off
}

async function callGemini(
  fetchFn: typeof fetch,
  req: AgentRequest,
  contents: GeminiContent[],
  allowTools: boolean,
): Promise<GeminiContent> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? CALL_TIMEOUT_MS);
  try {
    const res = await fetchFn(`${GEMINI_BASE_URL}/models/${encodeURIComponent(req.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': req.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents,
        tools: [{ functionDeclarations: req.functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: allowTools ? 'AUTO' : 'NONE' } },
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`gemini-http-${res.status}`);
    const body = (await res.json()) as { candidates?: { content?: GeminiContent }[] };
    const content = body.candidates?.[0]?.content;
    if (!content) throw new Error('gemini-no-candidate');
    return { role: 'model', parts: content.parts ?? [] };
  } finally {
    clearTimeout(timer);
  }
}
