import { describe, expect, it } from 'vitest';
import { kmEntryMode } from './kmEntryMode';

describe('kmEntryMode — a Maps problem never blocks logging a trip', () => {
  it('no key: manual entry, no warning', () => {
    expect(kmEntryMode({ mapsEnabled: false, mapsFailed: false, routeFailed: false })).toEqual({
      showMap: false,
      distanceEditable: true,
      warning: null,
    });
  });

  it('map working + route found: map shown, distance auto-filled (read-only)', () => {
    const m = kmEntryMode({ mapsEnabled: true, mapsFailed: false, routeFailed: false });
    expect(m).toEqual({ showMap: true, distanceEditable: false, warning: null });
  });

  // Production: a key Google rejects (referrer / API / billing) or a blocked script.
  it('map failed to load or was rejected: fall back to the full manual form, with a warning', () => {
    const m = kmEntryMode({ mapsEnabled: true, mapsFailed: true, routeFailed: false });
    expect(m.showMap).toBe(false);
    expect(m.distanceEditable).toBe(true);
    expect(m.warning).toMatch(/manually/);
  });

  it('map up but the route lookup failed: keep the map, unlock the distance', () => {
    const m = kmEntryMode({ mapsEnabled: true, mapsFailed: false, routeFailed: true });
    expect(m).toMatchObject({ showMap: true, distanceEditable: true });
    expect(m.warning).toMatch(/total distance manually/);
  });
});
