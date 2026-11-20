/**
 * ChatbotPage — /chatbot. A THIN SURFACE over the scoped assistant: it sends a prompt (with the conversation id
 * for follow-ups, so the AI model has context) and renders the server's text answer. It does NO data access and
 * enforces NO scope; the backend guarantees a user only ever gets their own-scope data. The endpoint is
 * AUTHENTICATED-ONLY, so the page is open to every logged-in user. The "basic assistant" banner shows only
 * while the AI model is off (GET /v1/chatbot/status). §12/§5.
 */
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Banner, Button, Card, PageHeader } from '../../../components/ui';
import { useAuth } from '../../../auth/useAuth';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useChatbotStatus, useChatQuery } from '../api/useChatMutations';
import { ChatMessages } from '../components/ChatMessages';
import { ChatInput } from '../components/ChatInput';
import styles from '../components/chatbot.module.css';
import { AI_SUGGESTIONS, BASIC_SUGGESTIONS, type ChatMessage } from '../chatbot.types';

export default function ChatbotPage() {
  const { user } = useAuth();
  const onError = useApiErrorToast();
  const chat = useChatQuery();
  const status = useChatbotStatus();
  const isAi = status.data?.mode === 'ai';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);

  const send = (text: string) => {
    if (chat.isPending) return;
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text }]);
    chat.mutate(
      { prompt: text, ...(conversationId ? { conversation_id: conversationId } : {}) },
      {
        // Refusal / unrecognized answers come back as a normal 200 → render as an ordinary assistant bubble.
        onSuccess: (res) => {
          if (res.conversation_id) setConversationId(res.conversation_id); // '' = a rate-limit answer
          setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', text: res.answer, intent: res.intent }]);
        },
        onError, // a real error (400 too-long / network) → toast; the user's message stays in the thread
      },
    );
  };

  const newConversation = () => {
    setMessages([]);
    setConversationId(undefined);
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Assistant"
        subtitle="Ask about your Redwave data in plain language. Answers are limited to what you have access to."
        actions={
          messages.length > 0 ? (
            <Button leftIcon={<Plus size={16} />} variant="secondary" onClick={newConversation} disabled={chat.isPending}>
              New conversation
            </Button>
          ) : undefined
        }
      />
      {status.isSuccess && !isAi && (
        <Banner tone="info" title="Basic assistant">
          The full language model is turned off, so the assistant answers a few set questions about your own
          Redwave data, always within your access.
        </Banner>
      )}
      <Card flush>
        <div className={styles.panel}>
          <ChatMessages
            messages={messages}
            pending={chat.isPending}
            userName={user?.full_name ?? 'You'}
            userAvatar={user?.avatar_url ?? null}
            suggestions={isAi ? AI_SUGGESTIONS : BASIC_SUGGESTIONS}
            onSuggest={send}
            disabled={chat.isPending}
          />
          <ChatInput onSend={send} pending={chat.isPending} />
        </div>
      </Card>
    </div>
  );
}
