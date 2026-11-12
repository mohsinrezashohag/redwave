/**
 * BasePricesModal — switch a scope to BASE PRICES (tiers off), or edit its prices. — client request 2026-11-11
 *
 * Global sets ONE default price per internet activation (every client following Global uses it). A client
 * gets the same default plus, per internet product, its own price; a blank product uses the default.
 * Saved in ONE server transaction, effective-dated like every rate (#10): it starts in a future pay period,
 * and past periods are never rewritten. Greenfield, TV, home phone and add-ons stay under Flat rates.
 * The UI computes no pay — it only collects prices (#1). Tokens only.
 */
import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Banner, Button, FormField, Modal, MoneyInput, Table, TBody, TD, TH, THead, TR, useToast, ModalClose } from '../../../components/ui';
import { PayPeriodSelect } from '../../../components/data/PayPeriodSelect';
import { DataState } from '../../../components/data/DataState';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useClientProducts } from '../../clients/api/useClients';
import { useTierRates } from '../api/useCommission';
import { useSetBasePrices } from '../api/useCommissionMutations';
import { basePricesSchema, priceRows, toBasePricesBody, type BasePricesForm } from './basePricesForm';
import styles from './commission.module.css';

export function BasePricesModal({
  clientId,
  scopeName,
  defaultRate,
  switching,
  onClose,
}: {
  /** undefined = Global. */
  clientId?: string;
  scopeName: string;
  /** Pre-fill for the default price (the current base price, or the old ladder's entry rate). */
  defaultRate?: string;
  /** True when this turns tiers OFF (vs. editing existing base prices). */
  switching: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const save = useSetBasePrices();
  const products = useClientProducts(clientId, !!clientId);
  const rates = useTierRates('current', clientId, undefined, !!clientId);

  const { control, handleSubmit, formState, reset } = useForm<BasePricesForm>({
    resolver: zodResolver(basePricesSchema),
    defaultValues: { effective_from: '', effective_to: '', default_rate: defaultRate ?? '', prices: [] },
  });
  const rows = useFieldArray({ control, name: 'prices' });
  const errors = formState.errors;

  // Fill the product rows once the client's products and current prices arrive.
  useEffect(() => {
    if (!clientId || !products.data || !rates.data) return;
    reset((v) => ({ ...v, prices: priceRows(products.data, rates.data) }));
  }, [clientId, products.data, rates.data, reset]);

  const onSubmit = (values: BasePricesForm) =>
    save.mutate(toBasePricesBody(values, clientId), {
      onSuccess: () => {
        toast({
          title: switching ? 'Tiers turned off' : 'Base prices saved',
          description: `${scopeName}: base prices from the chosen period.`,
          tone: 'success',
        });
        onClose();
      },
      onError,
    });

  return (
    <Modal dirty={formState.isDirty} open onOpenChange={(o) => !o && onClose()} title={switching ? `Turn tiers off · ${scopeName}` : `Base prices · ${scopeName}`} size="lg">
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <Banner tone="info" title="How base prices work">
          Every internet sale pays its product&rsquo;s base price, whatever the rep&rsquo;s volume. A product left blank uses the
          default price. Prices start in the period you pick; earlier periods keep what they were paid.
          {!clientId && ' This Global default applies to every client that has no setting of its own.'}
        </Banner>

        <div className={styles.dates}>
          <Controller
            control={control}
            name="effective_from"
            render={({ field }) => (
              <FormField label="Starts from" required error={errors.effective_from?.message}>
                <PayPeriodSelect value={field.value} onChange={field.onChange} aria-label="Starts from period" />
              </FormField>
            )}
          />
          <Controller
            control={control}
            name="effective_to"
            render={({ field }) => (
              <FormField label="Ends" help="Leave open-ended unless the prices should stop.">
                <PayPeriodSelect value={field.value} onChange={field.onChange} boundary="end" allowOpenEnded aria-label="Ends after period" />
              </FormField>
            )}
          />
        </div>

        <Controller
          control={control}
          name="default_rate"
          render={({ field }) => (
            <FormField
              label="Default price per internet sale"
              required
              error={errors.default_rate?.message}
              help={clientId ? 'Used for any product below that is left blank.' : 'Set per-product prices on each client.'}
            >
              <MoneyInput value={field.value} onChange={field.onChange} placeholder="145.00" />
            </FormField>
          )}
        />

        {clientId && (
          <FormField label="Price per product" help="Internet products only. Greenfield, TV, home phone and add-ons are priced under Flat rates." group>
            <DataState
              isLoading={products.isLoading || rates.isLoading}
              isError={products.isError || rates.isError}
              isEmpty={rows.fields.length === 0}
              onRetry={() => {
                void products.refetch();
                void rates.refetch();
              }}
              emptyNode={<p className={styles.note}>This client has no active internet products yet.</p>}
            >
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH align="right">Base price</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.fields.map((row, i) => (
                    <TR key={row.id}>
                      <TD>{row.name}</TD>
                      <TD align="right">
                        <Controller
                          control={control}
                          name={`prices.${i}.amount`}
                          render={({ field }) => (
                            <MoneyInput
                              value={field.value}
                              onChange={field.onChange}
                              placeholder="Default"
                              aria-label={`Base price for ${row.name}`}
                              aria-invalid={!!errors.prices?.[i]?.amount}
                            />
                          )}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </DataState>
          </FormField>
        )}

        <div className={styles.footer}>
          <ModalClose asChild>
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </ModalClose>
          <Button variant="primary" type="submit" loading={save.isPending}>
            {switching ? 'Turn tiers off' : 'Save prices'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
