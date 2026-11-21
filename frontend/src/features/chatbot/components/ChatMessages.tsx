/**
 * ChatMessages — the scrollable conversation. Auto-scrolls to the latest on each new message / while the
 * assistant is "thinking". Empty state = a short welcome + the suggestion chips for the current mode.
 * Display only — it renders whatever the server returned; no data access here. Tokens only.
 */
import { useEffect, useRef } from 'react';
import { Avatar, cx } from '../../../components/ui';
import { MessageBubble } from './MessageBubble';
import { SuggestionChips } from './SuggestionChips';
import styles from './chatbot.module.css';
import type { ChatMessage } from '../chatbot.types';

interface Props {
  messages: ChatMessage[];
  pending: boolean;
  userName: string;
  userAvatar: string | null;
  suggestions: string[];
  onSuggest: (prompt: string) => void;
  disabled: boolean;
}

export function ChatMessages({ messages, pending, userName, userAvatar, suggestions, onSuggest, disabled }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending]);

  return (
    <div className={styles.messages}>
      {messages.length === 0 && !pending ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>Ask about your Redwave data</span>
          <p className={styles.note}>The assistant answers within your access. Try one of these:</p>
          <SuggestionChips suggestions={suggestions} onSelect={onSuggest} disabled={disabled} />
        </div>
      ) : (
        messages.map((m) => <MessageBubble key={m.id} message={m} userName={userName} userAvatar={userAvatar} />)
      )}
      {pending && (
        <div className={styles.row}>
          <Avatar name="Redwave" size="sm" />
          <div className={styles.bubbleWrap}>
            <div className={cx(styles.bubble, styles.bubbleAssistant)}>
              <span className={styles.thinking} aria-label="Thinking">
                <span className={styles.dot} />
                <span className={styles.dot} />
                <span className={styles.dot} />
              </span>
            </div>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
