/**
 * SaleEntryPage — wraps the SaleForm (RHF + zod) for the `/sales/new` route. The server authorizes the
 * create (sales:create) and resolves the rep scope; this page only renders the form. — SALE-001
 */
import { PageHeader } from '../../../components/ui';
import { SaleForm } from '../components/SaleForm';

export default function SaleEntryPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader
        title="Enter a sale"
        subtitle="Capture an activation. The composite Sale ID is generated on save."
      />
      <SaleForm />
    </div>
  );
}
