/**
 * ExportLayoutsPage — /admin/export-layouts. Which columns an exported report carries, in what order,
 * under what headings. A Redwave format change becomes a settings change rather than a dev ticket.
 *
 * The export analogue of the import templates screen. What a report may offer comes from the SERVER's
 * field registry, which is where invariant #3 is enforced: the payroll report simply has no client-rate
 * field to pick, and the statement has no rep-pay field. The picker cannot express the violation because
 * the fields are not there — and the server rejects one anyway if it somehow arrives (§5).
 *
 * A workbook with a live SUBTOTAL strip constrains the layout: money columns must stay contiguous and
 * required columns cannot be removed, because those formulas reference columns positionally. The screen
 * says so, and the server refuses a layout that breaks it with a named error rather than emitting a
 * workbook full of #REF!.
 *
 * Read `reports:view`; write `settings:edit`.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, RotateCcw, Save, X } from 'lucide-react';
import {
  Badge,
  Banner,
  Button,
  Card,
  IconButton,
  Input,
  PageHeader,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { isForbidden, useApiErrorToast } from '../../../lib/api/apiError';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { useExportLayouts, useExportRegistry, useSaveExportLayout } from '../api/useExportLayouts';
import type { ExportLayoutColumn, ExportRegistryEntry } from '../exportLayouts.types';
import styles from '../components/exportLayouts.module.css';

export default function ExportLayoutsPage() {
  const canView = useCan('reports:view');
  const canEdit = useCan('settings:edit');
  const { toast } = useToast();
  const onError = useApiErrorToast();

  const registry = useExportRegistry(canView);
  const saved = useExportLayouts(undefined, canView);
  const save = useSaveExportLayout();

  const [reportType, setReportType] = useState('payroll');
  const [name, setName] = useState('');
  const [columns, setColumns] = useState<ExportLayoutColumn[]>([]);

  const definition: ExportRegistryEntry | undefined = useMemo(
    () => (registry.data ?? []).find((r) => r.report_type === reportType),
    [registry.data, reportType],
  );

  // Start from the report's built-in default whenever the report changes — an empty editor would invite
  // building a layout from nothing and tripping the required-field rule immediately.
  useEffect(() => {
    if (definition) setColumns(definition.default_columns.map((c) => ({ ...c })));
  }, [definition]);

  if (!canView || isForbidden(registry.error)) return <AccessDenied />;

  const fieldsByKey = new Map((definition?.fields ?? []).map((f) => [f.key, f]));
  const chosen = new Set(columns.map((c) => c.field));
  const available = (definition?.fields ?? []).filter((f) => !chosen.has(f.key));

  const move = (index: number, delta: number) => {
    const next = [...columns];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setColumns(next);
  };

  const onSave = () =>
    save.mutate(
      { name: name.trim(), report_type: reportType, columns },
      {
        onSuccess: () => {
          toast({ title: 'Layout saved', tone: 'success' });
          setName('');
        },
        onError,
      },
    );

  return (
    <div className={styles.page}>
      <PageHeader
        title="Export layouts"
        subtitle="Choose which columns each exported report carries, in what order, under what headings."
      />

      <Banner tone="info" title="Some columns are load-bearing">
        A report marked <strong>fixed layout engine</strong> is a real workbook with live totals above the
        data. Its money columns must stay together and its required columns cannot be removed — otherwise
        the totals would sum the wrong cells. A layout that breaks that is refused, with the reason.
      </Banner>

      <Card title="Report">
        <div className={styles.controls}>
          <Select
            aria-label="Report type"
            value={reportType}
            onValueChange={setReportType}
            options={(registry.data ?? []).map((r) => ({ value: r.report_type, label: r.label }))}
          />
          {definition?.has_formula_strip && <Badge tone="warning">Fixed layout engine</Badge>}
        </div>
      </Card>

      <DataState
        isLoading={registry.isLoading}
        isError={registry.isError}
        isEmpty={!definition}
        onRetry={() => registry.refetch()}
        emptyNode={<p className={styles.note}>No report types available.</p>}
      >
        <div className={styles.split}>
          <Card
            title="Columns"
            actions={
              canEdit ? (
                <Button
                  variant="tertiary"
                  size="sm"
                  leftIcon={<RotateCcw size={14} />}
                  onClick={() => setColumns((definition?.default_columns ?? []).map((c) => ({ ...c })))}
                >
                  Reset to default
                </Button>
              ) : undefined
            }
          >
            <Table>
              <THead>
                <TR>
                  <TH>Field</TH>
                  <TH>Heading</TH>
                  <TH align="right">Order</TH>
                </TR>
              </THead>
              <TBody>
                {columns.map((c, i) => {
                  const field = fieldsByKey.get(c.field);
                  return (
                    <TR key={c.field}>
                      <TD>
                        {field?.label ?? c.field}{' '}
                        {field?.money && <Badge tone="neutral">money</Badge>}{' '}
                        {field?.required && <Badge tone="warning">required</Badge>}
                      </TD>
                      <TD>
                        <Input
                          aria-label={`Heading for ${field?.label ?? c.field}`}
                          value={c.header ?? ''}
                          placeholder={field?.label ?? c.field}
                          disabled={!canEdit}
                          onChange={(e) =>
                            setColumns(columns.map((x, xi) => (xi === i ? { ...x, header: e.target.value } : x)))
                          }
                        />
                      </TD>
                      <TD align="right">
                        <div className={styles.rowActions}>
                          <IconButton label="Move up" icon={<ArrowUp size={14} />} disabled={!canEdit || i === 0} onClick={() => move(i, -1)} />
                          <IconButton
                            label="Move down"
                            icon={<ArrowDown size={14} />}
                            disabled={!canEdit || i === columns.length - 1}
                            onClick={() => move(i, 1)}
                          />
                          <IconButton
                            label="Remove"
                            icon={<X size={14} />}
                            // A required column has no remove control at all — the server would refuse it,
                            // and offering an action that cannot succeed is worse than not offering it.
                            disabled={!canEdit || field?.required}
                            onClick={() => setColumns(columns.filter((_, xi) => xi !== i))}
                          />
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>

          <Card title="Available fields">
            {available.length === 0 ? (
              <p className={styles.note}>Every field is in the layout.</p>
            ) : (
              <ul className={styles.available}>
                {available.map((f) => (
                  <li key={f.key}>
                    <button
                      type="button"
                      className={styles.addButton}
                      disabled={!canEdit}
                      onClick={() => setColumns([...columns, { field: f.key, header: f.label }])}
                    >
                      + {f.label}
                    </button>
                    {f.money && <Badge tone="neutral">money</Badge>}
                  </li>
                ))}
              </ul>
            )}
            <p className={styles.note}>
              Only fields this report owns are listed. A payroll layout cannot reference a client rate, and
              a statement cannot reference rep pay — the two are kept apart by design.
            </p>
          </Card>
        </div>

        {canEdit && (
          <Card title="Save this layout">
            <div className={styles.controls}>
              <Input
                aria-label="Layout name"
                placeholder="e.g. Payroll — no address column"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                variant="primary"
                leftIcon={<Save size={16} />}
                loading={save.isPending}
                disabled={!name.trim() || columns.length === 0}
                onClick={onSave}
              >
                Save layout
              </Button>
            </div>
          </Card>
        )}

        <Card title="Saved layouts">
          <DataState
            isLoading={saved.isLoading}
            isError={saved.isError}
            isEmpty={(saved.data ?? []).length === 0}
            onRetry={() => saved.refetch()}
            emptyNode={
              <p className={styles.note}>
                No saved layouts — every report uses its built-in default.
              </p>
            }
          >
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Report</TH>
                  <TH align="right">Columns</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {(saved.data ?? []).map((l) => (
                  <TR key={l.id}>
                    <TD>{l.name}</TD>
                    <TD>{l.report_type}</TD>
                    <TD numeric>{l.columns.length}</TD>
                    <TD>{l.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </DataState>
        </Card>
      </DataState>
    </div>
  );
}
