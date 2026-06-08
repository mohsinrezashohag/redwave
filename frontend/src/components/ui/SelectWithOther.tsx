/**
 * SelectWithOther — design-system §6.2. A Select that reveals a free-text input when the "Other" option is
 * chosen, so a fixed list can still capture an off-list value. The value is `{ value, other_text }`: pick a
 * normal option → `{ value }`; pick "Other" → `{ value: otherValue, other_text }`. RHF-friendly (drive it
 * from a `Controller`). Tokens only.
 */
import { Input } from './Input';
import { Select, type SelectOption } from './Select';
import styles from './SelectWithOther.module.css';

export interface SelectWithOtherValue {
  value: string;
  other_text?: string;
}

export interface SelectWithOtherProps {
  /** Options — must include one whose value === otherValue (the "Other" trigger). */
  options: SelectOption[];
  value?: string;
  otherText?: string;
  onChange: (next: SelectWithOtherValue) => void;
  /** The option value that reveals the text field (default 'other'). */
  otherValue?: string;
  placeholder?: string;
  otherPlaceholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  'aria-label'?: string;
}

export function SelectWithOther({
  options,
  value,
  otherText = '',
  onChange,
  otherValue = 'other',
  placeholder,
  otherPlaceholder = 'Please specify…',
  disabled,
  invalid,
  id,
  ...rest
}: SelectWithOtherProps) {
  const isOther = value === otherValue;
  return (
    <div className={styles.wrap}>
      <Select
        options={options}
        value={value}
        onValueChange={(v) => onChange({ value: v, other_text: v === otherValue ? otherText : undefined })}
        placeholder={placeholder}
        disabled={disabled}
        id={id}
        {...rest}
      />
      {isOther && (
        <Input
          className={styles.other}
          data-invalid={invalid || undefined}
          placeholder={otherPlaceholder}
          value={otherText}
          disabled={disabled}
          aria-label="Other — specify"
          onChange={(e) => onChange({ value: otherValue, other_text: e.target.value })}
        />
      )}
    </div>
  );
}
