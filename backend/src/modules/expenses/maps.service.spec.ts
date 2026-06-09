import { MapsService } from './maps.service';

const realStops = [
  { lat: '49.8951', lng: '-97.1384' },
  { lat: '49.8339', lng: '-97.1526' },
];

function make(key?: string) {
  const config = { get: jest.fn().mockReturnValue(key) };
  return { maps: new MapsService(config as never), config };
}

describe('MapsService (server-authoritative route distance, env-gated)', () => {
  afterEach(() => {
    // @ts-expect-error reset the mocked global fetch between tests
    global.fetch = undefined;
  });

  it('returns null (graceful) when no GOOGLE_MAPS_API_KEY is configured', async () => {
    const { maps } = make(undefined);
    expect(maps.isConfigured()).toBe(false);
    expect(await maps.routeDistanceKm(realStops)).toBeNull();
  });

  it('returns null for fewer than two stops', async () => {
    const { maps } = make('KEY');
    expect(await maps.routeDistanceKm([realStops[0]])).toBeNull();
  });

  it('returns null for stubbed all-zero coordinates (no-geocoder fallback)', async () => {
    const { maps } = make('KEY');
    const zero = [
      { lat: '0', lng: '0' },
      { lat: '0', lng: '0' },
    ];
    expect(await maps.routeDistanceKm(zero)).toBeNull();
  });

  it('sums the Directions legs (meters → km, exact decimal) when configured', async () => {
    const { maps } = make('KEY');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'OK', routes: [{ legs: [{ distance: { value: 12500 } }, { distance: { value: 7500 } }] }] }),
    }) as never;
    const km = await maps.routeDistanceKm(realStops);
    expect(km?.toFixed(2)).toBe('20.00'); // (12500 + 7500) m = 20 km
  });

  it('returns null on a non-OK Directions status (graceful fallback)', async () => {
    const { maps } = make('KEY');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ZERO_RESULTS' }) }) as never;
    expect(await maps.routeDistanceKm(realStops)).toBeNull();
  });

  it('returns null on a thrown fetch (network error) — never blocks the claim', async () => {
    const { maps } = make('KEY');
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as never;
    expect(await maps.routeDistanceKm(realStops)).toBeNull();
  });
});
