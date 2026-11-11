// @vitest-environment jsdom
/**
 * PrivateInput — Chrome filled an admin's OWN saved phone / email / address into a rep's profile form
 * (2026-11-11). Autofill never writes into a read-only field, so the field stays read-only until the user
 * focuses it, then behaves like any input.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivateInput } from './PrivateInput';

afterEach(cleanup);

describe('PrivateInput', () => {
  it('is read-only (so autofill skips it) until focused, then editable', () => {
    render(<PrivateInput aria-label="Street" />);
    const input = screen.getByLabelText('Street') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute('autocomplete')).toBe('off');

    fireEvent.focus(input);
    expect(input.readOnly).toBe(false);
    fireEvent.change(input, { target: { value: '1250 Portage Ave' } });
    expect(input.value).toBe('1250 Portage Ave');
  });

  it("forwards the ref and the caller's onFocus (works with react-hook-form register)", () => {
    const ref = createRef<HTMLInputElement>();
    const onFocus = vi.fn();
    render(<PrivateInput ref={ref} aria-label="Phone" onFocus={onFocus} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    fireEvent.focus(screen.getByLabelText('Phone'));
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('an explicitly read-only field stays read-only after focus', () => {
    render(<PrivateInput aria-label="Code" readOnly value="RW-1" />);
    const input = screen.getByLabelText('Code') as HTMLInputElement;
    fireEvent.focus(input);
    expect(input.readOnly).toBe(true);
  });
});
