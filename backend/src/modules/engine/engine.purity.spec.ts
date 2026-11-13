/**
 * Engine PURITY guard — the Commission Engine is pure and isolated: given activations + config it returns
 * the same result every time, with NO database, HTTP, clock, or cross-module coupling. Purity was
 * convention-only (documented in README.md but never asserted), which is fragile for the most
 * money-critical code in the repo. Proven two ways: (a) structural source scan, (b) determinism + no-constructor-deps.
 * — CLAUDE §3 #1, §6
 */
import * as fs from 'fs';
import * as path from 'path';
import { Decimal } from 'decimal.js';
import { CommissionEngineService } from './commission-engine.service';
import { ActivationInput, EngineConfig, ProductType } from './engine.types';

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
  const config: EngineConfig = {
    flatRates: { internet: d('110'), tv: d('30'), greenfield_internet: d('100') },
    flatRatesByClient: { RF: { internet: d('150') } },
    flatRatesByProduct: { fibre1g: d('140') },
  };
  const activations: ActivationInput[] = [
    { id: 'a', productType: ProductType.internet, clientId: 'VF', saleDate: '2026-01-10', productId: 'fibre1g' },
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
    expect(a.commissionTotal.toFixed(2)).toBe(b.commissionTotal.toFixed(2));
    expect(a.items.map((i) => i.rateApplied.toFixed(2))).toEqual(b.items.map((i) => i.rateApplied.toFixed(2)));
  });

  it('does not mutate the config it is given (per-client and per-product maps included)', () => {
    const snap = () =>
      JSON.stringify({
        flats: Object.entries(config.flatRates).map(([k, v]) => [k, v.toFixed(2)]),
        byClient: config.flatRatesByClient?.RF?.internet.toFixed(2),
        byProduct: config.flatRatesByProduct?.fibre1g.toFixed(2),
      });
    const before = snap();
    new CommissionEngineService().computePeriod({ activations, config });
    expect(snap()).toBe(before);
  });

  it('does not mutate the activation list', () => {
    const before = JSON.stringify(activations);
    new CommissionEngineService().computePeriod({ activations, config });
    expect(JSON.stringify(activations)).toBe(before);
  });
});
