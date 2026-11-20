/**
 * Clawback seam — the input boundary for "flat clawback deductions for a rep + pay period".
 *
 * Pay Run reads `getClawbackTotal` (folded into net) and, at finalize, calls `markApplied` INSIDE its
 * transaction to atomically flip the rep's pending clawbacks to applied + link the run — so a clawback
 * is never deducted twice. The default `ZeroClawbackTotalProvider` (no Clawback module) returns 0 and
 * no-ops `markApplied`. Since 2026-11-16 ("Remove clawbacks") the Clawback module binds THIS zero provider, so
 * commission reports apply no clawback deduction. `payPeriodId` is null for a date-range report. — CLAUDE §3 #6
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';

export const CLAWBACK_TOTAL_PROVIDER = Symbol('CLAWBACK_TOTAL_PROVIDER');

export interface ClawbackTotalProvider {
  /** Flat clawback deduction total to apply to this rep now (exact decimal). */
  getClawbackTotal(repId: string, payPeriodId: string | null): Promise<Decimal>;

  /**
   * Mark the rep's pending clawbacks applied + linked to the pay run. Runs in finalize's transaction
   * (atomic with the run) so the deduction is recorded exactly once. — SRS CLAW-006/008
   */
  markApplied(
    repId: string,
    payPeriodId: string | null,
    payRunId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void>;
}

@Injectable()
export class ZeroClawbackTotalProvider implements ClawbackTotalProvider {
  async getClawbackTotal(): Promise<Decimal> {
    return new Decimal(0);
  }

  async markApplied(): Promise<void> {
    // no-op until the Clawback module re-binds this token
  }
}
