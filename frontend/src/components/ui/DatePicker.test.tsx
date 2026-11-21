// @vitest-environment jsdom
/**
 * DatePicker — the calendar fixes of 2026-11-16: Winnipeg "today", values with a time part, month/year
 * jumps, min/max-bounded navigation, onBlur on close, and the WAI-ARIA keyboard grid.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatePicker } from './DatePicker';
import {
  addDays,
  addMonths,
  clampToRange,
  endOfWeek,
  humanDate,
  monthOutOfRange,
  nextFocusDate,
  startOfWeek,
  toIsoDate,
  yearOptions,
} from './DatePicker.logic';

afterEach(cleanup);

describe('DatePicker.logic', () => {
  it('reads the date part of a timestamp, rejects junk', () => {
    expect(toIsoDate('2026-11-16')).toBe('2026-11-16');
    expect(toIsoDate('2026-11-16T05:30:00.000Z')).toBe('2026-11-16');
    expect(toIsoDate('16/11/2026')).toBe('');
    expect(toIsoDate(undefined)).toBe('');
  });

  it('day and month arithmetic crosses boundaries without drift', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-08', -1)).toBe('2026-03-07'); // DST weekend is irrelevant to UTC math
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-05-10', 12)).toBe('2027-05-10');
  });

  it('weeks run Sunday to Saturday', () => {
    expect(startOfWeek('2026-11-18')).toBe('2026-11-15');
    expect(endOfWeek('2026-11-18')).toBe('2026-11-21');
  });

  it('keyboard keys map to the right date', () => {
    expect(nextFocusDate('ArrowRight', '2026-11-16')).toBe('2026-11-17');
    expect(nextFocusDate('ArrowUp', '2026-11-16')).toBe('2026-11-09');
    expect(nextFocusDate('PageDown', '2026-11-16')).toBe('2026-12-16');
    expect(nextFocusDate('PageUp', '2026-11-16', true)).toBe('2025-11-16');
    expect(nextFocusDate('Home', '2026-11-18')).toBe('2026-11-15');
    expect(nextFocusDate('a', '2026-11-16')).toBeNull();
  });

  it('bounds: clamp, out-of-range months, year list', () => {
    expect(clampToRange('2026-01-01', '2026-02-01')).toBe('2026-02-01');
    expect(clampToRange('2026-05-01', undefined, '2026-04-30')).toBe('2026-04-30');
    expect(monthOutOfRange(2026, 0, '2026-02-01')).toBe(true);
    expect(monthOutOfRange(2026, 1, '2026-02-15')).toBe(false);
    expect(yearOptions(2026, 2026, '2024-06-01', '2027-01-01')).toEqual([2024, 2025, 2026, 2027]);
    const wide = yearOptions(2026, 2026);
    expect(wide[0]).toBe(1926);
    expect(wide[wide.length - 1]).toBe(2126);
  });

  it('gives a day a human name', () => {
    expect(humanDate('2026-11-16')).toMatch(/Monday.*November.*16.*2026/);
  });
});

describe('DatePicker', () => {
  it('opens on the month of a timestamp value and highlights its day', () => {
    render(<DatePicker value="2026-03-05T18:00:00.000Z" onChange={() => {}} aria-label="Sale date" />);
    const trigger = screen.getByRole('button', { name: 'Sale date' });
    expect(trigger.textContent).toContain('2026-03-05');
    fireEvent.click(trigger);
    const day = screen.getByRole('button', { name: /March 5, 2026/ });
    expect(day.className).toMatch(/selected/);
    expect((screen.getByLabelText('Month') as HTMLSelectElement).value).toBe('2');
    expect((screen.getByLabelText('Year') as HTMLSelectElement).value).toBe('2026');
  });

  it('month/year dropdowns jump the view', () => {
    render(<DatePicker value="2026-03-05" onChange={() => {}} aria-label="Date" />);
    fireEvent.click(screen.getByRole('button', { name: 'Date' }));
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '1990' } });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '6' } });
    expect(screen.getByRole('grid').getAttribute('aria-label')).toBe('July 1990');
  });

  it('disables navigation past min/max', () => {
    render(<DatePicker value="2026-03-05" min="2026-03-01" max="2026-03-31" onChange={() => {}} aria-label="Date" />);
    fireEvent.click(screen.getByRole('button', { name: 'Date' }));
    expect((screen.getByRole('button', { name: 'Previous month' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('arrow keys move focus, Enter picks, closing calls onBlur', () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<DatePicker value="2026-03-05" onChange={onChange} onBlur={onBlur} aria-label="Date" />);
    fireEvent.click(screen.getByRole('button', { name: 'Date' }));
    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute('data-iso')).toBe('2026-03-13');
    fireEvent.click(focused); // Enter/Space on a button is a click
    expect(onChange).toHaveBeenCalledWith('2026-03-13');
    expect(onBlur).toHaveBeenCalled();
  });

  it('PageDown moves into the next month', () => {
    render(<DatePicker value="2026-01-31" onChange={() => {}} aria-label="Date" />);
    fireEvent.click(screen.getByRole('button', { name: 'Date' }));
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'PageDown' });
    expect(screen.getByRole('grid').getAttribute('aria-label')).toBe('February 2026');
    expect((document.activeElement as HTMLElement).getAttribute('data-iso')).toBe('2026-02-28');
  });
});
