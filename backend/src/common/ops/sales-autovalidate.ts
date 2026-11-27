/**
 * sales:auto-validate — the ONE-TIME backlog step for "no per-sale validation" (App Review Feedback,
 * 2026-11-28). From that change on, a clean sale is validated at submit; this validates the sales entered
 * BEFORE it that are still waiting for an admin tick. A sale flagged as a possible duplicate and not yet
 * approved is left `entered` for review, exactly as a new flagged sale would be.
 *
 * Writes only `status`/`validated_by`/`validated_at` (the same fields the normal validate writes) plus one
 * audit row per sale, in one transaction. It never touches `sale_date` (#7) or a snapshot (#2), and the
 * pay run is unchanged: it still claims validated sales by `sale_date` window (#8). Idempotent: a second run
 * finds nothing left to validate. Dry run unless `write`.
 */
import { PrismaClient } from '@prisma/client';

export interface AutoValidatePlan {
  /** Sale IDs (sale_code) that are, or would be, validated. */
  validate: string[];
  /** Held possible duplicates left for review. */
  held: string[];
  /** The Super Admin recorded as the validator and audit actor. */
  actorEmail: string | null;
}

export async function runSalesAutoValidate(
  prisma: PrismaClient,
  opts: { write: boolean; now?: Date },
): Promise<AutoValidatePlan> {
  const entered = await prisma.sale.findMany({
    where: { status: 'entered' },
    select: { id: true, sale_code: true, duplicate_of_sale_id: true, duplicate_approved_at: true },
    orderBy: { sale_date: 'asc' },
  });
  const isHeld = (s: (typeof entered)[number]) => !!s.duplicate_of_sale_id && !s.duplicate_approved_at;
  const toValidate = entered.filter((s) => !isHeld(s));
  const held = entered.filter(isHeld);

  const actor = await prisma.user.findFirst({
    where: { status: 'active', user_roles: { some: { role: { name: 'Super Admin' } } } },
    orderBy: { created_at: 'asc' },
    select: { id: true, email: true },
  });

  const plan: AutoValidatePlan = {
    validate: toValidate.map((s) => s.sale_code),
    held: held.map((s) => s.sale_code),
    actorEmail: actor?.email ?? null,
  };
  if (!opts.write || toValidate.length === 0) return plan;
  if (!actor) throw new Error('No active Super Admin found to record as the validator. Nothing was written.');

  const now = opts.now ?? new Date();
  const ids = toValidate.map((s) => s.id);
  await prisma.$transaction(
    async (tx) => {
      // Re-check the status inside the tx so a sale changed meanwhile is never overwritten.
      const res = await tx.sale.updateMany({
        where: { id: { in: ids }, status: 'entered' },
        data: { status: 'validated', validated_by: actor.id, validated_at: now },
      });
      if (res.count !== ids.length) {
        throw new Error(`Expected to validate ${ids.length} sales but ${res.count} were still entered. Nothing was written; re-run.`);
      }
      await tx.auditLog.createMany({
        data: ids.map((id) => ({
          user_id: actor.id,
          entity_type: 'sales',
          entity_id: id,
          action: 'validate',
          before_json: { status: 'entered' },
          after_json: { status: 'validated', source: 'sales:auto-validate backlog (2026-11-28)' },
        })),
      });
    },
    { timeout: 120_000 }, // §14 rule 11: a per-row tx needs an explicit timeout
  );
  return plan;
}
