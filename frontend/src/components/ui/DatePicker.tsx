/**
 * DatePicker — design-system §6.2. A controlled calendar in a Radix Popover, styled with tokens (no
 * native <input type=date>, which renders in the OS locale). Value + onChange are ALWAYS `'YYYY-MM-DD'`
 * (the app's canonical date format, #7); the calendar opens to the selected date or today. Optional
 * min/max bound selectable days. Date math is pure string/number work (UTC-anchored) — no timezone drift.
 */
import * as RPopover from '@radix-ui/react-popover';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { displayDate, todayIso } from '../../lib/format/date';
import { cx } from './cx';
import styles from './DatePicker.module.css';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number): string => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number): string => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const firstWeekday = (y: number, m: number): number => new Date(Date.UTC(y, m, 1)).getUTCDay();

function parse(iso: string): { y: number; m: number } {
  const [y, m] = iso.split('-').map(Number);
  return { y, m: m - 1 };
}

export interface DatePickerProps {
  value?: string; // 'YYYY-MM-DD' | ''
  onChange: (value: string) => void;
  min?: string; // 'YYYY-MM-DD'
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  invalid?: boolean;
  id?: string;
  'aria-label'?: string;
}

export function DatePicker({
  value = '',
  onChange,
  min,
  max,
  placeholder = 'Select date…',
  disabled,
  clearable = true,
  invalid,
  id,
  ...rest
}: DatePickerProps) {
  const today = todayIso();
  const [open, setOpen] = useState(false);
  const anchor = value && ISO_RE.test(value) ? parse(value) : parse(today);
  const [view, setView] = useState<{ y: number; m: number }>(anchor);

  const inRange = (iso: string): boolean => (!min || iso >= min) && (!max || iso <= max);

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (next) setView(value && ISO_RE.test(value) ? parse(value) : parse(today)); // re-anchor on open
  };

  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  const stepMonth = (delta: number) =>
    setView(({ y, m }) => {
      const next = m + delta;
      return { y: y + Math.floor(next / 12), m: ((next % 12) + 12) % 12 };
    });

  const lead = firstWeekday(view.y, view.m);
  const total = daysInMonth(view.y, view.m);
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => ymd(view.y, view.m, i + 1)),
  ];

  return (
    <RPopover.Root open={open} onOpenChange={handleOpen}>
      <RPopover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          data-invalid={invalid || undefined}
          data-placeholder={!value || undefined}
          className={styles.trigger}
          {...rest}
        >
          <span className={styles.value}>{value ? displayDate(value) : placeholder}</span>
          <CalendarIcon size={16} className={styles.triggerIcon} aria-hidden />
        </button>
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content className={styles.content} align="start" sideOffset={6}>
          <div className={styles.header}>
            <button type="button" className={styles.navBtn} onClick={() => stepMonth(-1)} aria-label="Previous month">
              <ChevronLeft size={16} />
            </button>
            <span className={styles.monthLabel}>
              {MONTHS[view.m]} {view.y}
            </span>
            <button type="button" className={styles.navBtn} onClick={() => stepMonth(1)} aria-label="Next month">
              <ChevronRight size={16} />
            </button>
          </div>

          <div className={styles.weekRow} aria-hidden>
            {WEEKDAYS.map((w) => (
              <span key={w} className={styles.weekday}>
                {w}
              </span>
            ))}
          </div>

          <div className={styles.grid} role="grid">
            {cells.map((iso, i) =>
              iso === null ? (
                <span key={`blank-${i}`} />
              ) : (
                <button
                  key={iso}
                  type="button"
                  className={cx(
                    styles.day,
                    iso === value && styles.selected,
                    iso === today && iso !== value && styles.today,
                  )}
                  disabled={!inRange(iso)}
                  aria-label={iso}
                  aria-current={iso === today ? 'date' : undefined}
                  onClick={() => pick(iso)}
                >
                  {Number(iso.slice(8, 10))}
                </button>
              ),
            )}
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.footerBtn} disabled={!inRange(today)} onClick={() => pick(today)}>
              Today
            </button>
            {clearable && value && (
              <button
                type="button"
                className={styles.footerBtn}
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                Clear
              </button>
            )}
          </div>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
