/**
 * MapStops — the Maps-enabled KM stop editor (FE-3). Each stop is a Google Places autocomplete that
 * captures the real address + lat/lng; the ordered route renders on a map and the total distance is
 * AUTO-DERIVED from the Directions result and written to `total_km` (the server re-derives it
 * authoritatively). A stop can also be dropped by CLICKING the map — the point is reverse-geocoded to an
 * address (falling back to the lat/lng) and fills the next empty stop (or appends one). Only mounted when a
 * browser Maps key is configured — otherwise KmItemFields uses the manual fallback. Tokens only.
 * — SRS §11 (KM map automation)
 */
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Autocomplete, DirectionsRenderer, GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Button, FormField, IconButton, Input, LoadingSpinner } from '../../../components/ui';
import { MAPS_BROWSER_KEY, MAPS_LIBRARIES, MAPS_LOADER_ID } from '../maps.config';
import { routeCoords } from '../km';
import type { TripType } from '../expenses.types';
import type { ExpenseFormValues } from './expenseForm.schema';
import styles from './expenses.module.css';

const MAP_CONTAINER = { width: '100%', height: '260px' };
const DEFAULT_CENTER = { lat: 49.8951, lng: -97.1384 }; // Winnipeg
const SIX = 6;
/** Draw the route line only — the numbered stop pins are rendered separately (see below). */
const DIRECTIONS_OPTIONS = { suppressMarkers: true };

declare global {
  interface Window {
    /** Google calls this when it REJECTS the key (referrer not allowed, API not enabled, billing). */
    gm_authFailure?: () => void;
  }
}

