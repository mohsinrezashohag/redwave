/**
 * ChatInput — the prompt box. Enter sends; Shift+Enter inserts a newline. The Send button shows a loading
 * state and is disabled while a query is in flight or the box is empty. maxLength mirrors the server's 500.
 * Tokens only.
 */
import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button, Textarea } from '../../../components/ui';
import styles from './chatbot.module.css';

export function ChatInput({ onSend, pending }: { onSend: (text: string) => void; pending: boolean }) {
  const [text, setText] = useState('');

  const submit = () => {
    const t = text.trim();
    if (!t || pending) return;
    onSend(t);
    setText('');
  };

  return (
    <div className={styles.inputRow}>
      <div className={styles.inputField}>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask about your sales, commission, or team…"
          maxLength={500}
          rows={1}
          maxHeight={140}
          disabled={pending}
        />
      </div>
      <Button variant="primary" leftIcon={<Send size={16} />} loading={pending} disabled={pending || !text.trim()} onClick={submit}>
        Send
      </Button>
    </div>
  );
}
