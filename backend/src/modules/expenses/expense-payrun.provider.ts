/**
 * ExpensePayrunProvider — the REAL implementation of Pay Run's EXPENSE_TOTAL_PROVIDER seam.
 *
 * Sums the rep's APPROVED expense ITEMS for a pay period; Pay Run folds it into net. ITEM-FIRST: each
 * item's `pay_period_id` is derived from its OWN expense_date (EXP-009), so an approved item is paid in
 * the cycle of its date. This is a READ-ONLY seam — no finalize hook: the sum is period-scoped on the
 * item, and Pay Run's own finalize idempotency guarantees an approved item is paid exactly once.
 * — SRS §11 / arch §9 (composed, not coupled)
 */
import { Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { ExpenseTotalProvider } from '../payrun/seams/expense-total.provider';

@Injectable()
export class ExpensePayrunProvider implements ExpenseTotalProvider {
  constructor(private readonly prisma: PrismaService) {}

  async getApprovedExpenseTotal(repId: string, payPeriodId: string): Promise<Decimal> {
    const items = await this.prisma.expenseItem.findMany({
      // A personal (do-not-reimburse) item never reaches the pay run (#1 / EXP-012).
      where: { rep_id: repId, pay_period_id: payPeriodId, status: 'approved', is_personal: false },
      // Reimburse the FROZEN CAD value (#12): a foreign expense was converted at approval; CAD == amount.
      select: { amount_cad: true },
    });
    return items.reduce(
      (sum, i) => sum.plus(i.amount_cad ? new Decimal(i.amount_cad.toString()) : new Decimal(0)),
      new Decimal(0),
    );
  }
}
