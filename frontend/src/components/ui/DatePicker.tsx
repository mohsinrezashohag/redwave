/**
 * DatePicker — design-system §6.2. A controlled calendar in a Radix Popover, styled with tokens (no
 * native <input type=date>, which renders in the OS locale). Value + onChange are ALWAYS `'YYYY-MM-DD'`
 * (the app's canonical date format, #7); a value carrying a time part (an API timestamp) is read by its
 * date part. The calendar opens to the selected date or TODAY IN WINNIPEG (the business timezone, CLAUDE
 * §2), never the viewer's local day. Optional min/max bound the selectable days, the month steps and the
 * month/year dropdowns.
 *
 * Keyboard (WAI-ARIA date picker): arrows move a day / a week, Home/End the week, PageUp/PageDown a month
 * (Shift for a year), Enter or Space picks, Escape closes. `onBlur` fires when the popover closes, so a
 * react-hook-form field gets "touched". Date math is pure (DatePicker.logic.ts, UTC-anchored).
 */
import * as RPopover from '@radix-ui/react-popover';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { todayInWinnipeg } from '../../lib/format/date';
import { cx } from './cx';
import {
  addMonths,
  clampToRange,
  daysInMonth,
  firstWeekday,
  humanDate,
  inRange,
  monthOutOfRange,
  nextFocusDate,
  parseYm,
  toIsoDate,
  yearOptions,
  ymd,
} from './DatePicker.logic';
import styles from './DatePicker.module.css';

