/**
 * MapStops — the Maps-enabled KM stop editor (FE-3). Each stop is a Google Places autocomplete that
 * captures the real address + lat/lng; the ordered route renders on a map and the total distance is
 * AUTO-DERIVED from the Directions result and written to `total_km` (the server re-derives it
 * authoritatively). Only mounted when a browser Maps key is configured — otherwise KmItemFields uses the
 * manual fallback. Tokens only. — SRS §11 (KM map automation)
 */
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Autocomplete, DirectionsRenderer, GoogleMap, useJsApiLoader } from '@react-google-maps/api';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Button, FormField, IconButton, Input, LoadingSpinner } from '../../../components/ui';
import { MAPS_BROWSER_KEY, MAPS_LIBRARIES, MAPS_LOADER_ID } from '../maps.config';
import type { ExpenseFormValues } from './expenseForm.schema';
import styles from './expenses.module.css';

const MAP_CONTAINER = { width: '100%', height: '260px' };
const DEFAULT_CENTER = { lat: 49.8951, lng: -97.1384 }; // Winnipeg
const SIX = 6;

export function MapStops({ index, stopsError }: { index: number; stopsError?: string }) {
  const { control, register, setValue } = useFormContext<ExpenseFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: `items.${index}.stops` as const });
  const { isLoaded, loadError } = useJsApiLoader({
    id: MAPS_LOADER_ID,
    googleMapsApiKey: MAPS_BROWSER_KEY,
    libraries: MAPS_LIBRARIES,
  });

  const stops = useWatch({ control, name: `items.${index}.stops` }) ?? [];
  const [directions, setDirections] = useState<google.maps.DirectionsResult | null>(null);
  const acRefs = useRef<(google.maps.places.Autocomplete | null)[]>([]);

  const onPlaceChanged = (k: number) => {
    const place = acRefs.current[k]?.getPlace();
    const loc = place?.geometry?.location;
    if (!loc) return;
    setValue(`items.${index}.stops.${k}.address`, place?.formatted_address ?? place?.name ?? '', { shouldValidate: true });
    setValue(`items.${index}.stops.${k}.lat`, loc.lat().toFixed(SIX));
    setValue(`items.${index}.stops.${k}.lng`, loc.lng().toFixed(SIX));
  };

  // Geo-coordinates of stops that have been picked (in order). Re-derive the route when they change.
  const coords = stops
    .map((s) => (s?.lat && s?.lng && s.lat !== '0' ? { lat: Number(s.lat), lng: Number(s.lng) } : null))
    .filter((c): c is { lat: number; lng: number } => c !== null);
  const coordsKey = coords.map((c) => `${c.lat},${c.lng}`).join('|');

  useEffect(() => {
    if (!isLoaded || coords.length < 2) {
      setDirections(null);
      return;
    }
    const service = new google.maps.DirectionsService();
    const origin = coords[0];
    const destination = coords[coords.length - 1];
    const waypoints = coords.slice(1, -1).map((location) => ({ location, stopover: true }));
    let cancelled = false;
    service.route(
      { origin, destination, waypoints, travelMode: google.maps.TravelMode.DRIVING },
      (result, status) => {
        if (cancelled) return;
        if (status === google.maps.DirectionsStatus.OK && result) {
          setDirections(result);
          const meters = (result.routes[0]?.legs ?? []).reduce((sum, leg) => sum + (leg.distance?.value ?? 0), 0);
          setValue(`items.${index}.total_km`, (meters / 1000).toFixed(2), { shouldValidate: true });
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, coordsKey]);

  if (loadError) {
    // Maps failed to load — let the parent fall back to manual entry.
    return <p className={styles.itemsError}>Couldn’t load Google Maps. Refresh, or enter the distance manually.</p>;
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
      <FormField label="Stops" required error={stopsError} help="Search an address; the route distance fills in automatically.">
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
        <GoogleMap mapContainerStyle={MAP_CONTAINER} center={coords[0] ?? DEFAULT_CENTER} zoom={coords.length ? 11 : 10}>
          {directions && <DirectionsRenderer directions={directions} />}
        </GoogleMap>
      </div>
    </>
  );
}
