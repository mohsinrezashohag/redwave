/**
 * ClientScopeField — the scope picker shared by the tier-schedule and flat-rate modals: "All clients" (the
 * global fallback row, `client_id` omitted) or one specific client. Mirrors IncentiveModal's scope_mode
 * radio + client Select. `/v1/clients` is a REFERENCE read the backend re-validates — not a rate-stream
 * join (#3). Without `clients:view` only the global scope is offered.
 */
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { Banner, FormField, RadioGroup, Select } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useClients } from '../api/useCommission';

export interface ClientScopeFieldProps<T extends FieldValues> {
  control: Control<T>;
  /** Field holding `'all' | 'specific'`. */
  modeName: Path<T>;
  /** Field holding the selected client id. */
  clientName: Path<T>;
  mode: 'all' | 'specific';
  error?: string;
  /** What this scope means for the rate being added (tier schedule vs flat rate). */
  help: string;
}

export function ClientScopeField<T extends FieldValues>({
  control,
  modeName,
  clientName,
  mode,
  error,
  help,
}: ClientScopeFieldProps<T>) {
  const canViewClients = useCan('clients:view');
  const clients = useClients(canViewClients && mode === 'specific');

  return (
    <>
      <Controller
        control={control}
        name={modeName}
        render={({ field }) => (
          <FormField label="Applies to" help={help}>
            <RadioGroup
              ariaLabel="Rate scope"
              value={field.value}
              onValueChange={field.onChange}
              options={[
                { value: 'all', label: 'All clients (global)' },
                { value: 'specific', label: 'One client', disabled: !canViewClients },
              ]}
            />
          </FormField>
        )}
      />
      {mode === 'specific' && (
        <>
          <Controller
            control={control}
            name={clientName}
            render={({ field }) => (
              <FormField label="Client" required error={error}>
                <Select
                  placeholder={clients.isLoading ? 'Loading clients…' : 'Select a client'}
                  options={(clients.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.client_code})` }))}
                  value={field.value || undefined}
                  onValueChange={field.onChange}
                />
              </FormField>
            )}
          />
          <Banner tone="info" title="Scoped to one client">
            This client&rsquo;s sales are paid at these rates instead of the global ones. It is a separate
            effective-dated stream — it never supersedes or bounds the global rows. The internet tally that
            picks the tier still counts <strong>every client together</strong>.
          </Banner>
        </>
      )}
    </>
  );
}
