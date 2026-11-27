/**
 * Bulk-validation commit handler (client_report + sales). DRIVES the Sales module's exposed
 * `validateWithinTx` inside the import's transaction — it NEVER reimplements sale-state logic (#9).
 * The matched (or manually matched) `sale_id` is the row's `matched_entity_id`. — SRS SALE-007 / IMP-010
 */
import { Prisma } from '@prisma/client';
import { AuthUser } from '../../../common/rbac/auth-user.type';
import { SalesService } from '../../sales/sales.service';

export async function applyBulkValidation(
  tx: Prisma.TransactionClient,
  saleId: string,
  user: AuthUser,
  sales: SalesService,
): Promise<string> {
  // entered → validated, atomically within the batch transaction. Since 2026-11-28 most sales are validated
  // at submit, so the partner's report CONFIRMS them: an already-validated sale is a no-op, not a 409.
  // Throws (rolls the batch back) if the sale is missing or in any other state.
  const current = await tx.sale.findUnique({ where: { id: saleId }, select: { status: true } });
  if (current?.status === 'validated') return saleId;
  await sales.validateWithinTx(tx, saleId, {}, user);
  return saleId;
}
