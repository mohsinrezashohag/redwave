// @vitest-environment jsdom
/**
 * Avatar — a photo that fails to load (an expired signed link) falls back to the initials instead of a
 * broken-image icon, and a new link gets a fresh try. — 2026-11-12
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

afterEach(cleanup);

describe('Avatar', () => {
  it('shows initials without a photo', () => {
    const { container } = render(<Avatar name="Riley Rivera" />);
    expect(container.textContent).toBe('RR');
    expect(container.querySelector('img')).toBeNull();
  });

  it('falls back to initials when the photo fails, and retries a new photo', () => {
    const { container, rerender } = render(<Avatar name="Riley Rivera" src="https://x/expired.jpg" />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('RR');

    rerender(<Avatar name="Riley Rivera" src="https://x/fresh.jpg" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://x/fresh.jpg');
  });
});
