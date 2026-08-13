/**
 * Back-dated km-rate commit handler (master_migration + km_rates). Writes `km_rate_config` rows DIRECTLY
 * via the transaction — the sanctioned #10 migration path, which deliberately bypasses `KmRateService`'s
 * back-date rejection (422). That guard stays exactly as it is: this adds a second, AUDITED way in (every
 * row is an `import_rows` record on a committed `import_batches`), it does not relax the first.
 *
 * Both streams (`rep` = what the rep is reimbursed, `client_bill` = what the client is charged) load
 * through here, and they stay separate rows on separate scopes — nothing joins them (#3). A blank
 * `client_code` is the GLOBAL row a client without its own falls back to. Rates are inserted VERBATIM: the
 * import is the authoritative historical record, so no supersession is planned and no existing row is
 * bounded — the file states what was in force, and `selectEffectiveRate` reads it back by date.
 *
 * Money/rates are exact decimal STRINGS → Prisma Decimal, never parseFloat (#1).
 * — docs/claude-code/04-backdate-import.md, CLAUDE §3 #10, SRS EXP-004
 */
import { KmRateStream, Prisma } from '@prisma/client';
import { DomainError } from '../../../common/errors/domain-error';
import { dateOnly } from '../../../common/effective-dating';
import { normCode } from '../clean.logic';
import { RawRow } from '../mapping.logic';

export async function applyKmRate(
  tx: Prisma.TransactionClient,
  mapped: RawRow,
  createdBy: string,
): Promise<string> {
  const code = normCode(mapped.client_code);
  let clientId: string | null = null;
  if (code) {
    const client = await tx.client.findUnique({ where: { client_code: code }, select: { id: true } });
    if (!client) throw new DomainError('IMPORT_CLIENT_NOT_FOUND', `client ${code} not found`);
    clientId = client.id;
  }

  const row = await tx.kmRateConfig.create({
    data: {
      client_id: clientId, // null = the global default scope
      stream: String(mapped.stream) as KmRateStream,
      rate_per_km: String(mapped.rate_per_km), // decimal string → Prisma Decimal (never float, #1)
      effective_from: dateOnly(String(mapped.effective_from)), // back-dated allowed here (#10)
      effective_to: mapped.effective_to ? dateOnly(String(mapped.effective_to)) : null,
      created_by: createdBy,
    },
  });
  return row.id;
}
