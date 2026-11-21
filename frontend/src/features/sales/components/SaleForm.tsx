/**
 * SaleForm — the FORM pattern (react-hook-form + zod + the foundation FormField). Plain inputs use
 * `register`; Radix controls (Select/MultiSelect/Checkbox) use `Controller`; errors flow to FormField.
 * Client → that client's products (dependent dropdown). Live Sale ID preview mirrors the backend base.
 * On success → toast with the composite Sale ID → navigate to the new sale. — SALE-001/002
 *
 * Client meeting 2026-11-16:
 *  - Province/State is a dropdown of province/territory/state CODES (the server validates the same list);
 *    City is a per-province list with "Other" for free text.
 *  - The Rep / Agent field is ALWAYS shown. Someone who may pick a rep (admin/manager) must pick one;
 *    "Myself" is offered only when their own login is linked to a rep. A plain rep sees their Agent ID.
 *  - EDIT MODE (`sale` given, the 5-day window): client, sale date, MPU ID and rep are fixed; only the
 *    changed fields are sent. An editor (sales:edit) saves directly; a rep sends an edit REQUEST.
 */
import { Save } from 'lucide-react';
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
  SelectWithOther,
  Switch,
  useToast,
} from '../../../components/ui';
import { useAuth } from '../../../auth/useAuth';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { todayIso } from '../../../lib/format/date';
import { productTypeLabel } from '../../../lib/format/productType';
import { cityOptions, isListedCity, OTHER_CITY, regionOptions, resolveRegion } from '../../../lib/geo/regions';
import { useProductTypes } from '../../productTypes/api/useProductTypes';
import { useClientProducts, useClients, useOwnRepCode, useReps } from '../api/useSales';
import { useCreateSale } from '../api/useSaleMutations';
import { useEditSale, useRequestSaleEdit } from '../api/useSaleEdits';
import type { Sale, UpdateSaleBody } from '../sales.types';
import styles from './SaleForm.module.css';
import { useUnsavedChangesGuard } from '../../../lib/forms/useUnsavedChangesGuard';
import { joinDistinct } from '../../../lib/format/text';

// Internet is the mandatory base of a sale; TV/Home Phone/Protection Plan/Mesh/Speed-attach are add-ons
// that can't be sold standalone. Base = a catalogue type whose behaviour is internet or greenfield. The
// server re-enforces this (422, SALE-001a) — this is the convenience gate. — CLAUDE §5
const BASE_BEHAVIOURS = new Set(['internet', 'greenfield']);

const SELF = '__self__';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REGION_OPTIONS = regionOptions();

const makeSchema = (requireRep: boolean) =>
  z
    .object({
      client_id: z.string().uuid({ message: 'Select a client' }),
      rep_id: z.string().optional(),
      sale_date: z.string().regex(DATE, 'Use YYYY-MM-DD'),
      customer_first_name: z.string().min(1, 'Required').max(80),
      customer_last_name: z.string().min(1, 'Required').max(80),
      street: z.string().min(1, 'Required').max(200),
      province_state: z.string().min(1, 'Select a province or state'),
      city_choice: z.string().min(1, 'Select a city'),
      city_other: z.string().max(100).optional(),
      postal_code: z.string().min(1, 'Required').max(20),
      mpu_id: z.string().max(100).optional(),
      is_greenfield: z.boolean().optional(),
      product_ids: z.array(z.string().uuid()).min(1, 'Select at least one product'),
    })
    .superRefine((v, ctx) => {
      if (v.city_choice === OTHER_CITY && !v.city_other?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['city_other'], message: 'Enter the city' });
      }
      if (requireRep && !v.rep_id) {
        ctx.addIssue({ code: 'custom', path: ['rep_id'], message: 'Select the rep who made this sale' });
      }
    });
type FormValues = z.infer<ReturnType<typeof makeSchema>>;

const finalCity = (v: Pick<FormValues, 'city_choice' | 'city_other'>): string =>
  v.city_choice === OTHER_CITY ? (v.city_other ?? '').trim() : v.city_choice;

/** Form defaults: blank for a new sale, the sale's values in edit mode (legacy province text resolved). */
function defaultsFor(sale: Sale | undefined, selfRepId: string | null): FormValues {
  if (!sale) {
    return {
      client_id: '',
      rep_id: '',
      sale_date: todayIso(),
      customer_first_name: '',
      customer_last_name: '',
      street: '',
      province_state: 'MB',
      city_choice: '',
      city_other: '',
      postal_code: '',
      mpu_id: '',
      is_greenfield: false,
      product_ids: [],
    };
  }
  const province = resolveRegion(sale.province_state) ?? '';
  const listed = isListedCity(province, sale.city);
  // Sales entered before the name split carry only the display name: split it for the form.
  const [first, ...rest] = sale.customer_name.split(' ');
  return {
    client_id: sale.client_id,
    rep_id: sale.rep_id === selfRepId ? SELF : sale.rep_id,
    sale_date: sale.sale_date.slice(0, 10),
    customer_first_name: sale.customer_first_name ?? first ?? '',
    customer_last_name: sale.customer_last_name ?? rest.join(' '),
    street: sale.street,
    province_state: province,
    city_choice: listed ? (cityOptions(province).find((o) => o.value.toLowerCase() === sale.city.toLowerCase())?.value ?? OTHER_CITY) : OTHER_CITY,
    city_other: listed ? '' : sale.city,
    postal_code: sale.postal_code,
    mpu_id: sale.mpu_id ?? '',
    is_greenfield: sale.is_greenfield,
    product_ids: sale.sale_items.map((i) => i.product_id),
  };
}

