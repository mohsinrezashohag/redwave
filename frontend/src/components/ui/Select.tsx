/**
 * Select — design-system §6.2. Radix Select (native-feeling, keyboard-navigable) styled with tokens.
 * Used for client, product, field manager, etc. (A search filter for >8 options is part of the
 * enhanced combobox, deferred to its feature session.)
 */
import * as RSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cx } from './cx';
import styles from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  /** Name for the hidden native <select> Radix renders inside a form (defaults to the id). */
  name?: string;
  'aria-label'?: string;
}

export function Select({ options, value, defaultValue, onValueChange, placeholder = 'Select…', disabled, id, name, ...rest }: SelectProps) {
  // Always CONTROLLED unless the caller explicitly opts into defaultValue. Callers commonly pass
  // `value={x || undefined}` for "nothing picked yet"; letting that flip from undefined to a string made
  // React warn "changing from uncontrolled to controlled". An empty string is Radix's "no selection" — it
  // shows the placeholder exactly as undefined did.
  const controlled = defaultValue === undefined ? (value ?? '') : value;
  return (
    <RSelect.Root
      value={controlled}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      // Radix adds a hidden native <select> inside a <form>; without a name the browser flags it
      // ("form field should have an id or name") and autofill can't address it.
      name={name ?? id}
    >
      <RSelect.Trigger id={id} className={styles.trigger} {...rest}>
        <RSelect.Value placeholder={placeholder} />
        <RSelect.Icon className={styles.triggerIcon}>
          <ChevronDown size={16} />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content className={styles.content} position="popper" sideOffset={4}>
          <RSelect.Viewport className={styles.viewport}>
            {options.map((opt) => (
              <RSelect.Item key={opt.value} value={opt.value} disabled={opt.disabled} className={cx(styles.item)}>
                <RSelect.ItemText>{opt.label}</RSelect.ItemText>
                <RSelect.ItemIndicator className={styles.itemIndicator}>
                  <Check size={15} />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}
