# Packet 06 — Bulk statement generation

## Goal
Generate every client's statement for a billing period in one action.

## Why
`backend/src/modules/billing/billing-generation.controller.ts` exposes only
`POST /v1/clients/:id/statements` — one client at a time. Siam hit this in UAT and generated
them manually.

## Read first
- `backend/src/modules/billing/billing-generation.controller.ts`
- `backend/src/modules/billing/statement.service.ts` — note the `422` with an `unpriced[]` payload.

## What to build
- `POST /v1/billing-periods/{id}/statements:generate-all`, RBAC-gated.
- **Per-client transaction.** One client's failure must not roll back or abort the others.
- Response summarises: generated, skipped (already issued), failed — and for each failure, the
  existing `unpriced[]` detail so it stays actionable.
- Frontend: an action on the billing period screen with a result summary listing the failures
  and linking each to the rate screen that fixes it, the way `MissingKmRateBanner` already does.

## Invariants at risk
- **#2 / #12** — each statement freezes its own FX at issue. Batch issue must freeze **per document**,
  not once for the batch.
- Document numbering stays gapless and sequential. Concurrency here is the risk: generating twenty
  statements must not race the numbering. Test it.

## Definition of done
- One action issues all statements for a period.
- One client with an unpriced product fails alone; the rest still issue.
- Re-running is safe — already-issued clients are skipped, not duplicated or renumbered.
- A concurrency spec asserts no duplicate or skipped document numbers.
