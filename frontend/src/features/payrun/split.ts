/**
 * splitLabels — the words for a run's advance / holdback split. Pure; computes NO money (#1) — it only turns
 * the server's split (e.g. '1.0000' / '0.0000') into labels.
 *
 * Why: every pay screen used to say "70% advance" / "Held 30%" literally. Since 2026-11-11 Redwave pays 100%
 * with nothing held (tier + holdback are applied manually, outside the system), so the labels must follow
 * the split actually in force for the run's period. With no split known, it falls back to 70/30 — the
 * historical default — rather than guessing.
 */
export interface Split {
  advance_pct: string;
  holdback_pct: string;
}

export interface SplitLabels {
  /** "70" / "100" — for "Your 70%". */
  paidPct: string;
  /** "30" / "0". */
  heldPct: string;
  /** Column / card label for what is paid now: "70% advance" or "Paid now (100%)". */
  paid: string;
  /** Label for the withheld share: "Held 30%". */
  held: string;
  /** True at a 100/0 split — the screens hide the "held" column / card instead of showing zeros. */
  holdsNothing: boolean;
}

/** '0.7000' → '70', '1.0000' → '100', '0.6250' → '62.5'. A label, never a money value. */
function pct(fraction: string): string {
  const hundredths = Math.round(Number(fraction) * 10000) / 100;
  return String(hundredths);
}

export function splitLabels(split: Split | null | undefined): SplitLabels {
  const paidPct = split ? pct(split.advance_pct) : '70';
  const heldPct = split ? pct(split.holdback_pct) : '30';
  const holdsNothing = Number(heldPct) === 0;
  return {
    paidPct,
    heldPct,
    paid: holdsNothing ? `Paid now (${paidPct}%)` : `${paidPct}% advance`,
    held: `Held ${heldPct}%`,
    holdsNothing,
  };
}
