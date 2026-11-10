// @vitest-environment jsdom
/**
 * FormField + Select + RadioGroup — the browser "Issues" fixed on 2026-11-11:
 *   - a <label for> pointed at a radio group or a <div> of inputs ("Incorrect use of <label for>");
 *   - Radix's hidden native inputs had no name ("form field should have an id or name");
 *   - a Select that flipped from uncontrolled to controlled (React warning).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormField } from './FormField';
import { Input } from './Input';
import { RadioGroup } from './RadioGroup';
import { Select } from './Select';

afterEach(cleanup);

describe('FormField labelling', () => {
  it('a single input keeps a real <label for> (clicking the label focuses it)', () => {
    render(
      <FormField label="Phone">
        <Input />
      </FormField>,
    );
    expect(screen.getByLabelText('Phone').tagName).toBe('INPUT');
  });

  it('a block of several inputs is a named GROUP, not the target of a <label for>', () => {
    const { container } = render(
      <FormField label="Stops">
        <div>
          <Input aria-label="Stop 1" />
          <Input aria-label="Stop 2" />
        </div>
      </FormField>,
    );
    expect(container.querySelector('label[for]')).toBeNull();
    expect(screen.getByRole('group', { name: 'Stops' })).toBeTruthy();
  });

  it('a radio group is named by the field label', () => {
    const { container } = render(
      <FormField label="Trip type">
        <RadioGroup options={[{ value: 'single', label: 'Single' }, { value: 'round', label: 'Round' }]} value="round" />
      </FormField>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Trip type' })).toBeTruthy();
    // Only the per-option labels use <label for>, and each points at a real radio.
    container.querySelectorAll('label[for]').forEach((l) => {
      expect(document.getElementById(l.getAttribute('for') as string)?.getAttribute('role')).toBe('radio');
    });
  });
});

describe('Select', () => {
  it('stays controlled when its value goes from "nothing picked" to a choice (no React warning)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const opts = [{ value: 'km', label: 'KM' }];
    const { rerender } = render(<Select options={opts} value={undefined} onValueChange={() => {}} aria-label="Category" />);
    rerender(<Select options={opts} value="km" onValueChange={() => {}} aria-label="Category" />);
    const warned = error.mock.calls.some((c) => String(c[0]).includes('uncontrolled to controlled'));
    error.mockRestore();
    expect(warned).toBe(false);
  });

  it('with nothing picked it shows the placeholder', () => {
    render(<Select options={[{ value: 'km', label: 'KM' }]} value={undefined} placeholder="Pick one" aria-label="Category" />);
    expect(screen.getByText('Pick one')).toBeTruthy();
  });
});
