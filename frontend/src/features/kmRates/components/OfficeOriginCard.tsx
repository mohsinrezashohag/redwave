/**
 * OfficeOriginCard — set the office a km trip runs from (SRS EXP-004). Redwave's policy is that a day's
 * driving starts at the office, so every new km log DEFAULTS its first stop to this address instead of the
 * rep retyping it daily. It is a default, not a lock — a rep can replace the stop for a trip that genuinely
 * started elsewhere.
 *
 * Lives beside the km RATES because both answer "how is a kilometre measured and priced". Read is
 * permission-free (every rep's form needs it); saving is `settings:edit` — the server is the real gate (§5).
 * Coordinates are not captured here: a typed address gives the default without lat/lng, and the server
 * falls back to the rep's typed total exactly as it does for any manually entered stop.
 */
import { useEffect, useState } from 'react';
import { Button, Card, FormField, Input, useToast } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useExpenseSettings } from '../../expenses/api/useLookups';
import { useSaveOfficeOrigin } from '../api/useKmRates';

export function OfficeOriginCard() {
  const canEdit = useCan('settings:edit');
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const settings = useExpenseSettings();
  const save = useSaveOfficeOrigin();
  const [address, setAddress] = useState('');

  // Seed the input once the settings land (and whenever they change underneath us).
  useEffect(() => {
    setAddress(settings.data?.office_address ?? '');
  }, [settings.data?.office_address]);

  const dirty = address.trim() !== (settings.data?.office_address ?? '');

  const onSave = () =>
    save.mutate(
      { office_address: address.trim() },
      {
        onSuccess: () =>
          toast({
            title: address.trim() ? 'Office origin saved' : 'Office origin cleared',
            description: address.trim() ? 'New kilometre logs will start from this address.' : undefined,
            tone: 'success',
          }),
        onError,
      },
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
        help="Every new kilometre log starts from here — a rep can still replace it for a trip that began elsewhere. Leave blank for no default."
      >
        <Input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="1250 Portage Ave, Winnipeg, MB R3G 0T7"
          disabled={!canEdit || settings.isLoading}
        />
      </FormField>
    </Card>
  );
}
