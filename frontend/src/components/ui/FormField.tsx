/**
 * FormField — design-system §6.2. Wraps a control with a label above, optional helper text below, and
 * an inline error (danger, with icon + message) adjacent to the field. Associates label + descriptions
 * to the control via id/aria for accessibility (§9). Tokens only.
 */
import { AlertCircle } from 'lucide-react';
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cx } from './cx';
import { RadioGroup } from './RadioGroup';
import styles from './FormField.module.css';

export interface FormFieldProps {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
  /**
   * Treat the child as a GROUP of controls (labelled via aria-labelledby, not <label for>). Detected
   * automatically for RadioGroup and plain container elements; set it for a custom component that renders
   * several controls.
   */
  group?: boolean;
}

/** Host elements a <label for> may point at. Anything else (a div of several inputs…) is a GROUP. */
const LABELABLE = new Set(['input', 'select', 'textarea', 'button', 'output', 'meter', 'progress']);

/**
 * Whether the wrapped child is a GROUP of controls rather than one control. A <label for> must point at a
 * single form control; pointing it at a radio group or a <div> of inputs is invalid ("Incorrect use of
 * <label for>") and leaves the controls unlabelled. Groups are instead NAMED by the label (aria-labelledby).
 */
function isGroup(child: ReactNode, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  if (!isValidElement(child)) return false;
  if (child.type === RadioGroup) return true;
  return typeof child.type === 'string' && !LABELABLE.has(child.type);
}

export function FormField({ label, help, error, required, children, className, group }: FormFieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  const asGroup = isGroup(children, group);
  const isHostContainer = asGroup && isValidElement(children) && typeof children.type === 'string';

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        ...(asGroup
          ? { 'aria-labelledby': labelId, ...(isHostContainer ? { role: 'group' } : {}) }
          : { id }),
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'data-invalid': error ? '' : undefined,
      })
    : children;

  const labelContent = (
    <>
      {label}
      {required && (
        <span className={styles.required} aria-hidden="true">
          *
        </span>
      )}
    </>
  );

  return (
    <div className={cx(styles.field, className)}>
      {asGroup ? (
        <span className={styles.label} id={labelId}>
          {labelContent}
        </span>
      ) : (
        <label className={styles.label} htmlFor={id}>
          {labelContent}
        </label>
      )}
      {control}
      {help && !error && (
        <p className={styles.help} id={helpId}>
          {help}
        </p>
      )}
      {error && (
        <p className={styles.error} id={errorId}>
          <AlertCircle size={14} aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
