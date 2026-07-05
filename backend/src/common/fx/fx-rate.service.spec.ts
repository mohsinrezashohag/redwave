import { Decimal } from 'decimal.js';
import { FxRateService } from './fx-rate.service';

/** Config stub: FX_RATE_SOURCE + optional timeout. */
function makeConfig(source?: string) {
  return { get: jest.fn((key: string) => (key === 'FX_RATE_SOURCE' ? source : undefined)) };
}

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

describe('FxRateService.getRateToCad — env-gated, graceful (never throws)', () => {
  it('CAD→CAD is 1 with NO fetch, even when the source is enabled', async () => {
    const svc = new FxRateService(makeConfig('bank_of_canada') as never);
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as never;
    const rate = await svc.getRateToCad('CAD', D('2026-08-01'));
    expect(rate).toBeInstanceOf(Decimal);
    expect(rate!.toString()).toBe('1');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('source disabled (manual) → null (caller uses a manual override)', async () => {
    const svc = new FxRateService(makeConfig(undefined) as never);
    expect(await svc.getRateToCad('USD', D('2026-08-01'))).toBeNull();
    expect(svc.isAutoEnabled()).toBe(false);
  });

  it('source bank_of_canada + a valid Valet response → the most recent observation (Decimal)', async () => {
    const svc = new FxRateService(makeConfig('bank_of_canada') as never);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        observations: [
          { d: '2026-07-30', FXUSDCAD: { v: '1.3600' } },
          { d: '2026-07-31', FXUSDCAD: { v: '1.36500000' } }, // most recent → used
        ],
      }),
    }) as never;
    const rate = await svc.getRateToCad('USD', D('2026-08-01'));
    expect(rate!.toString()).toBe('1.365');
  });

  it('a non-OK response → null (never throws)', async () => {
    const svc = new FxRateService(makeConfig('bank_of_canada') as never);
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as never;
    expect(await svc.getRateToCad('USD', D('2026-08-01'))).toBeNull();
  });

  it('a network error → null (never throws)', async () => {
    const svc = new FxRateService(makeConfig('bank_of_canada') as never);
    global.fetch = jest.fn().mockRejectedValue(new Error('ENOTFOUND')) as never;
    expect(await svc.getRateToCad('USD', D('2026-08-01'))).toBeNull();
  });

  it('an empty observation set → null', async () => {
    const svc = new FxRateService(makeConfig('bank_of_canada') as never);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ observations: [] }) }) as never;
    expect(await svc.getRateToCad('USD', D('2026-08-01'))).toBeNull();
  });
});
