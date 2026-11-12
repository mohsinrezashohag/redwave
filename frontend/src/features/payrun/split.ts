/**
 * splitLabels — the words for an OLD run's advance / holdback split. Pure; computes NO money (#1).
 *
 * There is no holdback since 2026-11-13: commission is paid in full and new runs show no split at all. A run
 * finalized earlier with a hold (`has_holdback` on the run / statement) still shows its frozen 70% / 30%
 * figures, labelled with the split that run used; with no split known it falls back to 70/30, the
 * historical default.
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
