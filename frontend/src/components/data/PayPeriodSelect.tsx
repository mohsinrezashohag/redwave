/**
 * PayPeriodSelect — effective-dated config (billing/commission rates) takes effect at a PAY PERIOD
 * boundary, not an arbitrary date (BRD §9.4 / SRS §6.2). This renders the pay-period schedule as a
 * dropdown (`Period N · start – end`) and emits the chosen period's boundary date as `'YYYY-MM-DD'`:
 * the START date for `effective_from`, the END date for `effective_to`. Only periods on/after today are
 * offered, because the server rejects a past `effective_from` (422, #10). With `allowOpenEnded`, an
 * "Open-ended" choice emits `''` (no end). Lives in components/data (it reads the schedule via query).
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { unwrap } from '../../lib/query/unwrap';
import { displayDate, todayIso } from '../../lib/format/date';
import { Select } from '../ui/Select';
import type { components } from '../../api/generated/schema';

type PayPeriod = components['schemas']['PayPeriodResponse'];

const OPEN_ENDED = '__open_ended__'; // sentinel — Radix Select forbids an empty value

export interface PayPeriodSelectProps {
  /** The stored boundary date (`'YYYY-MM-DD'`) — matched against a period's start/end. */
  value?: string;
  /** Emits the chosen period's boundary date (`'YYYY-MM-DD'`), or `''` for open-ended. */
  onChange: (date: string) => void;
  /** Which boundary to emit: the period start (effective_from, default) or end (effective_to). */
  boundary?: 'start' | 'end';
  /** Add an "Open-ended" option that emits `''` (for an optional effective_to). */
  allowOpenEnded?: boolean;
  /** Offer only periods on/after today (default true; the server rejects back-dating). */
  futureOnly?: boolean;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  'aria-label'?: string;
}

export function PayPeriodSelect({
  value,
  onChange,
  boundary = 'start',
  allowOpenEnded = false,
  futureOnly = true,
  disabled,
  id,
  placeholder = 'Select a pay period…',
  ...rest
}: PayPeriodSelectProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['pay-periods', 'list'],
    queryFn: () => unwrap<PayPeriod[]>(api.GET('/v1/pay-periods')),
    staleTime: 5 * 60_000, // the schedule changes rarely
  });

  const today = todayIso();
  const boundaryDate = (p: PayPeriod): string => displayDate(boundary === 'end' ? p.end_date : p.start_date);

  const options = (data ?? [])
    .slice()
    .sort((a, b) => a.period_number - b.period_number)
    .filter((p) => !futureOnly || boundaryDate(p) >= today)
    .map((p) => ({
      value: boundaryDate(p),
      label: `Period ${p.period_number} · ${displayDate(p.start_date)} – ${displayDate(p.end_date)}`,
    }));

  if (allowOpenEnded) options.unshift({ value: OPEN_ENDED, label: 'Open-ended (no end date)' });

  return (
    <Select
      options={options}
      value={value ? value : allowOpenEnded ? OPEN_ENDED : ''}
      onValueChange={(v) => onChange(v === OPEN_ENDED ? '' : v)}
      disabled={disabled || isLoading}
      placeholder={isLoading ? 'Loading periods…' : placeholder}
      id={id}
      {...rest}
    />
  );
}
