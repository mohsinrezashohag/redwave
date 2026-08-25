# Packet 02 — Payroll report in Redwave's Excel format

## Goal
A per-sale payroll export matching Redwave's own sheet, plus two columns they asked to add.
This is the largest confirmed gap from Meeting 4 — nothing exists for it today.

## Prerequisite — do this first
`SaleResponse` exposes only `rep_id`, and `saleExport.ts` has **no Agent columns at all**. Add the
rep (code + name) to `SALE_INCLUDE` and the response DTO before starting, or this packet rebuilds
the same plumbing. — `system-audit.md` §2.3

## Read first
- `docs/claude-code/system-audit.md` §1.1 — the workbook is parsed there cell-by-cell, including
  every formula. Read it before opening the file itself.
- `docs/uat/Payroll report.xlsx` — the target. Header on **row 2**, `SUBTOTAL` strip on row 1.
- `docs/uat/billing-target-format.md` — the analogous doc for the billing side. Write the payroll equivalent.
- The billing trio, which is the pattern to mirror:
  - `backend/src/modules/billing/statement.logic.ts` (pure aggregation)
  - `client_statement_lines` in `backend/prisma/schema.prisma` (frozen wide line)
  - `backend/src/modules/billing/renderers/statement-excel.renderer.ts`

## Target columns — 18

```
Sale Date | Agent ID | Agent (Normalized) | Customer | Address | Channel | Product |
Internet | TV | Home Phone | Internet Rate | TV Rate | HP Rate |
Greenfield | Spiff | Total 100% | 0.7 | 0.3
```

`Greenfield` and `Spiff` are **additions** to Redwave's sheet, confirmed in the meeting.
Everything else must match their file exactly, including header row position.

**Verified against the workbook** (16 columns A–P; the 18 above are those plus the two additions):

- `Agent ID` is `reps.external_code` (`Redwave11`), not the internal `rep_code` (`RW-D-0001`).
  **Confirmed** — both of the client's workbooks use `RedwaveNN`. Note the shipped *client
  statement* currently prints `rep_code` here and is being corrected separately (`system-audit.md`
  §2.1); `docs/uat/billing-target-format.md` documents it wrongly. Do not copy that pattern.
- **The row-1 strip is `SUBTOTAL(9,…)` on the three money columns ONLY** (`Total 100 %`, `0.7`,
  `0.3`). Unlike the billing sheet, it carries **no `COUNTIF`** on the Internet/TV/HP flag columns.
  Do not mirror the statement renderer's strip verbatim.
- **`Customer` is ONE column**, holding a first name only in the sample ("Tim", "Kevin"). It is
  **not** split into first/last the way the client statement is. `Address` is likewise one string.
- Their `Internet Rate` is typed by hand and inconsistent — `125` literally in one row, a
  `=IF(G9="…",145,…)` formula in another. Those are Schedule C v2 Tier 3 and Tier 2. TV and HP are
  `=IF(flag,30,0)`, matching the Schedule C flat rates. **They are retyping what the engine
  computes** — which is the point of this packet, and why per-row rate equality with their sheet is
  not a valid test.

## What to build

Mirror the billing trio exactly:

1. **`backend/src/modules/payrun/payroll-report.logic.ts`** — pure, no Prisma. Row assembly and totals.
2. **`payroll_report_lines`** — a new frozen wide-line table + dated migration, same shape rationale
   as `client_statement_lines`. Written at pay-run finalize.
3. **`backend/src/modules/payrun/renderers/payroll-excel.renderer.ts`** — the workbook.
4. **Endpoints** — preview + export under `/v1/pay-runs/{id}/payroll-report`. RBAC-gated.
5. **Frontend** — export action on the Pay Run detail page. Reuse `frontend/src/lib/export/exportFilename.ts`
   and the shared `ExportMenu`. Do not build a new export mechanism.

## Rates — read this twice
- **Rep stream only.** There must be **no code path from this renderer to `client_billing_rates`** (#3).
  Client rate 350 vs rep rate 125 for the same sale is the entire business model; mixing them is the
  defect the previous system had.
- Internet is **tiered** (Schedule C), not the flat 125 in their sheet — that was a simplification on
  their side. Greenfield is **flat-rated and excluded from the tally** (#9).
- Read money from the **frozen snapshot** `sale_items.rate_applied` / `commission_paid` (#2).
  Never recompute at render time. Rows are therefore empty until the pay run finalizes — that is correct
  and matches how the sales export already behaves. Say so in the UI rather than faking a number.

## Invariants at risk
**#1** decimal strings · **#2** never recompute a frozen snapshot · **#3** never join the rate streams ·
**#5** never re-tier · **#9** greenfield flat and out of the tally.

## Definition of done
- Export matches `docs/uat/Payroll report.xlsx` column-for-column, header row 2, SUBTOTAL strip row 1.
- A spec fixture asserts totals for a known pay run, in the style of `uat-sales-file.spec.ts`.
- `grep -r "client_billing_rates" backend/src/modules/payrun/` returns **nothing**.
- `docs/uat/payroll-target-format.md` written, mirroring the billing one.

## Do NOT
- Do not extend `frontend/src/features/reports/exportDefs.ts`. That is the generic per-rep summary
  and is a different artifact — leave it alone.
- Do not add a Prisma relation between the payroll line and any client-billing table.
