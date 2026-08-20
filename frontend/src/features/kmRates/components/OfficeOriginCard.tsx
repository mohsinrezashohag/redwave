/**
 * OfficeOriginCard — set the office a km trip runs from (SRS EXP-004). Redwave's policy is that a day's
 * driving starts at the office, so every new km log DEFAULTS its first stop to this address instead of the
 * rep retyping it daily. It is a default, not a lock — a rep can replace the stop for a trip that genuinely
 * started elsewhere.
 *
 * Lives beside the km RATES because both answer "how is a kilometre measured and priced". Read is
 * permission-free (every rep's form needs it); saving is `settings:edit` — the server is the real gate (§5).
 *
 * COORDINATES: when a browser Maps key is configured this uses Places autocomplete and captures the
 * office's lat/lng alongside the address, so the defaulted first stop is a GEOCODED stop and the server can
 * include it when it re-derives the authoritative route distance. Without a key (or when the address is
 * typed rather than picked) it degrades to a plain text field and stores no coordinates — the server then
 * falls back to the rep's typed total, exactly as it does for any manually entered stop. Same graceful
 * pattern as the KM form itself.
 */
import { useEffect, useRef, useState } from 'react';
import { Autocomplete, useJsApiLoader } from '@react-google-maps/api';
import { Button, Card, FormField, Input, useToast } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useExpenseSettings } from '../../expenses/api/useLookups';
import { MAPS_BROWSER_KEY, MAPS_LIBRARIES, MAPS_LOADER_ID, mapsEnabled } from '../../expenses/maps.config';
import { useSaveOfficeOrigin } from '../api/useKmRates';

const SIX = 6; // lat/lng are Decimal(9,6) server-side

const HELP =
  'Every new kilometre log starts from here — a rep can still replace it for a trip that began elsewhere. Leave blank for no default.';

export function OfficeOriginCard() {
  const canEdit = useCan('settings:edit');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const settings = useExpenseSettings();
  const save = useSaveOfficeOrigin();
  const [address, setAddress] = useState('');
  /** Set only when Places resolved the address; cleared the moment it is edited by hand. */
  const [coords, setCoords] = useState<{ lat: string; lng: string } | null>(null);
  const acRef = useRef<google.maps.places.Autocomplete | null>(null);

  const { isLoaded } = useJsApiLoader({
    id: MAPS_LOADER_ID,
    googleMapsApiKey: MAPS_BROWSER_KEY,
    libraries: MAPS_LIBRARIES,
    // Skip the loader entirely when no key is configured — never a failed script fetch.
    preventGoogleFontsLoading: true,
  });

  // Seed the input once the settings land (and whenever they change underneath us).
  useEffect(() => {
    setAddress(settings.data?.office_address ?? '');
    const lat = settings.data?.office_lat;
    const lng = settings.data?.office_lng;
    setCoords(lat && lng ? { lat, lng } : null);
  }, [settings.data?.office_address, settings.data?.office_lat, settings.data?.office_lng]);

  const saved = settings.data?.office_address ?? '';
  const savedLat = settings.data?.office_lat ?? null;
  const dirty = address.trim() !== saved || (coords?.lat ?? null) !== savedLat;

  const onPlaceChanged = () => {
    const place = acRef.current?.getPlace();
    const loc = place?.geometry?.location;
    if (!loc) return;
    setAddress(place?.formatted_address ?? place?.name ?? '');
    setCoords({ lat: loc.lat().toFixed(SIX), lng: loc.lng().toFixed(SIX) });
  };

  // Typing by hand invalidates any previously picked coordinates — never keep a lat/lng that no longer
  // matches the address, which would send the route derivation somewhere the office is not.
  const onType = (value: string) => {
    setAddress(value);
    setCoords(null);
  };

  const onSave = () => {
    const trimmed = address.trim();
    save.mutate(
      { office_address: trimmed, ...(trimmed && coords ? { office_lat: coords.lat, office_lng: coords.lng } : {}) },
      {
        onSuccess: () =>
          toast({
            title: trimmed ? 'Office origin saved' : 'Office origin cleared',
            description: trimmed
              ? coords
                ? 'Located — new kilometre logs will start here and it counts toward the route distance.'
                : 'New kilometre logs will start from this address.'
              : undefined,
            tone: 'success',
          }),
        onError,
      },
    );
  };

  const field = (
    <Input
      value={address}
      onChange={(e) => onType(e.target.value)}
      placeholder="1250 Portage Ave, Winnipeg, MB R3G 0T7"
      disabled={!canEdit || settings.isLoading}
    />
  );

  return (
    <Card
      title="Office origin"
      actions={
        canEdit ? (
          <Button variant="secondary" size="sm" onClick={onSave} loading={save.isPending} disabled={!dirty}>
            Save
          </Button>
        ) : undefined
      }
    >
      <FormField
        label="Office address"
        help={
          mapsEnabled
            ? coords
              ? `${HELP} Located — this address also counts toward the measured route distance.`
              : `${HELP} Pick a suggestion to locate it on the map.`
            : HELP
        }
      >
        {mapsEnabled && isLoaded ? (
          <Autocomplete onLoad={(ac) => (acRef.current = ac)} onPlaceChanged={onPlaceChanged}>
            {field}
          </Autocomplete>
        ) : (
          field
        )}
      </FormField>
    </Card>
  );
}
