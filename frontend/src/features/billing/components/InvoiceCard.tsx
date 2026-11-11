/**
 * InvoiceCard — the one-line commission invoice for a client+period. `total_commission` is the BILLING-STREAM
 * statement total (server-computed; #3) — NOT the rep payout. Shows the gapless number + status; Download
 * re-renders the PDF from the frozen record (billing:view). If no invoice exists yet, offer to generate it.
 * CAD, no GST. Tokens only.
 */
import { FileDown, Receipt } from 'lucide-react';
import { Badge, Button, Card } from '../../../components/ui';
import { money } from '../../../lib/format/money';
import { invoiceNo } from '../billing.logic';
import styles from './billing.module.css';
import type { ClientInvoice } from '../billing.types';

interface Props {
  invoice: ClientInvoice | null;
  canView: boolean;
  onDownload: () => void;
  downloading?: boolean;
  onGenerate?: () => void;
  canGenerate?: boolean;
}

export function InvoiceCard({ invoice, canView, onDownload, downloading, onGenerate, canGenerate }: Props) {
  return (
    <Card
      title={
        invoice ? (
          <span>
            Commission invoice · <span className="mono">{invoiceNo(invoice.invoice_number)}</span>{' '}
            <Badge tone={invoice.status === 'issued' ? 'success' : 'neutral'}>{invoice.status}</Badge>
          </span>
        ) : (
          'Commission invoice'
        )
      }
      actions={
        invoice && canView ? (
          <Button variant="secondary" size="sm" leftIcon={<FileDown size={15} />} loading={downloading} onClick={onDownload}>
            Download PDF
          </Button>
        ) : undefined
      }
    >
      {invoice ? (
        <div className={styles.invoiceTotal}>
          <span className={styles.invoiceAmount}>{money(invoice.total_commission)}</span>
          <span className={styles.note}>One-line total in CAD: the statement total billed to the client, not the rep payout. No GST.</span>
        </div>
      ) : (
        <div className={styles.invoiceTotal}>
          <span className={styles.note}>No invoice has been generated for this period yet.</span>
          {canGenerate && onGenerate && (
            <Button variant="secondary" size="sm" leftIcon={<Receipt size={15} />} onClick={onGenerate}>
              Generate
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
