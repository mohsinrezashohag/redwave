/**
 * Pure per-item rule: is this item an internet activation that is NOT greenfield? — CLAUDE §3 #9, SRS §17.2
 *
 * Stored on `sale_items.counts_toward_tally` at entry and validation. Nothing tiers on it any more (no tiers
 * since 2026-11-13); it is the GREENFIELD signal Pay Run reads (a greenfield internet item is paid the
 * greenfield rate) and the internet-activation count the leaderboard and dashboards show.
 */
export function countsTowardTally(productType: string, isGreenfield: boolean): boolean {
  return productType === 'internet' && !isGreenfield;
}
