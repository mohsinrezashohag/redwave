/**
 * SaleEntryPage — wraps the SaleForm (RHF + zod) for the `/sales/new` route. The server authorizes the
 * create (sales:create) and resolves the rep scope; this page only renders the form. — SALE-001
 * Without sales:create the page says so up front, instead of a 403 after the whole form is filled.
 */
import { PageHeader } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { AccessDenied } from '../../dashboards/components/AccessDenied';
import { SaleForm } from '../components/SaleForm';

export default function SaleEntryPage() {
  const canCreate = useCan('sales:create');
  if (!canCreate) {
    return <AccessDenied message="Entering sales requires the sales create permission." />;
  }
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
