# Payroll report — target format

The payroll equivalent of `billing-target-format.md`. It records what Redwave's own
`docs/uat/Payroll report.xlsx` actually contains, and how each column is produced, so a future change can
be checked against the target rather than against memory.

Parsed cell-by-cell in `docs/claude-code/system-audit.md` §1.1. Read that before opening the file.

## Layout

| Row | Contents |
| --- | --- |
| 1 | `SUBTOTAL(9,…)` strip — **the three money columns only** |
| 2 | Header |
| 3+ | One row per **sale** |

**The strip has no `COUNTIF`.** This is the single most important difference from the billing sheet, which
*does* count its Internet / TV / HP flag columns. Mirroring the statement renderer verbatim would print
totals Redwave does not have.

## Columns — 18

Their file has 16 (A–P). `Greenfield` and `Spiff` are **additions** confirmed in Meeting 4, inserted before
`Total 100 %`.

| # | Column | Source |
| --- | --- | --- |
| 1 | Sale Date | `sales.sale_date` — governs the pay period (#7) |
| 2 | Agent ID | **`reps.external_code`** (`Redwave11`), falling back to `rep_code` |
| 3 | Agent (Normalized) | `reps.full_name` |
| 4 | Customer | `sales.customer_name` — **ONE column**, a first name only in their sample |
| 5 | Address | one string: street, city, province, postal |
| 6 | Channel | `clients.client_code` |
| 7 | Product | the internet speed product on the sale |
| 8 | Internet | presence flag |
| 9 | TV | presence flag |
| 10 | Home Phone | presence flag |
| 11 | Internet Rate | frozen `sale_items.rate_applied` for the tiered internet item |
| 12 | TV Rate | frozen `rate_applied` for the TV item |
| 13 | HP Rate | frozen `rate_applied` for the home-phone item |
| 14 | **Greenfield** | frozen `rate_applied` for a greenfield item — its own column (#9) |
| 15 | **Spiff** | frozen `sale_items.incentive_amount` across the sale |
| — | *Other* | appears **only when non-zero** — a priced item with no column of its own |
| 16 | Total 100 % | the exact sum of the components above (#1) |
| 17 | 0.7 | the advance, rounded half-up |
| 18 | 0.3 | the holdback, **derived as the remainder** so the two always sum exactly |

## Two things their file does that ours deliberately does not

**Their `Internet Rate` is typed by hand and inconsistent** — a literal `125` in one row, a hard-coded
`=IF(G9="…",145,…)` in another. Those are Schedule C v2 Tier 3 and Tier 2, switched manually per row. **The
system computes what they retype**, which is the entire point of the report. Per-row equality with their
sheet is therefore *not* a valid test: it would assert their bookkeeping, not our correctness. What we do
assert is their row-1 strip — **375.00 / 262.50 / 112.50** — reproduced in
`payroll-report.logic.spec.ts`.

**Their `Customer` is not split.** The client statement splits first/last; this sheet does not.

## Rules that govern the numbers

- **Rep stream only (#3).** No code path from this report reaches the client-billing rate tables. Enforced
  by `payroll.no-billing.spec.ts`, which scans the source *and* asserts the DoD's own grep. It is the mirror
  of `billing.no-commission.spec.ts`.
- **Frozen, never recomputed (#2).** Lines are written at pay-run **finalize** from the same engine result
  that freezes the `sale_items` snapshots, so the report and the pay can never disagree.
- **Empty before finalize, and it says so.** A draft run has no lines. `is_finalized: false` is reported and
  the download is not offered — an empty sheet would misrepresent the state rather than reflect it.
- **Greenfield is flat-rated and out of the tally (#9)**, so it is its own column rather than folded into
  internet — folding it would misreport both.
- **Money is an exact decimal string (#1)** end to end; the workbook writes numbers for display only.

## Endpoints

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/v1/pay-runs/{id}/payroll-report` | `payrun:view` — preview JSON |
| `GET` | `/v1/pay-runs/{id}/payroll-report/download` | `payrun:export` — the `.xlsx` |

No new permission; both ride the existing pay-run gates, alongside the ADP export.
