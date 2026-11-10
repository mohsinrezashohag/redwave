import { describe, expect, it } from 'vitest';
import { splitLabels } from './split';

describe('splitLabels — labels follow the split in force, not a hard-coded 70/30', () => {
  it('100/0 (Redwave since 2026-11-11): "Paid now (100%)", nothing held', () => {
    expect(splitLabels({ advance_pct: '1.0000', holdback_pct: '0.0000' })).toEqual({
      paidPct: '100',
      heldPct: '0',
      paid: 'Paid now (100%)',
      held: 'Held 0%',
      holdsNothing: true,
    });
  });

  it('70/30 keeps the familiar wording', () => {
    const l = splitLabels({ advance_pct: '0.7000', holdback_pct: '0.3000' });
    expect(l.paid).toBe('70% advance');
    expect(l.held).toBe('Held 30%');
    expect(l.holdsNothing).toBe(false);
  });

  it('an unusual split is labelled exactly', () => {
    expect(splitLabels({ advance_pct: '0.6250', holdback_pct: '0.3750' }).paidPct).toBe('62.5');
  });

  it('no split known → the historical 70/30, never a guess at 100', () => {
    expect(splitLabels(null).paid).toBe('70% advance');
  });
});
