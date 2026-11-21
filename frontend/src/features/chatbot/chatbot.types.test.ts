/**
 * Chatbot types — every intent the server can return has a chip label (incl. the AI mode's 'ai'), and the
 * suggestion lists stay honest for each mode.
 */
import { describe, expect, it } from 'vitest';
import { AI_SUGGESTIONS, BASIC_SUGGESTIONS, INTENT_LABELS } from './chatbot.types';

describe('chatbot types', () => {
  it('labels the AI intent and the existing basic intents', () => {
    expect(INTENT_LABELS.ai).toBe('AI answer');
    expect(INTENT_LABELS.rate_limited).toBeTruthy();
    expect(INTENT_LABELS.unknown).toBeTruthy();
  });

  it('has suggestions for both modes, none with an em-dash', () => {
    expect(BASIC_SUGGESTIONS.length).toBeGreaterThan(0);
    expect(AI_SUGGESTIONS.length).toBeGreaterThan(0);
    for (const s of [...BASIC_SUGGESTIONS, ...AI_SUGGESTIONS]) expect(s).not.toContain('—');
  });
});