/** Only what changed, so an edit request lists real changes (the server re-diffs anyway). */
function changedFields(sale: Sale, v: FormValues): UpdateSaleBody {
  const body: UpdateSaleBody = {};
  const first = v.customer_first_name.trim();
  const last = v.customer_last_name.trim();
  if (first !== (sale.customer_first_name ?? '') || last !== (sale.customer_last_name ?? '')) {
    body.customer_first_name = first;
    body.customer_last_name = last;
    body.customer_name = `${first} ${last}`.trim();
  }
  if (v.street.trim() !== sale.street) body.street = v.street.trim();
  const city = finalCity(v);
  if (city !== sale.city) body.city = city;
  if (v.province_state !== sale.province_state) body.province_state = v.province_state;
  if (v.postal_code.trim() !== sale.postal_code) body.postal_code = v.postal_code.trim();
  if (!!v.is_greenfield !== sale.is_greenfield) body.is_greenfield = !!v.is_greenfield;
  const before = [...sale.sale_items.map((i) => i.product_id)].sort().join(',');
  const after = [...v.product_ids].sort().join(',');
  if (before !== after) body.items = v.product_ids.map((product_id) => ({ product_id }));
  return body;
}

export function SaleForm({ sale }: { sale?: Sale } = {}) {
  const editing = !!sale;
  const navigate = useNavigate();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const { isSuperAdmin, roles, repId } = useAuth();
  const canViewClients = useCan('clients:view');
  const canEditPerm = useCan('sales:edit');
  // Who may enter a sale on behalf of a rep (the server re-checks the scope). These users MUST pick one.
  const canPickRep = useCan('hrm:view') && (isSuperAdmin || roles.includes('Admin') || roles.includes('Manager'));
  const requireRep = canPickRep && !editing;

  const create = useCreateSale();
  const edit = useEditSale();
  const requestEdit = useRequestSaleEdit();
  const clients = useClients(canViewClients);
  const reps = useReps(canPickRep);
  const ownRep = useOwnRepCode(!canPickRep && !!repId && !editing);
  const productTypes = useProductTypes('all', canViewClients);

  const { control, register, handleSubmit, watch, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(makeSchema(requireRep)),
    defaultValues: defaultsFor(sale, repId),
  });
  const errors = formState.errors;
  // Leaving a half-entered sale asks first (the redirect after saving is allowed). 2026-11-12
  const leave = useUnsavedChangesGuard(formState.isDirty);

  const clientId = watch('client_id');
  const saleDate = watch('sale_date');
  const mpuId = watch('mpu_id');
  const province = watch('province_state');
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

  const repOptions = [
    ...(repId ? [{ value: SELF, label: 'Myself' }] : []),
    ...(reps.data ?? [])
      .filter((r) => r.id !== repId)
      .map((r) => ({ value: r.id, label: `${r.full_name} (${r.rep_code})` })),
  ];
  // In edit mode the rep is fixed: show who it is.
  const editRepLabel = sale ? `${sale.rep_name ?? '—'} (${sale.rep_external_code ?? sale.rep_code ?? '—'})` : '';

  const onSubmit = (values: FormValues) => {
    if (sale) {
      const body = changedFields(sale, values);
      if (Object.keys(body).length === 0) {
        toast({ title: 'Nothing to save', description: 'No field was changed.', tone: 'info' });
        return;
      }
      const done = (title: string) => {
        toast({ title, description: `Sale ID ${sale.sale_code}`, tone: 'success' });
        leave.allowLeave();
        navigate(`/sales/${sale.id}`);
      };
      if (canEditPerm) {
        edit.mutate({ id: sale.id, body }, { onSuccess: () => done('Sale updated'), onError });
      } else {
        requestEdit.mutate({ id: sale.id, body }, { onSuccess: () => done('Edit request sent to your admin'), onError });
      }
      return;
    }
    create.mutate(
      {
        client_id: values.client_id,
        rep_id: values.rep_id === SELF ? (repId ?? undefined) : values.rep_id || undefined,
        sale_date: values.sale_date,
        // The client bill prints the two names as separate columns; the server derives the display name.
        customer_name: `${values.customer_first_name} ${values.customer_last_name}`.trim(),
        customer_first_name: values.customer_first_name,
        customer_last_name: values.customer_last_name,
        street: values.street,
        city: finalCity(values),
        province_state: values.province_state,
        postal_code: values.postal_code,
        mpu_id: values.mpu_id || undefined,
        is_greenfield: values.is_greenfield || undefined,
        items: values.product_ids.map((product_id) => ({ product_id })),
      },
      {
        onSuccess: (created: Sale) => {
          toast({ title: 'Sale entered', description: `Sale ID ${created.sale_code}`, tone: 'success' });
          leave.allowLeave();
          navigate(`/sales/${created.id}`);
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

  const saving = create.isPending || edit.isPending || requestEdit.isPending;
  const submitLabel = !editing ? 'Enter sale' : canEditPerm ? 'Save changes' : 'Request edit';

  return (
    <Card>
      {leave.dialog}
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        {editing && !canEditPerm && (
          <Banner tone="info" title="Your changes go to your admin">
            Saving sends an edit request. The sale changes once a manager or admin approves it.
          </Banner>
        )}

        <div className={styles.grid}>
          <Controller
            control={control}
            name="client_id"
            render={({ field, fieldState }) => (
              <FormField
                label="Client"
                required
                error={fieldState.error?.message}
                help={editing ? 'The client cannot be changed. Delete and re-enter the sale instead.' : undefined}
              >
                <Select
                  placeholder="Select a client"
                  options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                  value={field.value || undefined}
                  disabled={editing}
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
                    label: joinDistinct([p.name, productTypeLabel(p.product_type)]),
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
          <Controller
            control={control}
            name="province_state"
            render={({ field, fieldState }) => (
              <FormField label="Province / State" required error={fieldState.error?.message}>
                <Select
                  placeholder="Select a province or state"
                  options={REGION_OPTIONS}
                  value={field.value || undefined}
                  onValueChange={(v) => {
                    field.onChange(v);
                    // A city belongs to its province: pick again for the new one.
                    setValue('city_choice', '', { shouldDirty: true });
                    setValue('city_other', '', { shouldDirty: true });
                  }}
                  aria-label="Province or state"
                />
              </FormField>
            )}
          />
          <Controller
            control={control}
            name="city_choice"
            render={({ field, fieldState }) => (
              <FormField
                label="City"
                required
                error={fieldState.error?.message ?? errors.city_other?.message}
                help={province ? undefined : 'Select a province first.'}
              >
                <SelectWithOther
                  options={cityOptions(province)}
                  otherValue={OTHER_CITY}
                  value={field.value || undefined}
                  otherText={watch('city_other') ?? ''}
                  placeholder="Select a city"
                  otherPlaceholder="City name"
                  disabled={!province}
                  invalid={!!fieldState.error || !!errors.city_other}
                  aria-label="City"
                  onChange={(next) => {
                    field.onChange(next.value);
                    setValue('city_other', next.other_text ?? '', { shouldDirty: true, shouldValidate: formState.isSubmitted });
                  }}
                />
              </FormField>
            )}
          />
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
                  disabled={editing}
                  aria-label="Sale date"
                />
              </FormField>
            )}
          />

          <FormField
            label="MPU ID"
            error={errors.mpu_id?.message}
            help={editing ? 'The MPU ID cannot be changed.' : 'Where the client supplies one.'}
          >
            <Input {...register('mpu_id')} placeholder="optional" disabled={editing} />
          </FormField>

          {/* The Rep / Agent field is always shown (2026-11-16). */}
          {editing ? (
            <FormField label="Rep / Agent ID" help="The rep cannot be changed.">
              <Input value={editRepLabel} readOnly disabled aria-label="Rep" />
            </FormField>
          ) : canPickRep ? (
            <Controller
              control={control}
              name="rep_id"
              render={({ field, fieldState }) => (
                <FormField label="Rep / Agent ID" required error={fieldState.error?.message} help="Who made this sale.">
                  <Select
                    placeholder="Select a rep"
                    options={repOptions}
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                    aria-label="Rep"
                  />
                </FormField>
              )}
            />
          ) : (
            <FormField label="Agent ID" help="Sales you enter are recorded under your own Agent ID.">
              <Input
                className="mono"
                value={ownRep.data ? `${ownRep.data.agentId}` : ownRep.isLoading ? 'Loading…' : '—'}
                readOnly
                aria-label="Agent ID"
              />
            </FormField>
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
            A sale must include an internet activation as its base. TV, Home Phone and other add-ons
            can&rsquo;t be sold on their own. Add an internet product to continue.
          </Banner>
        )}

        <div className={styles.footer}>
          <span className={styles.preview}>
            {editing ? 'Sale ID: ' : 'Sale ID preview: '}
            <span className="mono">{editing ? sale.sale_code : saleIdPreview || '—'}</span>
            {!editing && saleIdPreview && (
              <span className={styles.previewNote}> (a number is added if this ID is already taken)</span>
            )}
          </span>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              type="button"
              onClick={() => navigate(editing ? `/sales/${sale.id}` : '/sales')}
            >
              Cancel
            </Button>
            <Button leftIcon={<Save size={16} />} variant="primary" type="submit" loading={saving} disabled={missingBase}>
              {submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}
