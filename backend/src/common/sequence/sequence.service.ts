/**
 * SequenceService — gapless, sequential document numbers (statements, invoices). The counter increment runs
 * INSIDE the caller's `$transaction`, so Postgres row-locks `document_sequences` for that key: concurrent
 * issuers serialize and numbers are gapless — a number is consumed only when its issue transaction commits.
 * — BRD §8 (gapless numbering)
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type SequenceKey = 'statement' | 'invoice' | 'client_expense';

@Injectable()
export class SequenceService {
  /**
   * Mint the next number for `key`. MUST be called with the transaction client of the SAME `$transaction`
   * that creates the document, so the row lock is held until the document is committed (gapless).
   */
  async next(tx: Prisma.TransactionClient, key: SequenceKey): Promise<number> {
    const row = await tx.documentSequence.update({
      where: { key },
      data: { current_value: { increment: 1 } },
      select: { current_value: true },
    });
    return row.current_value;
  }
}
