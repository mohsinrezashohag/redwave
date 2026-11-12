// @vitest-environment jsdom
/**
 * Modal `dirty` — closing a form with unsaved edits asks first (2026-11-12). A misclick on the overlay used
 * to throw away a half-filled form.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

afterEach(cleanup);

describe('Modal unsaved-changes guard', () => {
  it('a clean modal closes straight away', () => {
    const onOpenChange = vi.fn();
    render(<Modal open title="Edit rep" onOpenChange={onOpenChange}>body</Modal>);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('a dirty modal asks; Keep editing stays, Discard closes', () => {
    const onOpenChange = vi.fn();
    render(<Modal open dirty title="Edit rep" onOpenChange={onOpenChange}>body</Modal>);
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText('Discard unsaved changes?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
