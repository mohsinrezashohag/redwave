/**
 * LeaderboardTable — the COUNTS-ONLY ranking (design-system §10.1; CLAUDE §5). Renders exactly what the
 * leaderboard endpoint returns: rank, rep, and internet-activation COUNT. There is deliberately NO money
 * column — peer earnings are never shown. The current user's own row is highlighted when `highlightRepId`
 * is given. Tokens only.
 */
import { PersonName, Table, THead, TBody, TR, TH, TD } from '../../../components/ui';
import type { LeaderboardRow } from '../dashboards.types';

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
          <TH align="right">Internet activations</TH>
        </TR>
      </THead>
      <TBody>
        {visible.map((row) => (
          <TR key={row.rep_id} selected={!!highlightRepId && row.rep_id === highlightRepId}>
            <TD numeric>{row.rank}</TD>
            <TD>
              <PersonName name={row.rep_name ?? '—'} photoUrl={row.photo_url} detail={row.rep_code} />
            </TD>
            <TD numeric>{row.activation_count}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
