/**
 * PreviewPanel — the DRY-RUN result. Shows what staging WOULD produce before a batch exists: the worksheet
 * chosen, the header row detected, how the columns mapped, any required field with no column, the grouped
 * blockers, and a handful of cleaned rows.
 *
 * This is presentation only — every value is the server's, computed by the SAME parse → map → clean →
 * classify path staging uses, so what is shown here is exactly what staging will do.
 */
import { Banner, Card, Select } from '../../../components/ui';
import { IssueGroupsBanner } from './IssueGroupsBanner';
import styles from './import.module.css';
import type { ImportPreview } from '../import.types';

interface Props {
  preview: ImportPreview;
  /** Re-run the dry run against a different worksheet. */
  onSheetChange: (sheet: string) => void;
  busy?: boolean;
}

export function PreviewPanel({ preview, onSheetChange, busy }: Props) {
  const mapped = Object.entries(preview.mapping);
  const unmappedHeaders = preview.headers.filter((h) => !Object.values(preview.mapping).includes(h));
  const blocked = preview.unmapped_required.length > 0 || preview.issue_groups.length > 0;

  const { clients, reps, products } = preview.will_create;
  const willCreateTotal = clients.length + reps.length + products.length;
  const willCreateSummary = [
    clients.length > 0 ? `${clients.length} client${clients.length === 1 ? '' : 's'}` : null,
    reps.length > 0 ? `${reps.length} rep${reps.length === 1 ? '' : 's'}` : null,
    products.length > 0 ? `${products.length} product${products.length === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Card title="Preview — nothing has been imported yet">
      <div className={styles.previewGrid}>
        <div className={styles.previewStat}>
          <span className={styles.previewStatLabel}>Rows found</span>
          <span className={styles.previewStatValue}>{preview.total_rows}</span>
        </div>
        <div className={styles.previewStat}>
          <span className={styles.previewStatLabel}>Would import</span>
          <span className={styles.previewStatValue}>{preview.counts.matched ?? 0}</span>
        </div>
        <div className={styles.previewStat}>
          <span className={styles.previewStatLabel}>Need attention</span>
          <span className={styles.previewStatValue}>{preview.total_rows - (preview.counts.matched ?? 0)}</span>
        </div>
        <div className={styles.previewStat}>
          <span className={styles.previewStatLabel}>Header row</span>
          <span className={styles.previewStatValue}>{preview.header_row}</span>
        </div>
      </div>

      {/* Only worth showing when the workbook actually has a choice to make. */}
      {preview.sheets.length > 1 && (
        <div className={styles.form}>
          <label className={styles.previewStatLabel} htmlFor="preview-sheet">
            Worksheet — picked automatically as the best match for this import type
          </label>
          <Select
            options={preview.sheets.map((s) => ({ value: s, label: s }))}
            value={preview.sheet ?? undefined}
            onValueChange={onSheetChange}
            disabled={busy}
          />
        </div>
      )}

      {preview.unmapped_required.length > 0 && (
        <Banner tone="danger" title="Some required columns weren’t found">
          No column matched: {preview.unmapped_required.map((f) => <code key={f}>{f}</code>).reduce((acc: React.ReactNode[], el, i) => (i === 0 ? [el] : [...acc, ', ', el]), [])}. Rename the
          column in your file to match the template, or pick a saved mapping.
        </Banner>
      )}

      {/* When the file uses one yes/no column per product type, say so — otherwise a row's products appear
          out of nowhere and the operator can't tell whether they were read correctly. */}
      {preview.product_type_columns.length > 0 && (
        <Banner tone="info" title="Products read from one column per type">
          This file marks each product type in its own column rather than listing them in one cell. A row's
          products are whatever its ticked columns say:
          <ul className={styles.issueGroupList}>
            {preview.product_type_columns.map((c) => (
              <li key={c.column}>
                <code>{c.column}</code> → <code>{c.key}</code>
              </li>
            ))}
          </ul>
        </Banner>
      )}

      {/* Creating master data is a real, visible act — never a silent side effect of an import. With the
          option ON this warns exactly what will come into existence; with it OFF it explains what turning
          it on would do, which beats leaving the operator to decode N identical error rows. */}
      {willCreateTotal > 0 && (
        <Banner
          tone={preview.create_missing ? 'warning' : 'info'}
          title={
            preview.create_missing
              ? `This import will CREATE ${willCreateSummary}`
              : `${willCreateSummary} referenced by this file don’t exist yet`
          }
        >
          {preview.create_missing ? (
            <>
              These records don’t exist yet and will be created when you stage and commit. They are created
              minimally — named after their own code, with <strong>no billing rate and no money of any kind</strong>
              {' '}— so review and complete them in Clients &amp; Products and HRM afterwards.
            </>
          ) : (
            <>
              Those rows will fail until these exist. Either import the master data first, or tick{' '}
              <strong>Create missing master data</strong> and preview again.
            </>
          )}
          <ul className={styles.issueGroupList}>
            {preview.will_create.clients.length > 0 && (
              <li>
                <strong>Clients ({preview.will_create.clients.length}):</strong> {preview.will_create.clients.join(', ')}
              </li>
            )}
            {preview.will_create.reps.length > 0 && (
              <li>
                <strong>Reps ({preview.will_create.reps.length}):</strong> {preview.will_create.reps.join(', ')}
              </li>
            )}
            {preview.will_create.products.length > 0 && (
              <li>
                <strong>Products ({preview.will_create.products.length}):</strong>{' '}
                {preview.will_create.products.map((p) => `${p.client_code} · ${p.product_type}`).join(', ')}
              </li>
            )}
          </ul>
        </Banner>
      )}

      <IssueGroupsBanner groups={preview.issue_groups} />

      {!blocked && (
        <Banner tone="success" title="Looks good">
          All {preview.total_rows} rows resolved cleanly. Staging will create the batch; you can still review
          it before committing.
        </Banner>
      )}

      <p className={styles.previewNote}>
        Reading <strong>{preview.sheet ?? 'the file'}</strong>, headers on row {preview.header_row}.{' '}
        {mapped.length} column{mapped.length === 1 ? '' : 's'} mapped
        {unmappedHeaders.length > 0 ? `; ignored: ${unmappedHeaders.join(', ')}` : ''}.
      </p>

      {preview.sample.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.previewTable}>
            <thead>
              <tr>
                <th>#</th>
                {mapped.map(([field]) => (
                  <th key={field}>{field}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((row) => (
                <tr key={row.row_number}>
                  <td className="mono">{row.row_number}</td>
                  {mapped.map(([field]) => (
                    <td key={field} className={styles.previewCell}>
                      {String((row.mapped_data as Record<string, unknown>)[field] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
