/**
 * SuggestionChips — prompts the assistant can actually answer (clicking one sends it). The page passes the
 * list for the current mode, so the basic assistant is never advertised as smarter than it is. Tokens only.
 */
import styles from './chatbot.module.css';

export function SuggestionChips({
  suggestions,
  onSelect,
  disabled,
}: {
  suggestions: string[];
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.chips}>
      {suggestions.map((s) => (
        <button key={s} type="button" className={styles.chip} disabled={disabled} onClick={() => onSelect(s)}>
          {s}
        </button>
      ))}
    </div>
  );
}
