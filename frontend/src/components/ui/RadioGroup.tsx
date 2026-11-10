/**
 * RadioGroup — design-system §6.2. Mutually exclusive small sets (e.g. Single trip / Round trip).
 * Radix primitive styled with tokens; large hit target; obvious selected state.
 */
import * as RRadio from '@radix-ui/react-radio-group';
import { useId } from 'react';
import styles from './RadioGroup.module.css';

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  options: RadioOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  ariaLabel?: string;
  /** Set by FormField: the group is named by the field's visible label (not a <label for>). */
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function RadioGroup({ options, value, defaultValue, onValueChange, name, ariaLabel, ...aria }: RadioGroupProps) {
  const groupId = useId();
  return (
    <RRadio.Root
      className={styles.group}
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      // Radix adds hidden native radio inputs inside a <form>; they need a name (browser issue otherwise).
      name={name ?? groupId}
      // A visible field label (aria-labelledby) wins over the fallback aria-label.
      aria-label={aria['aria-labelledby'] ? undefined : ariaLabel}
      {...aria}
    >
      {options.map((opt) => {
        const id = `${groupId}-${opt.value}`;
        return (
          <span className={styles.row} key={opt.value}>
            <RRadio.Item id={id} className={styles.item} value={opt.value} disabled={opt.disabled}>
              <RRadio.Indicator className={styles.indicator} />
            </RRadio.Item>
            <label htmlFor={id} className={styles.label}>
              {opt.label}
            </label>
          </span>
        );
      })}
    </RRadio.Root>
  );
}
