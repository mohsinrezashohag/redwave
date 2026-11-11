/**
 * PrivateInput — an Input the browser will not AUTOFILL. For fields that hold SOMEONE ELSE's details (an
 * admin typing a rep's phone, address or SIN): Chrome ignores autocomplete="off" on address-like fields and,
 * when the admin accepts a suggestion in any one box, fills the whole form with the ADMIN's own saved
 * contact details.
 *
 * How: the field is read-only until it is focused. Autofill never writes into a read-only field, so a
 * "fill the form" from another box skips it; on focus it becomes an ordinary editable input (no visual
 * change — read-only is unstyled). The user can still pick a suggestion for the ONE field they are in.
 * Same props and ref as Input, so it drops into react-hook-form's register(). Tokens only.
 */
import { forwardRef, useState, type FocusEvent } from 'react';
import { Input, type InputProps } from './Input';

export const PrivateInput = forwardRef<HTMLInputElement, InputProps>(function PrivateInput({ onFocus, ...rest }, ref) {
  const [armed, setArmed] = useState(false);
  return (
    <Input
      ref={ref}
      autoComplete="off"
      {...rest}
      readOnly={rest.readOnly || !armed}
      onFocus={(e: FocusEvent<HTMLInputElement>) => {
        if (!armed) setArmed(true);
        onFocus?.(e);
      }}
    />
  );
});
