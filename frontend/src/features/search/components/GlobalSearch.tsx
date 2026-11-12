/**
 * GlobalSearch — the top-bar search. Debounced; results are grouped (Sales / Clients / Reps) and
 * deep-link to the record (sale → detail, client → detail, rep → their profile). Scope is SERVER-enforced
 * (a rep only ever finds their own sales/customers, §5; reps are returned only to hrm:view holders). A
 * custom dropdown (not a focus-trapping popover) keeps focus in the input; outside-click + Esc close it.
 *
 * Keyboard (2026-11-12): ↑/↓ move through the results, Enter opens the highlighted one, Esc closes. A
 * failed search says so instead of "No matches". Tokens only.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '../../../components/ui';
import { useGlobalSearch } from '../api/useGlobalSearch';
import styles from './GlobalSearch.module.css';

interface Result {
  key: string;
  group: 'Sales' | 'Clients' | 'Reps';
  code: string;
  label: string;
  leading?: ReactNode;
  to: string;
}

export function GlobalSearch() {
  const navigate = useNavigate();
  const listId = useId();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const q = useGlobalSearch(debounced);
  const r = q.data;
  const showPanel = open && debounced.length >= 2;

  // One flat list in display order, so the arrow keys walk across groups.
  const results = useMemo<Result[]>(() => {
    if (!r) return [];
    return [
      ...r.sales.map((s) => ({ key: `s-${s.id}`, group: 'Sales' as const, code: s.sale_code, label: s.customer_name, to: `/sales/${s.id}` })),
      ...r.clients.map((c) => ({ key: `c-${c.id}`, group: 'Clients' as const, code: c.client_code, label: c.name, to: `/admin/clients/${c.id}` })),
      ...r.reps.map((rep) => ({
        key: `r-${rep.id}`,
        group: 'Reps' as const,
        code: rep.rep_code,
        label: rep.full_name,
        leading: <Avatar name={rep.full_name} src={rep.photo_url} size="sm" />,
        to: `/admin/reps/${rep.id}`,
      })),
    ];
  }, [r]);

  useEffect(() => setActive(0), [results]);

  const go = (to: string) => {
    setOpen(false);
    setTerm('');
    navigate(to);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!showPanel || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[active].to);
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;
  const groups: Result['group'][] = ['Sales', 'Clients', 'Reps'];

  return (
    <div className={styles.wrap} ref={ref}>
      <div className={styles.box}>
        <Search size={16} className={styles.icon} aria-hidden />
        <input
          className={styles.input}
          type="search"
          placeholder="Search sales, clients, reps…"
          aria-label="Global search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-activedescendant={showPanel && results.length > 0 ? optionId(active) : undefined}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>

      {showPanel && (
        <div className={styles.panel} role="listbox" id={listId}>
          {q.isLoading ? (
            <p className={styles.note}>Searching…</p>
          ) : q.isError ? (
            <p className={styles.note}>Search isn’t available right now. Please try again.</p>
          ) : results.length === 0 ? (
            <p className={styles.note}>No matches for “{debounced}”.</p>
          ) : (
            <div className={styles.groups}>
              {groups.map((g) => {
                const inGroup = results.map((res, i) => ({ res, i })).filter(({ res }) => res.group === g);
                if (inGroup.length === 0) return null;
                return (
                  <div className={styles.group} key={g}>
                    <p className={styles.groupTitle}>{g}</p>
                    {inGroup.map(({ res, i }) => (
                      <button
                        key={res.key}
                        id={optionId(i)}
                        type="button"
                        role="option"
                        aria-selected={i === active}
                        data-active={i === active}
                        className={styles.item}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(res.to)}
                      >
                        {res.leading}
                        <span className={`${styles.code} mono`}>{res.code}</span>
                        <span className={styles.sub}>{res.label}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
