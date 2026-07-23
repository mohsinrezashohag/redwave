/**
 * SaleForm — the FORM pattern (react-hook-form + zod + the foundation FormField). Plain inputs use
 * `register`; Radix controls (Select/MultiSelect/Checkbox) use `Controller`; errors flow to FormField.
 * Client → that client's products (dependent dropdown). On-behalf rep selector shows for admins/managers
 * (server is the real gate). Live Sale ID preview mirrors the backend base (server appends -1/-2 on a
 * duplicate). On success → toast with the composite Sale ID → navigate to the new sale. — SALE-001/002
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Banner,
  Button,
  Card,
  DatePicker,
  FormField,
  Input,
  MultiSelect,
  Select,
  Switch,
  useToast,
} from '../../../components/ui';
import { useAuth } from '../../../auth/useAuth';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { productTypeLabel } from '../../../lib/format/productType';
import { useProductTypes } from '../../productTypes/api/useProductTypes';
import { useClientProducts, useClients, useReps } from '../api/useSales';
import { useCreateSale } from '../api/useSaleMutations';
import type { Sale } from '../sales.types';
import styles from './SaleForm.module.css';

// Internet is the mandatory base of a sale; TV/Home Phone/Protection Plan/Mesh/Speed-attach are add-ons
// that can't be sold standalone. Base = a catalogue type whose behaviour is tiered or greenfield. The
// server re-enforces this (422, SALE-001a) — this is the convenience gate. — CLAUDE §5
const BASE_BEHAVIOURS = new Set(['tiered', 'greenfield']);

const SELF = '__self__';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  client_id: z.string().uuid({ message: 'Select a client' }),
  rep_id: z.string().optional(),
  sale_date: z.string().regex(DATE, 'Use YYYY-MM-DD'),
  customer_first_name: z.string().min(1, 'Required').max(80),
  customer_last_name: z.string().min(1, 'Required').max(80),
  street: z.string().min(1, 'Required').max(200),
  city: z.string().min(1, 'Required').max(100),
  province_state: z.string().min(1, 'Required').max(100),
  postal_code: z.string().min(1, 'Required').max(20),
  mpu_id: z.string().max(100).optional(),
  is_greenfield: z.boolean().optional(),
  product_ids: z.array(z.string().uuid()).min(1, 'Select at least one product'),
});
type FormValues = z.infer<typeof schema>;

export function SaleForm() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const { isSuperAdmin, roles } = useAuth();
  const canViewClients = useCan('clients:view');
  const canSeeReps = useCan('hrm:view') && (isSuperAdmin || roles.includes('Admin') || roles.includes('Manager'));

  const create = useCreateSale();
  const clients = useClients(canViewClients);
  const reps = useReps(canSeeReps);
  const productTypes = useProductTypes('all', canViewClients);

  const { control, register, handleSubmit, watch, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      client_id: '',
      rep_id: '',
      sale_date: todayIso(),
      customer_first_name: '',
      customer_last_name: '',
      street: '',
      city: '',
      province_state: '',
      postal_code: '',
      mpu_id: '',
      is_greenfield: false,
      product_ids: [],
    },
  });
  const errors = formState.errors;

  const clientId = watch('client_id');
  const saleDate = watch('sale_date');
  const mpuId = watch('mpu_id');
  const selectedProductIds = watch('product_ids');
  const products = useClientProducts(clientId || undefined, canViewClients);

  const clientCode = clients.data?.find((c) => c.id === clientId)?.client_code;
  const saleIdPreview = [saleDate, mpuId, clientCode].filter((p) => p && p.trim()).join('-');

  // Require an internet base among the selected products. Only enforce once the catalogue has loaded
  // (otherwise a valid internet sale could be falsely blocked); until then the server is the gate.
  const behaviourByKey = new Map((productTypes.data ?? []).map((t) => [t.key, t.behaviour]));
  const hasInternetBase = selectedProductIds.some((id) => {
    const type = products.data?.find((p) => p.id === id)?.product_type;
    return type ? BASE_BEHAVIOURS.has(behaviourByKey.get(type) ?? '') : false;
  });
  const missingBase =
    selectedProductIds.length > 0 && (productTypes.data?.length ?? 0) > 0 && !hasInternetBase;

  const onSubmit = (values: FormValues) => {
    create.mutate(
      {
        client_id: values.client_id,
        rep_id: values.rep_id || undefined,
        sale_date: values.sale_date,
        // The client bill prints the two names as separate columns; the server derives the display name.
        customer_name: `${values.customer_first_name} ${values.customer_last_name}`.trim(),
        customer_first_name: values.customer_first_name,
        customer_last_name: values.customer_last_name,
        street: values.street,
        city: values.city,
        province_state: values.province_state,
        postal_code: values.postal_code,
        mpu_id: values.mpu_id || undefined,
        is_greenfield: values.is_greenfield || undefined,
        items: values.product_ids.map((product_id) => ({ product_id })),
      },
      {
        onSuccess: (sale: Sale) => {
          toast({ title: 'Sale entered', description: `Sale ID ${sale.sale_code}`, tone: 'success' });
          navigate(`/sales/${sale.id}`);
        },
        onError,
      },
    );
  };

  if (!canViewClients) {
    return (
      <Banner tone="warning" title="Clients unavailable">
        Entering a sale needs access to clients and products, which your role doesn&rsquo;t have. Ask an
        administrator to grant <span className="mono">clients:view</span>.
      </Banner>
    );
  }

  return (
    <Card>
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className={styles.grid}>
          <Controller
            control={control}
            name="client_id"
            render={({ field, fieldState }) => (
              <FormField label="Client" required error={fieldState.error?.message}>
                <Select
                  placeholder="Select a client"
                  options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                  value={field.value || undefined}
                  onValueChange={(v) => {
                    field.onChange(v);
                    setValue('product_ids', []); // reset products when the client changes
                  }}
                />
              </FormField>
            )}
          />

          <Controller
            control={control}
            name="product_ids"
            render={({ field, fieldState }) => (
              <FormField label="Products" required error={fieldState.error?.message}>
                <MultiSelect
                  placeholder={clientId ? 'Add product' : 'Select a client first'}
                  options={(products.data ?? []).map((p) => ({
                    value: p.id,
                    label: `${p.name} · ${productTypeLabel(p.product_type)}`,
                  }))}
                  value={field.value}
                  onChange={field.onChange}
                />
              </FormField>
            )}
          />
        </div>

        <div className={styles.grid}>
          <FormField label="Customer first name" required error={errors.customer_first_name?.message}>
            <Input {...register('customer_first_name')} placeholder="Jane" />
          </FormField>
          <FormField label="Customer last name" required error={errors.customer_last_name?.message}>
            <Input {...register('customer_last_name')} placeholder="Doe" />
          </FormField>
        </div>

        <FormField label="Street" required error={errors.street?.message}>
          <Input {...register('street')} placeholder="123 Main St" />
        </FormField>

        <div className={styles.grid3}>
          <FormField label="City" required error={errors.city?.message}>
            <Input {...register('city')} />
          </FormField>
          <FormField label="Province / State" required error={errors.province_state?.message}>
            <Input {...register('province_state')} />
          </FormField>
          <FormField label="Postal code" required error={errors.postal_code?.message}>
            <Input {...register('postal_code')} />
          </FormField>
        </div>

        <div className={styles.grid3}>
          <Controller
            control={control}
            name="sale_date"
            render={({ field }) => (
              <FormField label="Sale date" required error={errors.sale_date?.message} help="Governs the pay period.">
                <DatePicker
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  invalid={!!errors.sale_date}
                  aria-label="Sale date"
                />
              </FormField>
            )}
          />

          <FormField label="MPU ID" error={errors.mpu_id?.message} help="Where the client supplies one.">
            <Input {...register('mpu_id')} placeholder="optional" />
          </FormField>
          {canSeeReps && (
            <Controller
              control={control}
              name="rep_id"
              render={({ field }) => (
                <FormField label="Rep (on behalf of)" help="Defaults to you.">
                  <Select
                    options={[
                      { value: SELF, label: 'Myself' },
                      ...(reps.data ?? []).map((r) => ({ value: r.id, label: `${r.full_name} (${r.rep_code})` })),
                    ]}
                    value={field.value || SELF}
                    onValueChange={(v) => field.onChange(v === SELF ? '' : v)}
                  />
                </FormField>
              )}
            />
          )}
        </div>

        <Controller
          control={control}
          name="is_greenfield"
          render={({ field }) => (
            <Switch
              tone="success"
              label="Greenfield request (an admin confirms at validation)"
              checked={!!field.value}
              onCheckedChange={(c) => field.onChange(c === true)}
            />
          )}
        />

        {missingBase && (
          <Banner tone="warning" title="Internet is required">
            A sale must include an internet activation as its base — TV, Home Phone and other add-ons
            can&rsquo;t be sold on their own. Add an internet product to continue.
          </Banner>
        )}

        <div className={styles.footer}>
          <span className={styles.preview}>
            Sale ID preview:{' '}
            <span className="mono">{saleIdPreview || '—'}</span>
            {saleIdPreview && <span className={styles.previewNote}> (server appends -1/-2 if duplicate)</span>}
          </span>
          <div className={styles.actions}>
            <Button variant="secondary" type="button" onClick={() => navigate('/sales')}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={create.isPending} disabled={missingBase}>
              Enter sale
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}
