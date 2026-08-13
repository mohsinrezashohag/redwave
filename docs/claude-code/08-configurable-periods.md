# Packet 08 — Admin-configurable billing and pay cycles

## Goal
Let a Super-Admin/Admin define the period calendars instead of having them fixed in seed code.

## Why
Both calendars are generated at seed time:
- `backend/src/modules/payrun/pay-periods.seed-data.ts` — Sun–Sat, 14 days, payday = close + 13
- `backend/src/modules/billing/billing-periods.seed-data.ts` — Mon–Sun, weekly, sequential bill number

Redwave wants control of this, including the one-day boundary offset between the two.

## What to build
- A `period_configs` table + dated migration:
  - **pay** — anchor date, length in days, payday offset
  - **billing** — anchor date, length in days
- Regeneration of future periods from the config.
- Admin screen per the §13.2 playbook, Super-Admin/Admin gated.
- Surface the resulting overlap: show which billing weeks map into which pay period, so the boundary
  offset is visible rather than discovered later.

## ⚠ Forward-only — the constraint that makes this safe

Finalized pay runs and issued statements are immutable and gapless-numbered (#2, #8).
The config **must refuse** to alter any period that has:
- a finalized pay run, or
- an issued statement or invoice

Changing a period boundary under a frozen document silently corrupts the money trail — nothing throws,
the numbers just stop reconciling. Enforce this at the **service layer**, not with a UI warning, and
return a clear 422 naming the blocking document.

Regeneration therefore only ever creates or edits **future** periods. Say this in the UI too.

## Invariants at risk
**#2** immutable snapshots · **#7** `sale_date` derives the period — check `resolvePayPeriod` still
resolves correctly after a config change, including for sales already recorded · **#8** finalize is
atomic and idempotent · **#10** config is effective-dated, never rewrites a closed period.

## Definition of done
- Changing the pay cycle to weekly regenerates future periods only.
- Attempting to alter a period with a finalized run returns 422 naming the run.
- Existing sales still resolve to the correct period after a change — assert with a spec covering a
  sale whose `sale_date` falls near a moved boundary.
- The billing↔pay overlap is visible in the UI.

## Do NOT
- Do not delete and regenerate all periods. Existing rows are referenced by finalized runs and issued
  documents.
