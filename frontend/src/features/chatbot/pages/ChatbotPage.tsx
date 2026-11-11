/**
 * ChatbotPage — /chatbot. A THIN SURFACE over the leak-proof, intent-only assistant: it sends a prompt and
 * renders the server's scoped text answer. It does NO data access of its own and enforces NO scope (the
 * backend guarantees a user only ever gets their own-scope data). The endpoint is AUTHENTICATED-ONLY (no
 * permission gate), so the page is open to every logged-in user. The conversation is SESSION-ONLY component
 * state (there is no history endpoint). The LLM is STUBBED — framed honestly as a preview. §12/§5.
 */
import { useState } from 'react';
import { Banner, Card, PageHeader } from '../../../components/ui';
import { useAuth } from '../../../auth/useAuth';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useChatQuery } from '../api/useChatMutations';
import { ChatMessages } from '../components/ChatMessages';
import { ChatInput } from '../components/ChatInput';
import styles from '../components/chatbot.module.css';
import type { ChatMessage } from '../chatbot.types';

export default function ChatbotPage() {
  const { user } = useAuth();
  const onError = useApiErrorToast();
  const chat = useChatQuery();
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const send = (text: string) => {
    if (chat.isPending) return;
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text }]);
    chat.mutate(
      { prompt: text },
      {
        // Refusal / unrecognized answers come back as a normal 200 → render as an ordinary assistant bubble.
        onSuccess: (res) => setMessages((prev) => [...prev, { id: res.conversation_id, role: 'assistant', text: res.answer, intent: res.intent }]),
        onError, // a real error (400 too-long / network) → toast; the user's message stays in the thread
      },
    );
  };

  return (
    <div className={styles.page}>
      <PageHeader title="Assistant" subtitle="Ask about your Redwave data in plain language. Answers are limited to what you have access to." />
      <Banner tone="info" title="Preview assistant">
        Limited capability while the full natural-language model is wired up. It answers a few questions about your own Redwave data, and only within your access. This conversation isn’t saved.
      </Banner>
      <Card flush>
        <div className={styles.panel}>
          <ChatMessages
            messages={messages}
            pending={chat.isPending}
            userName={user?.full_name ?? 'You'}
            userAvatar={user?.avatar_url ?? null}
            onSuggest={send}
            disabled={chat.isPending}
          />
          <ChatInput onSend={send} pending={chat.isPending} />
        </div>
      </Card>
    </div>
  );
}
