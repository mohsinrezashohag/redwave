/**
 * wipeTransactional — clears ALL transactional data in FK-safe (child → parent) order, KEEPING the master
 * catalogue (RBAC, roles, users, reps, clients, products, billing rates, commission config, pay periods,
 * expense/notification configs, chatbot_config, incentives, import field mappings).
 *
 * The schema has NO `onDelete` cascades — the DB RESTRICTs hard deletes — so this explicit order is the
 * only safe way to wipe. Shared by the demo seed (reproducibility) and the `seed:reset` clean-wipe. Run in
 * one transaction so a constraint failure rolls the whole thing back. — CLAUDE §11
 */
import { PrismaClient } from '@prisma/client';

export async function wipeTransactional(prisma: PrismaClient): Promise<void> {
  // Ordered so every child is deleted before the parent it references (notably: clawbacks/sale_items/
  // statement_lines before sales; sales + holdback + lines before pay_runs).
  await prisma.$transaction([
    prisma.chatbotMessage.deleteMany(),
    prisma.chatbotConversation.deleteMany(),
    prisma.documentSignature.deleteMany(),
    prisma.signatureRequest.deleteMany(),
    prisma.document.deleteMany(),
    prisma.expenseKmStop.deleteMany(),
    prisma.expenseKmLog.deleteMany(),
    prisma.expenseItem.deleteMany(),
    prisma.expenseReport.deleteMany(),
    prisma.expenseExport.deleteMany(),
    prisma.clientStatementLine.deleteMany(),
    prisma.clientStatement.deleteMany(),
    prisma.clientInvoice.deleteMany(),
    prisma.clawback.deleteMany(), // refs sale_item + sale + pay_run
    prisma.saleItem.deleteMany(), // refs sale
    prisma.holdbackLedger.deleteMany(), // refs pay_run
    prisma.payRunLine.deleteMany(), // refs pay_run
    prisma.sale.deleteMany(), // refs pay_run (pay_run_id)
    prisma.payRun.deleteMany(),
    prisma.importRow.deleteMany(),
    prisma.importBatch.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.salesTarget.deleteMany(),
    prisma.profileChangeRequest.deleteMany(),
    prisma.auditLog.deleteMany(),
  ]);
}
