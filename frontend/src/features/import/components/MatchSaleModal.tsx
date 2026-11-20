/**
 * MatchSaleModal — for a bulk-validation row, pick the ENTERED sale it maps to (reconcile `match`). Reuses
 * the Sales API (entered sales for the batch's client); the UI never runs the matcher — it sends the chosen
 * sale id and the backend records the match. Tokens only.
 */
import { Link2 } from 'lucide-react';
import { useState } from 'react';
import { Banner, Button, Input, Modal, useToast } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { displayDate } from '../../../lib/format/date';
import { useSalesQuery } from '../../sales/api/useSales';
import { useReconcile } from '../api/useImportMutations';
import styles from './import.module.css';
import type { ImportRow } from '../import.types';

export function MatchSaleModal({ batchId, row, clientId, onClose }: { batchId: string; row: ImportRow | null; clientId: string | null; onClose: () => void }) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const canViewSales = useCan('sales:view');
  const reconcile = useReconcile();
  const [text, setText] = useState('');

  const open = row !== null;
  const q = useSalesQuery({ status: 'entered', client_id: clientId ?? undefined });
  const rowMpu = row?.mapped_data?.mpu_id ?? row?.raw_data?.mpu_id;

  const t = text.trim().toLowerCase();
  const sales = (q.data ?? []).filter((s) => {
    if (!t) return true;
    return s.sale_code.toLowerCase().includes(t) || s.customer_name.toLowerCase().includes(t) || (s.mpu_id ?? '').toLowerCase().includes(t);
  });

  const onMatch = (saleId: string) => {
    if (!row) return;
    reconcile.mutate(
      { id: batchId, body: { resolutions: [{ row_id: row.id, action: 'match', matched_entity_id: saleId }] } },
      { onSuccess: () => { toast({ title: 'Row matched', tone: 'success' }); setText(''); onClose(); }, onError },
    );
  };

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o && !reconcile.isPending) { setText(''); onClose(); } }} title={row ? `Match row ${row.row_number} to a sale` : 'Match a sale'} size="lg">
      {open && (
        <div className={styles.form}>
          {rowMpu ? <p className={styles.note}>This row's MPU ID: <strong className="mono">{String(rowMpu)}</strong>. Pick the entered sale it belongs to.</p> : <p className={styles.note}>Pick the entered sale this row belongs to.</p>}
          {!canViewSales ? (
            <Banner tone="warning" title="Sales view required">Finding a sale needs the sales view permission.</Banner>
          ) : (
            <>
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by Sale ID / customer / MPU" aria-label="Search sales" />
              <DataState isLoading={q.isLoading} isError={q.isError} isEmpty={sales.length === 0} onRetry={() => q.refetch()} emptyNode={<p className="mono">No entered sales for this client.</p>}>
                <div className={styles.finderList}>
                  {sales.map((s) => (
                    <div key={s.id} className={styles.finderRow}>
                      <span>
                        <span className="mono">{s.sale_code}</span> · {s.customer_name}
                        {s.mpu_id ? <> · MPU <span className="mono">{s.mpu_id}</span></> : ''} · <span className={styles.note}>{displayDate(s.sale_date)}</span>
                      </span>
                      <Button leftIcon={<Link2 size={16} />} variant="secondary" size="sm" loading={reconcile.isPending} disabled={reconcile.isPending} onClick={() => onMatch(s.id)}>
                        Match
                      </Button>
                    </div>
                  ))}
                </div>
              </DataState>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
