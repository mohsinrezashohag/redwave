# Packet 04 — Back-date import handlers for KM rates and commission config

## Goal
Extend the sanctioned back-dating path to the two config types that lack it.

## Why
`effective-dates.util.ts` rejects a past `effective_from` with 422 across tier schedules, flat rates,
product types, holdback config, KM rates and billing rates. That guard is correct — it protects closed
periods (#10).

But **client billing rates already have a back-door**: `backend/src/modules/import/handlers/billing-rate.handler.ts`,
described in its own header as *"the sanctioned #10 migration path, which deliberately bypasses"* the guard.

**KM rates and rep commission config have no such path.** This is what broke Siam's UAT — he set the KM
rate mid-week, and every expense before that date became unpriceable. On go-live the same applies to
every historical rate.

## Read first
- `backend/src/modules/import/handlers/billing-rate.handler.ts` — the pattern to copy, exactly.
- `backend/src/modules/commission/effective-dates.util.ts` — the guard. **Do not modify it.**
- `backend/src/modules/expenses/km-rate.service.ts`
- `frontend/src/features/import/templates.ts`

## What to build

**Two new import handlers**, mirroring `billing-rate.handler.ts`:

1. **`km-rate.handler.ts`** — both streams (`rep`, `client_bill`), optional `client_id` scope.
2. **`commission-config.handler.ts`** — tier schedules, flat rates, product types.

Each one:
- writes directly in the import transaction, bypassing the service-layer guard, as the billing-rate handler does
- carries the same explanatory header comment naming #10 and why the bypass is sanctioned
- records the `ImportBatch` audit trail like every other handler
- gets a matching template in `templates.ts` with columns, two example rows, and a data dictionary

## Invariants at risk
- **#10** — the UI guard stays. This adds a second **audited** path, it does not relax the first.
- **#3** — commission config is the rep stream. Do not let this handler touch `client_billing_rates`.
- **#1** — rates arrive as strings; parse to `Decimal`, never `parseFloat`.

## Definition of done
- A back-dated KM rate imports successfully and prices an expense that predates today.
- A back-dated tier schedule imports and the engine picks it up for a historical `sale_date`.
- The **UI still returns 422** for a back-dated create. Assert this in a spec so nobody "fixes" it later.
- Both handlers appear in the import UI with downloadable templates.

## Do NOT
- Do not add a Super-Admin UI override. One sanctioned path, one audit trail. Two paths means the
  next person has to guess which one is authoritative.
