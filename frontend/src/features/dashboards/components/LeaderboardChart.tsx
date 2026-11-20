/**
 * LeaderboardChart — the leaderboard's two-series bar chart: approved and pending internet activations per
 * rep, stacked on one horizontal bar (recharts, token-themed). Series colours are the `--chart-N` tokens via
 * chartTheme (approved = chart-2, pending = chart-4, matching the table's swatches), and the series are
 * LABELLED DIRECTLY on the top bar ("9 approved", "2 pending"), never with a legend box (§13.7). Every other
 * segment shows its bare count. COUNTS ONLY — no money (§5). ThemedBarChart is single-series, so the
 * two-series variant lives here.
 */
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AXIS_LINE, AXIS_TICK, LABEL_FILL, seriesColor } from '../charts/chartTheme';
import { SeriesTooltip } from '../charts/SeriesTooltip';
import type { ChartRow } from '../charts/ThemedBarChart';

export const APPROVED_COLOR = seriesColor(1); // var(--chart-2)
export const PENDING_COLOR = seriesColor(3); // var(--chart-4)

export interface LeaderboardChartRow extends ChartRow {
  rep: string;
  approved: number;
  pending: number;
}

interface SegmentLabelProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: number | string;
  index?: number;
}

/** A label inside the segment; the first (top) bar also names its series. Empty segments get no label. */
function segmentLabel(series: string) {
  return function SegmentLabel(props: unknown) {
    const { x = 0, y = 0, width = 0, height = 0, value, index } = props as SegmentLabelProps;
    const n = Number(value);
    if (!n) return <g />;
    const text = index === 0 ? `${n} ${series}` : String(n);
    const w = Number(width);
    // Too narrow to hold the text → print it just past the segment end.
    const inside = w >= text.length * 7 + 8;
    return (
      <text
        x={Number(x) + (inside ? w / 2 : w + 4)}
        y={Number(y) + Number(height) / 2}
        fill={inside ? 'var(--surface-0)' : LABEL_FILL}
        fontSize={12}
        textAnchor={inside ? 'middle' : 'start'}
        dominantBaseline="central"
      >
        {text}
      </text>
    );
  };
}

export function LeaderboardChart({ data }: { data: ReadonlyArray<LeaderboardChartRow> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data as LeaderboardChartRow[]} layout="vertical" margin={{ top: 8, right: 72, bottom: 8, left: 8 }}>
        <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
        <YAxis type="category" dataKey="rep" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} width={140} />
        <Tooltip cursor={{ fill: 'var(--surface-2)', opacity: 0.5 }} content={<SeriesTooltip />} />
        <Bar dataKey="approved" name="Approved" stackId="count" fill={APPROVED_COLOR} maxBarSize={28}>
          <LabelList dataKey="approved" content={segmentLabel('approved')} />
        </Bar>
        <Bar dataKey="pending" name="Pending" stackId="count" fill={PENDING_COLOR} radius={[0, 4, 4, 0]} maxBarSize={28}>
          <LabelList dataKey="pending" content={segmentLabel('pending')} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
