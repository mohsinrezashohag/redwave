/**
 * LeaderboardTable — the COUNTS-ONLY ranking (design-system §10.1; CLAUDE §5). Renders exactly what the
 * leaderboard endpoint returns: rank, rep, and two internet-activation COUNTS in their own colours (client
 * meeting 2026-11-16: approved and pending side by side, "a different colour so that a competitive
 * environment is created"). There is deliberately NO money column — peer earnings are never shown. The
 * current user's own row is highlighted when `highlightRepId` is given. Props are unchanged, so the rep and
 * manager dashboards that embed it keep working. Tokens only.
 */
import { PersonName, Table, THead, TBody, TR, TH, TD } from '../../../components/ui';
import type { LeaderboardRow } from '../dashboards.types';
import styles from './LeaderboardTable.module.css';

export interface LeaderboardTableProps {
  rows: LeaderboardRow[];
  highlightRepId?: string | null;
  /** Cap the visible rows (e.g. top 10); omit for all. */
  maxRows?: number;
}

export function LeaderboardTable({ rows, highlightRepId, maxRows }: LeaderboardTableProps) {
  const visible = maxRows ? rows.slice(0, maxRows) : rows;
  return (
    <Table density="comfortable">
      <THead>
        <TR>
          <TH align="right">#</TH>
          <TH>Rep</TH>
          <TH align="right">
            <span className={styles.head}>
              <span className={`${styles.swatch} ${styles.swatchApproved}`} aria-hidden />
              Approved
            </span>
          </TH>
          <TH align="right">
            <span className={styles.head}>
              <span className={`${styles.swatch} ${styles.swatchPending}`} aria-hidden />
              Pending
            </span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {visible.map((row) => (
          <TR key={row.rep_id} selected={!!highlightRepId && row.rep_id === highlightRepId}>
            <TD numeric>{row.rank}</TD>
            <TD>
              <PersonName name={row.rep_name ?? '—'} photoUrl={row.photo_url} detail={row.rep_code} />
            </TD>
            <TD numeric>
              <span className={`${styles.count} ${styles.approved}`} aria-label={`${row.approved_count} approved`}>
                {row.approved_count}
              </span>
            </TD>
            <TD numeric>
              <span className={`${styles.count} ${styles.pending}`} aria-label={`${row.pending_count} pending`}>
                {row.pending_count}
              </span>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
