/**
 * Pay-run line amounts, END TO END: stored rates → CommissionConfigProvider → engine → line. Every item pays
 * one flat rep rate and the rep is paid in full (no tiers, no 70/30 since 2026-11-13).
 */
import { Decimal } from 'decimal.js';
import { CommissionConfigProvider } from '../commission/commission-config.provider';
import { CommissionEngineService } from '../engine/commission-engine.service';
import { GENESIS_RATES } from '../commission/genesis-rates';
import { ActivationInput } from '../engine/engine.types';
import { toActivationInput } from './activation-mapping.logic';
import { buildLineAmounts, computeNet } from './line-amounts.logic';

const GENESIS = new Date('2024-01-01T00:00:00.000Z');
const decLike = (s: string) => ({ toString: () => s });

function seededConfigPrisma() {
  return {
    commissionFlatRate: {
      findMany: jest.fn().mockResolvedValue(
        Object.entries(GENESIS_RATES.rates).map(([product_type, amount], i) => ({
          id: `f${i}`,
          client_id: null,
          product_type,
          product_id: null,
          amount: decLike(amount),
          effective_from: GENESIS,
          effective_to: null,
        })),
      ),
    },
    incentive: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

const ZERO_INPUTS = { expense: new Decimal(0), bonus: new Decimal(0), clawback: new Decimal(0) };

describe('Pay-run line amounts END-TO-END (config → provider → engine → line)', () => {
  const engine = new CommissionEngineService();
  let seq = 0;
  // A "validated sale_item" mapped to an engine activation via the REAL Pay Run mapping.
  const item = (productType: string, countsTowardTally: boolean, clientId = 'VF'): ActivationInput =>
    toActivationInput({
      id: `i${(seq += 1)}`,
      product_type: productType,
      counts_toward_tally: countsTowardTally,
      client_id: clientId,
      sale_date: '2026-01-10',
    });
  const many = (pt: string, counts: boolean, n: number, clientId?: string) =>
    Array.from({ length: n }, () => item(pt, counts, clientId));
  const config = () => new CommissionConfigProvider(seededConfigPrisma() as never).getEngineConfig('2026-01-10');

  it('20 internet + 4 TV + 3 HP + 2 greenfield → commission 2610.00, net 2610.00, paid in full', async () => {
    const result = engine.computePeriod({
      activations: [
        ...many('internet', true, 20),
        ...many('tv', false, 4),
        ...many('home_phone', false, 3),
        ...many('internet', false, 2), // greenfield: internet product, counts_toward_tally=false → greenfield rate
      ],
      config: await config(),
    });
    const amounts = buildLineAmounts(result, ZERO_INPUTS);
    expect(amounts.commission.toFixed(2)).toBe('2610.00'); // 2200 + 120 + 90 + 200
    expect(amounts.incentive_total.toFixed(2)).toBe('0.00');
    expect(amounts.net_payout.toFixed(2)).toBe('2610.00');
  });

  it('two clients at the same default rate: 3 VF + 9 RF internet → 1320.00', async () => {
    const result = engine.computePeriod({
      activations: [...many('internet', true, 3, 'VF'), ...many('internet', true, 9, 'RF')],
      config: await config(),
    });
    expect(buildLineAmounts(result, ZERO_INPUTS).commission.toFixed(2)).toBe('1320.00');
  });

  it('net = commission + expenses + incentives + bonus − clawback, and may go negative', async () => {
    const result = engine.computePeriod({ activations: many('tv', false, 1), config: await config() });
    const amounts = buildLineAmounts(result, {
      expense: new Decimal('10.00'),
      bonus: new Decimal('5.00'),
      clawback: new Decimal('100.00'),
    });
    expect(amounts.net_payout.toFixed(2)).toBe('-55.00'); // 30 + 10 + 5 − 100, never floored
  });
});

describe('computeNet', () => {
  it('net = commission + expense + incentive + bonus − clawback', () => {
    const net = computeNet({
      commission: new Decimal('2317.00'),
      expense: new Decimal('50.00'),
      incentive: new Decimal('20.00'),
      bonus: new Decimal('25.00'),
      clawback: new Decimal('30.00'),
    });
    expect(net.toFixed(2)).toBe('2382.00');
  });
});