export function MapStops({
  index,
  stopsError,
  onMapsUnavailable,
  onRouteResult,
}: {
  index: number;
  stopsError?: string;
  /** The map can't be used at all (script failed, or Google rejected the key) → parent goes manual. */
  onMapsUnavailable: () => void;
  /** Whether the Directions lookup produced a distance for the current stops. */
  onRouteResult: (ok: boolean) => void;
}) {
  const { control, register, setValue } = useFormContext<ExpenseFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: `items.${index}.stops` as const });
  const { isLoaded, loadError } = useJsApiLoader({
    id: MAPS_LOADER_ID,
    googleMapsApiKey: MAPS_BROWSER_KEY,
    libraries: MAPS_LIBRARIES,
  });

  // A key Google rejects does NOT surface as loadError: the script loads, then Google calls the global
  // gm_authFailure and paints a grey "can't load Google Maps correctly" box. Both cases hand the rep back
  // the manual form instead of a dead map.
  useEffect(() => {
    if (loadError) onMapsUnavailable();
  }, [loadError, onMapsUnavailable]);
  useEffect(() => {
    const previous = window.gm_authFailure;
    window.gm_authFailure = () => {
      onMapsUnavailable();
      previous?.();
    };
    return () => {
      window.gm_authFailure = previous;
    };
  }, [onMapsUnavailable]);

  const stops = useWatch({ control, name: `items.${index}.stops` }) ?? [];
  const trip = (useWatch({ control, name: `items.${index}.trip_type` }) ?? 'round') as TripType;
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const acRefs = useRef<(google.maps.places.Autocomplete | null)[]>([]);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  const onPlaceChanged = (k: number) => {
    const place = acRefs.current[k]?.getPlace();
    const loc = place?.geometry?.location;
    if (!loc) return;
    setValue(`items.${index}.stops.${k}.address`, place?.formatted_address ?? place?.name ?? '', { shouldValidate: true });
    setValue(`items.${index}.stops.${k}.lat`, loc.lat().toFixed(SIX));
    setValue(`items.${index}.stops.${k}.lng`, loc.lng().toFixed(SIX));
  };

  const setStop = (k: number, address: string, lat: string, lng: string) => {
    setValue(`items.${index}.stops.${k}.address`, address, { shouldValidate: true });
    setValue(`items.${index}.stops.${k}.lat`, lat);
    setValue(`items.${index}.stops.${k}.lng`, lng);
  };

  // Click the map to drop a stop: capture the point's lat/lng immediately (so the route can derive even if
  // the reverse-geocode is slow/unavailable) into the first EMPTY stop — or append a new one — then fill
  // the human-readable address once the geocoder responds.
  const onMapClick = (e: google.maps.MapMouseEvent) => {
    const loc = e.latLng;
    if (!loc) return;
    const lat = loc.lat().toFixed(SIX);
    const lng = loc.lng().toFixed(SIX);
    const fallback = `Dropped pin (${lat}, ${lng})`;
    const emptyIdx = stops.findIndex((s) => !s?.address || !s.address.trim());
    const target = emptyIdx >= 0 ? emptyIdx : fields.length;
    if (emptyIdx >= 0) setStop(emptyIdx, fallback, lat, lng);
    else append({ address: fallback, lat, lng });
    if (!geocoderRef.current) geocoderRef.current = new google.maps.Geocoder();
    geocoderRef.current.geocode({ location: loc.toJSON() }, (results, status) => {
      if (status === google.maps.GeocoderStatus.OK && results?.[0]) {
        setValue(`items.${index}.stops.${target}.address`, results[0].formatted_address, { shouldValidate: true });
      }
    });
  };

  // Geo-coordinates of stops that have been picked (in order). Re-derive the route when they (or the
  // trip type) change. A ROUND trip measures the CLOSED LOOP back to the first stop — mirrors the
  // server's authoritative derivation (the map + auto-distance show what will be paid). — SRS EXP-004
  const coords = stops
    .map((s) => (s?.lat && s?.lng && s.lat !== '0' ? { lat: Number(s.lat), lng: Number(s.lng) } : null))
    .filter((c): c is { lat: number; lng: number } => c !== null);
  const measured = routeCoords(coords, trip);
  const coordsKey = measured.map((c) => `${c.lat},${c.lng}`).join('|');

  useEffect(() => {
    if (!isLoaded || measured.length < 2) {
      setDirections(null);
      return;
    }
    const service = new google.maps.DirectionsService();
    const origin = measured[0];
    const destination = measured[measured.length - 1];
    const waypoints = measured.slice(1, -1).map((location) => ({ location, stopover: true }));
    let cancelled = false;
    service.route(
      { origin, destination, waypoints, travelMode: google.maps.TravelMode.DRIVING },
      (result, status) => {
        if (cancelled) return;
        if (status === google.maps.DirectionsStatus.OK && result) {
          setDirections(result);
          const meters = (result.routes[0]?.legs ?? []).reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0);
          setValue(`items.${index}.total_km`, (meters / 1000).toFixed(2), { shouldValidate: true });
          onRouteResult(true);
        } else {
          // No route (Directions API not enabled, quota, unroutable stops): the rep types the distance.
          setDirections(null);
          onRouteResult(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, coordsKey]);

  if (loadError) {
    // The effect above has already told the parent, which swaps in the manual form.
    return null;
  }
  if (!isLoaded) {
    return (
      <div className={styles.mapLoading}>
        <LoadingSpinner size="sm" label="Loading map" />
      </div>
    );
  }

  return (
    <>
      <FormField
        label="Stops"
        required
        error={stopsError}
        help="Search an address or click the map to drop a stop; the route distance fills in automatically."
      >
        <div className={styles.stops}>
          {fields.map((f, k) => (
            <div className={styles.stopRow} key={f.id}>
              <span className={styles.stopOrder}>{k + 1}</span>
              <div className={styles.stopAddress}>
                <Autocomplete
                  onLoad={(ac) => {
                    acRefs.current[k] = ac;
                  }}
                  onPlaceChanged={() => onPlaceChanged(k)}
                >
                  <Input placeholder="Search an address…" {...register(`items.${index}.stops.${k}.address`)} />
                </Autocomplete>
              </div>
              <IconButton
                label="Remove stop"
                icon={<Trash2 size={15} />}
                variant="outline"
                size="sm"
                disabled={fields.length <= 2}
                onClick={() => {
                  acRefs.current.splice(k, 1);
                  remove(k);
                }}
              />
            </div>
          ))}
          <Button
            variant="tertiary"
            size="sm"
            type="button"
            leftIcon={<Plus size={14} />}
            onClick={() => append({ address: '', lat: '', lng: '' })}
          >
            Add stop
          </Button>
        </div>
      </FormField>

      <div className={styles.mapWrap}>
        <GoogleMap
          mapContainerStyle={MAP_CONTAINER}
          center={coords[0] ?? DEFAULT_CENTER}
          zoom={coords.length ? 11 : 10}
          onClick={onMapClick}
        >
          {/* Pins are OUR numbers (1, 2, 3 — matching the stop list), never Google's A/B/C: on a round trip
              the route returns to the first stop, so Google's last letter ("C") sat on top of "A" and the
              start looked like it was missing. The route line is drawn without its own markers. */}
          {directions && <DirectionsRenderer directions={directions} options={DIRECTIONS_OPTIONS} />}
          {coords.map((c, i) => (
            <Marker key={`${i}:${c.lat},${c.lng}`} position={c} label={String(i + 1)} />
          ))}
        </GoogleMap>
      </div>
    </>
  );
}
