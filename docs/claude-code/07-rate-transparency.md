# Packet 07 — Per-sale margin and applied-rate visibility

**Depends on packet 01.** Meaningless against placeholder rates.

## Goal
Two related reads:
1. **Per-sale margin** — the client rate and the rep rate on the same row, with the spread.
2. **Applied-rate view** — which client rate and which rep rate were in force for a given period.

## Why
The spread *is* Redwave's earning. Client 350 vs rep 125 on the same internet sale. Today that number
exists nowhere: not a column, not a screen. `dashboards.service.ts` has `net_margin`, but it is a
**cash** margin — `revenue − net_payout`, where `net_payout` already nets expenses, bonuses, released
holdback and clawbacks. With the 30% holdback, what is paid in a period is not what was earned in it.
Useful, but not per-sale product margin.

## ⚠ This packet deliberately crosses invariant #3 — read this before anything else

`schema.prisma` says it outright:

> `// no path from here to client_billing_rates; the two rate streams stay separate (#3).`

That separation is the fix for the previous system's core defect. A margin view has to join exactly
those two things. That is legitimate **only** under these conditions:

- **Read-only, and only in `backend/src/modules/reporting/`.** No margin code in `billing/`, `payrun/`,
  `engine/` or `commission/`.
- **No Prisma relation is added** between the two streams. None. Query each separately and join in
  memory or in a dedicated read model. Adding a relation "to make the query cleaner" silently removes
  the guard the entire system rests on, and nothing will fail loudly when it does.
- **Never feeds pricing.** No margin value may become an input to a rate, a commission, or a document.
- Put a comment at the join site naming #3 and explaining why this one read is sanctioned, so the next
  person does not treat it as precedent.

## What to build
- A reporting read model: per sale — client rate, rep rate, margin, margin %. Grouped roll-ups by
  product, client and period.
- A rates-in-force view for a period: client rate and rep rate side by side, with effective dates.
- Frontend screens per the §13.2 playbook. Export via the shared `ExportMenu`.
- RBAC: margin is commercially sensitive. Gate it away from rep-facing roles entirely.

## Invariants at risk
**#3** — see above, this is the whole risk · **#2** — read frozen snapshots for the rep side, not
live rates · **#12** — compare in CAD using stored `amount_cad`; never re-convert.

## Definition of done
- Per-sale margin is correct for a mixed VF + RF week, verified by hand against the two workbooks.
- `grep -rn "client_billing_rates" backend/src/` shows references **only** in `billing/`, `clients/`,
  `import/` and the new `reporting/` read model.
- No new relation between the streams in `schema.prisma`. Check the diff specifically for this.
- A rep-role token gets 403.

## Note for Redwave
Margin per period will never reconcile exactly. A pay period closes Saturday; its second billing week
closes the following Sunday. One day of revenue always lands outside the matching payout window. This
is inherent to the two calendars, not a bug — surface it in the UI rather than letting someone chase it.
