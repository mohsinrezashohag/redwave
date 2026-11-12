// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RowActions } from './RowActions';

vi.mock('../../lib/useMediaQuery', () => ({ useIsMobile: () => false, useIsTablet: () => false }));

const icon = <svg aria-hidden />;
const four = ['Open', 'Edit', 'Replace file', 'Delete'].map((label) => ({ label, icon, onSelect: () => {} }));

describe('RowActions iconOnly', () => {
  it('shows up to four labelled icon buttons inline instead of the kebab', () => {
    render(<RowActions label="Passport actions" items={four} iconOnly />);
    for (const name of ['Open', 'Edit', 'Replace file', 'Delete']) {
      expect(screen.getByRole('button', { name }).getAttribute('title')).toBe(name);
    }
    expect(screen.queryByRole('button', { name: 'Passport actions' })).toBeNull();
  });

  it('text buttons still cap at two: four actions fall back to the kebab', () => {
    render(<RowActions label="Passport actions" items={four} />);
    expect(screen.getByRole('button', { name: 'Passport actions' })).toBeTruthy();
  });
});
