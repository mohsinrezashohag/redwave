/**
 * Chatbot API hooks. `useChatQuery` sends a prompt to the authenticated-only, scoped endpoint and returns the
 * text answer; the UI does NO data access of its own. `useChatbotStatus` tells the page whether the AI model
 * is on (so the "basic assistant" banner can go). `useChatbotConfig` / `useSaveChatbotConfig` back the Super
 * Admin settings card (settings:view / settings:edit; the server is the gate). Toasts at the call site.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { unwrap } from '../../../lib/query/unwrap';
import { chatbotKeys } from './keys';
import type { ChatResponse, ChatbotConfig, ChatbotQueryBody, ChatbotStatus, UpdateChatbotConfigBody } from '../chatbot.types';

export function useChatQuery() {
  return useMutation({
    mutationFn: (body: ChatbotQueryBody) => unwrap<ChatResponse>(api.POST('/v1/chatbot/query', { body })),
  });
}

export function useChatbotStatus() {
  return useQuery({
    queryKey: chatbotKeys.status(),
    queryFn: () => unwrap<ChatbotStatus>(api.GET('/v1/chatbot/status')),
  });
}

export function useChatbotConfig(enabled = true) {
  return useQuery({
    queryKey: chatbotKeys.config(),
    queryFn: () => unwrap<ChatbotConfig>(api.GET('/v1/chatbot/config')),
    enabled,
  });
}

export function useSaveChatbotConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateChatbotConfigBody) => unwrap<ChatbotConfig>(api.PATCH('/v1/chatbot/config', { body })),
    onSuccess: (data) => {
      qc.setQueryData(chatbotKeys.config(), data);
      void qc.invalidateQueries({ queryKey: chatbotKeys.status() });
    },
  });
}
