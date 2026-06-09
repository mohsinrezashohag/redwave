/**
 * GlobalSearch — the real top-bar search (replaces the placeholder). Debounced; results are grouped
 * (Sales / Clients / Reps) and deep-link to the record (sale → detail, client → detail, rep → their
 * sales). Scope is SERVER-enforced (a rep only ever finds their own sales/customers, §5). A custom
 * dropdown (not a focus-trapping popover) keeps focus in the input; outside-click + Esc close it. Tokens only.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGlobalSearch } from '../api/useGlobalSearch';
import styles from './GlobalSearch.module.css';

export function GlobalSearch() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const q = useGlobalSearch(debounced);
  const r = q.data;
  const hasAny = !!r && (r.reps.length > 0 || r.clients.length > 0 || r.sales.length > 0);
  const showPanel = open && debounced.length >= 2;

  const go = (to: string) => {
    setOpen(false);
    setTerm('');
    navigate(to);
  };

  return (
    <div className={styles.wrap} ref={ref}>
      <div className={styles.box}>
        <Search size={16} className={styles.icon} aria-hidden />
        <input
          className={styles.input}
          type="search"
          placeholder="Search reps, clients, customers, sales…"
          aria-label="Global search"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </div>

      {showPanel && (
        <div className={styles.panel} role="listbox">
          {q.isLoading ? (
            <p className={styles.note}>Searching…</p>
          ) : !hasAny ? (
            <p className={styles.note}>No matches for “{debounced}”.</p>
          ) : (
            <div className={styles.groups}>
              {r!.sales.length > 0 && (
                <Group title="Sales">
                  {r!.sales.map((s) => (
                    <ResultButton key={s.id} code={s.sale_code} label={s.customer_name} onSelect={() => go(`/sales/${s.id}`)} />
                  ))}
                </Group>
              )}
              {r!.clients.length > 0 && (
                <Group title="Clients">
                  {r!.clients.map((c) => (
                    <ResultButton key={c.id} code={c.client_code} label={c.name} onSelect={() => go(`/admin/clients/${c.id}`)} />
                  ))}
                </Group>
              )}
              {r!.reps.length > 0 && (
                <Group title="Reps">
                  {r!.reps.map((rep) => (
                    <ResultButton key={rep.id} code={rep.rep_code} label={rep.full_name} onSelect={() => go(`/sales?rep_id=${rep.id}`)} />
                  ))}
                </Group>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.group}>
      <p className={styles.groupTitle}>{title}</p>
      {children}
    </div>
  );
}

function ResultButton({ code, label, onSelect }: { code: string; label: string; onSelect: () => void }) {
  return (
    <button type="button" className={styles.item} onClick={onSelect} role="option">
      <span className={`${styles.code} mono`}>{code}</span>
      <span className={styles.sub}>{label}</span>
    </button>
  );
}