const WEEKDAYS = [
  { short: 'Su', long: 'Sunday' },
  { short: 'Mo', long: 'Monday' },
  { short: 'Tu', long: 'Tuesday' },
  { short: 'We', long: 'Wednesday' },
  { short: 'Th', long: 'Thursday' },
  { short: 'Fr', long: 'Friday' },
  { short: 'Sa', long: 'Saturday' },
];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface DatePickerProps {
  value?: string; // 'YYYY-MM-DD' | '' (a timestamp is read by its date part)
  onChange: (value: string) => void;
  /** Called when the calendar closes (react-hook-form `touched`). */
  onBlur?: () => void;
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
  onBlur,
  min: minRaw,
  max: maxRaw,
  placeholder = 'Select date…',
  disabled,
  clearable = true,
  invalid,
  id,
  ...rest
}: DatePickerProps) {
  const selected = toIsoDate(value);
  const min = toIsoDate(minRaw) || undefined;
  const max = toIsoDate(maxRaw) || undefined;
  const today = todayInWinnipeg();
  const anchorDate = () => clampToRange(selected || today, min, max);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<{ y: number; m: number }>(() => parseYm(anchorDate()));
  const [focused, setFocused] = useState<string>(() => anchorDate());
  const gridRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  // Move real DOM focus to the roving day after keyboard navigation (and on open).
  useEffect(() => {
    if (!open || !moveFocus.current) return;
    moveFocus.current = false;
    const btn = gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focused}"]`);
    btn?.focus();
  }, [open, focused, view]);

  const handleOpen = (next: boolean) => {
    if (next) {
      // Re-anchor on every open, so a value changed while closed (a form reset, a prefill) is what shows.
      const a = anchorDate();
      setView(parseYm(a));
      setFocused(a);
      moveFocus.current = true;
    }
    setOpen(next);
    if (!next) onBlur?.();
  };

  const pick = (iso: string) => {
    if (!inRange(iso, min, max)) return;
    onChange(iso);
    handleOpen(false);
  };

  const showMonth = (y: number, m: number) => {
    setView({ y, m });
    // Keep the roving focus inside the shown month.
    const day = Math.min(Number(focused.slice(8, 10)), daysInMonth(y, m));
    setFocused(clampToRange(ymd(y, m, day), min, max));
  };

  const stepMonth = (delta: number) => {
    const { y, m } = parseYm(addMonths(ymd(view.y, view.m, 1), delta));
    showMonth(y, m);
  };

  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = nextFocusDate(e.key, focused, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    const target = clampToRange(next, min, max);
    setFocused(target);
    const { y, m } = parseYm(target);
    if (y !== view.y || m !== view.m) setView({ y, m });
    moveFocus.current = true;
  };

  const prevDisabled = monthOutOfRange(...ym(addMonths(ymd(view.y, view.m, 1), -1)), min, max);
  const nextDisabled = monthOutOfRange(...ym(addMonths(ymd(view.y, view.m, 1), 1)), min, max);
  const years = yearOptions(Number(today.slice(0, 4)), view.y, min, max);

  const lead = firstWeekday(view.y, view.m);
  const total = daysInMonth(view.y, view.m);
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => ymd(view.y, view.m, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  // The roving tab stop must be a day that is rendered in this month.
  const tabStop = cells.includes(focused) ? focused : cells.find((c) => c && inRange(c, min, max)) ?? null;

  return (
    <RPopover.Root open={open} onOpenChange={handleOpen}>
      <RPopover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          data-invalid={invalid || undefined}
          data-placeholder={!selected || undefined}
          className={styles.trigger}
          {...rest}
        >
          <span className={styles.value}>{selected || placeholder}</span>
          <CalendarIcon size={16} className={styles.triggerIcon} aria-hidden />
        </button>
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          className={styles.content}
          align="start"
          sideOffset={6}
          collisionPadding={8}
          aria-label="Choose a date"
          onOpenAutoFocus={(e) => e.preventDefault() /* the effect focuses the selected day instead */}
        >
          <div className={styles.header}>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => stepMonth(-1)}
              disabled={prevDisabled}
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <div className={styles.jumps}>
              <select
                className={styles.jump}
                value={view.m}
                onChange={(e) => showMonth(view.y, Number(e.target.value))}
                aria-label="Month"
              >
                {MONTHS.map((name, m) => (
                  <option key={name} value={m} disabled={monthOutOfRange(view.y, m, min, max)}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                className={styles.jump}
                value={view.y}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  // Land on the nearest in-range month of the chosen year.
                  const target = parseYm(clampToRange(ymd(y, view.m, 1), min ? `${min.slice(0, 7)}-01` : undefined, max));
                  showMonth(target.y, target.m);
                }}
                aria-label="Year"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className={styles.navBtn}
              onClick={() => stepMonth(1)}
              disabled={nextDisabled}
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div
            ref={gridRef}
            className={styles.table}
            role="grid"
            aria-label={`${MONTHS[view.m]} ${view.y}`}
            onKeyDown={onGridKeyDown}
          >
            <div className={styles.weekRow} role="row">
              {WEEKDAYS.map((w) => (
                <span key={w.short} className={styles.weekday} role="columnheader" aria-label={w.long}>
                  {w.short}
                </span>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className={styles.grid} role="row">
                {week.map((iso, di) =>
                  iso === null ? (
                    <span key={`blank-${wi}-${di}`} role="gridcell" />
                  ) : (
                    <span key={iso} role="gridcell" aria-selected={iso === selected}>
                      <button
                        type="button"
                        data-iso={iso}
                        tabIndex={iso === tabStop ? 0 : -1}
                        className={cx(
                          styles.day,
                          iso === selected && styles.selected,
                          iso === today && iso !== selected && styles.today,
                        )}
                        disabled={!inRange(iso, min, max)}
                        aria-label={humanDate(iso)}
                        aria-current={iso === today ? 'date' : undefined}
                        onFocus={() => setFocused(iso)}
                        onClick={() => pick(iso)}
                      >
                        {Number(iso.slice(8, 10))}
                      </button>
                    </span>
                  ),
                )}
              </div>
            ))}
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.footerBtn} disabled={!inRange(today, min, max)} onClick={() => pick(today)}>
              Today
            </button>
            {clearable && selected && (
              <button
                type="button"
                className={styles.footerBtn}
                onClick={() => {
                  onChange('');
                  handleOpen(false);
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

function ym(iso: string): [number, number] {
  const { y, m } = parseYm(iso);
  return [y, m];
}
