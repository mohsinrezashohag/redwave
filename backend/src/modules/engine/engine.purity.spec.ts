/**
 * Engine PURITY guard — the Commission Engine is pure and isolated: given activations + config it returns
 * the same result every time, with NO database, HTTP, clock, or cross-module coupling. Purity was
 * convention-only (documented in README.md but never asserted), which is fragile for the most
 * invariant-critical code in the repo — especially now that per-client rates tempt a "just look the client
 * up" shortcut. Proven two ways: (a) structural source scan, (b) determinism + no-constructor-deps.
 * — CLAUDE §3 #1/#5, §6
 */
import * as fs from 'fs';
import * as path from 'path';
import { Decimal } from 'decimal.js';
import { CommissionEngineService } from './commission-engine.service';
import { ActivationInput, EngineConfig, ProductType, TierBracket } from './engine.types';

// ── (a) Structural: nothing in the engine folder may reach outside itself ─────────────────────────
describe('Engine purity — structural isolation', () => {
  // Prisma / DB / HTTP / other modules. `@nestjs/common` is allowed (the @Injectable marker only).
  const FORBIDDEN_IMPORT = /from\s+['"](@prisma\/client|\.\.\/|\.\.\\|@nestjs\/(?!common)|axios|node:)/;
  const FORBIDDEN_DELEGATE = /\b(prisma|tx)\s*\./;
  // A clock or randomness would break "same inputs → same outputs".
  const FORBIDDEN_NONDETERMINISM = /\b(Date\.now|Math\.random|new Date)\b/;

  const sourceFiles = fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

  it('finds the engine sources to scan', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it.each(sourceFiles)('%s imports no Prisma / DB / sibling module', (file) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    expect(src).not.toMatch(FORBIDDEN_IMPORT);
  });

  it.each(sourceFiles)('%s touches no Prisma delegate', (file) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    expect(src).not.toMatch(FORBIDDEN_DELEGATE);
  });

  it.each(sourceFiles)('%s uses no clock or randomness', (file) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    expect(src).not.toMatch(FORBIDDEN_NONDETERMINISM);
  });
});

// ── (b) Behavioural: no constructor deps, and identical inputs give identical outputs ─────────────
describe('Engine purity — determinism', () => {
  const d = (s: string) => new Decimal(s);
  const TIERS: TierBracket[] = [
    { tierNumber: 2, minCount: 0, maxCount: 9, ratePerActivation: d('110') },
    { tierNumber: 1, minCount: 10, maxCount: null, ratePerActivation: d('145') },
  ];
  const config: EngineConfig = {
    tiers: TIERS,
    flatRates: { tv: d('30'), greenfield_internet: d('100') },
    tiersByClient: { RF: [{ tierNumber: 1, minCount: 0, maxCount: null, ratePerActivation: d('150') }] },
    holdback: { advancePct: d('0.70'), holdbackPct: d('0.30') },
  };
  const activations: ActivationInput[] = [
    { id: 'a', productType: ProductType.internet, clientId: 'VF', saleDate: '2026-01-10' },
    { id: 'b', productType: ProductType.internet, clientId: 'RF', saleDate: '2026-01-10' },
    { id: 'c', productType: ProductType.tv, clientId: 'RF', saleDate: '2026-01-10' },
  ];

  it('constructs with NO dependencies (direct instantiation)', () => {
    expect(CommissionEngineService.length).toBe(0); // constructor arity
    expect(() => new CommissionEngineService()).not.toThrow();
  });

  it('same inputs → identical outputs, across separate instances', () => {
    const a = new CommissionEngineService().computePeriod({ activations, config });
    const b = new CommissionEngineService().computePeriod({ activations, config });
    expect(a.grossCommission.toFixed(2)).toBe(b.grossCommission.toFixed(2));
    expect(a.advanceAmount.toFixed(2)).toBe(b.advanceAmount.toFixed(2));
    expect(a.items.map((i) => i.rateApplied.toFixed(2))).toEqual(
      b.items.map((i) => i.rateApplied.toFixed(2)),
    );
  });

  it('does not mutate the config it is given (per-client maps included)', () => {
    const snapshot = JSON.stringify({
      tiers: config.tiers.map((t) => t.ratePerActivation.toFixed(2)),
      byClient: config.tiersByClient?.RF?.map((t) => t.ratePerActivation.toFixed(2)),
      flats: Object.entries(config.flatRates).map(([k, v]) => [k, v.toFixed(2)]),
    });
    new CommissionEngineService().computePeriod({ activations, config });
    expect(
      JSON.stringify({
        tiers: config.tiers.map((t) => t.ratePerActivation.toFixed(2)),
        byClient: config.tiersByClient?.RF?.map((t) => t.ratePerActivation.toFixed(2)),
        flats: Object.entries(config.flatRates).map(([k, v]) => [k, v.toFixed(2)]),
      }),
    ).toBe(snapshot);
  });

  it('does not mutate the activation list', () => {
    const before = JSON.stringify(activations);
    new CommissionEngineService().computePeriod({ activations, config });
    expect(JSON.stringify(activations)).toBe(before);
  });
});
