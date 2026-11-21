/**
 * NewReportForm — "New report": a sale-date range (from / to), an optional client and rep, and an optional
 * name. Generate creates a DRAFT on the server (nothing frozen) and the caller routes to it.
 * react-hook-form + zod; the UI sends only the window, the server prices every line (#1/#7).
 */
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FilePlus2 } from 'lucide-react';
import { Button, Card, DatePicker, FormField, Input, Select } from '../../../components/ui';
import { useReportClients, useReportReps } from '../api/usePayRun';
import { ALL, NEW_REPORT_DEFAULTS, newReportSchema, type NewReportValues } from '../report.logic';
import styles from './payrun.module.css';

interface Props {
  submitting: boolean;
  onGenerate: (values: NewReportValues) => void;
}

export function NewReportForm({ submitting, onGenerate }: Props) {
  const clients = useReportClients();
  const reps = useReportReps();
  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<NewReportValues>({ resolver: zodResolver(newReportSchema), defaultValues: NEW_REPORT_DEFAULTS });

  const from = watch('date_from');
  const clientOptions = [
    { value: ALL, label: 'All clients' },
    ...(clients.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.code})` })),
  ];
  const repOptions = [
    { value: ALL, label: 'All reps' },
    ...(reps.data ?? []).map((r) => ({ value: r.id, label: `${r.name} (${r.code})` })),
  ];

  return (
    <Card title="New report">
      <form className={styles.reportForm} onSubmit={handleSubmit(onGenerate)} noValidate>
        <div className={styles.reportGrid}>
          <Controller
            control={control}
            name="date_from"
            render={({ field }) => (
              <FormField label="From (sale date)" required error={errors.date_from?.message}>
                <DatePicker value={field.value} onChange={field.onChange} onBlur={field.onBlur} invalid={!!errors.date_from} />
              </FormField>
            )}
          />
          <Controller
            control={control}
            name="date_to"
            render={({ field }) => (
              <FormField label="To (sale date)" required error={errors.date_to?.message}>
                <DatePicker
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  min={from || undefined}
                  invalid={!!errors.date_to}
                />
              </FormField>
            )}
          />
          <Controller
            control={control}
            name="client_id"
            render={({ field }) => (
              <FormField
                label="Client"
                help={clients.isError ? 'Clients could not be loaded. The report covers all clients.' : undefined}
              >
                <Select options={clientOptions} value={field.value} onValueChange={field.onChange} aria-label="Client" />
              </FormField>
            )}
          />
          <Controller
            control={control}
            name="rep_id"
            render={({ field }) => (
              <FormField
                label="Rep or seller"
                help={reps.isError ? 'Reps could not be loaded. The report covers all reps.' : undefined}
              >
                <Select options={repOptions} value={field.value} onValueChange={field.onChange} aria-label="Rep or seller" />
              </FormField>
            )}
          />
          <FormField label="Name (optional)" error={errors.label?.message}>
            <Input placeholder="For example, November first half" defaultValue="" {...register('label')} />
          </FormField>
        </div>
        <div className={styles.reportActions}>
          <p className={styles.footnote}>
            Covers validated sales whose sale date is in the range. Nothing is paid until you mark the report as paid.
          </p>
          <Button type="submit" variant="primary" leftIcon={<FilePlus2 size={16} />} loading={submitting} disabled={submitting}>
            Generate report
          </Button>
        </div>
      </form>
    </Card>
  );
}
