/**
 * The authoritative Sale lifecycle state machine — pure, deterministic. — SRS §16, SALE-004
 *
 * The full transition table lives HERE (single source of truth). This module triggers
 * create→entered, validate (entered→validated), and delete (entered|validated→deleted); the
 * transitions into in_pay_run / paid / clawed_back are triggered by Pay Run / Clawback later.
 * Any transition not listed is invalid and rejected with 409.
 */
import { ConflictException } from '@nestjs/common';
import { SaleStatus } from '@prisma/client';

export const SALE_TRANSITIONS: Record<SaleStatus, SaleStatus[]> = {
  entered: ['validated', 'deleted'],
  validated: ['in_pay_run', 'deleted'],
  in_pay_run: ['paid'],
  paid: ['clawed_back'],
  clawed_back: [], // terminal (items may be clawed back independently)
  deleted: [], // terminal
  historical: [], // terminal — reference-only; set ONLY at import, never transitions in or out
};

export function canTransition(from: SaleStatus, to: SaleStatus): boolean {
  return SALE_TRANSITIONS[from].includes(to);
}

/** Throw 409 if the transition is not allowed by §16. */
export function assertTransition(from: SaleStatus, to: SaleStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(`invalid sale transition: ${from} -> ${to}`);
  }
}
