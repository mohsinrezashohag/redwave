# Client Billing — Target Format

The format Redwave sends clients. This is the specification the generated statement must match.
Source workbook alongside this doc: `Sample_Billing_for_Client.xlsx`, tab `Vf and RF Bill`.

**All amounts are admin-configured and effective-dated.** No rate appears in this document, and
none belongs in code. Rates observed in any one workbook are a snapshot of that period's config.

Billing stream only. The internet speed changes what the client is billed, never what the rep is
paid — invariant #3 holds throughout.

---

## Statement line

One row per sale.

| # | Column | Source |
|---|---|---|
| 1 | Sale Date | `sales.sale_date` |
| 2 | Agent ID | `reps.rep_code` |
| 3 | Agent Name | `reps.full_name` |
| 4 | Customer's First Name | separate field |
| 5 | Customer's Last Name | separate field |
| 6 | Address | formatted single string |
| 7 | Channel | `clients.client_code` |
| 8 | Product | internet speed product name |
| 9 | Internet | presence boolean |
| 10 | TV | presence boolean |
| 11 | Home Phone | presence boolean |
| 12 | Internet Rate | `rate_kind='product'`, effective on sale date |
| 13 | TV Rate | `rate_kind='tv_addon'` |
| 14 | HP Rate | `rate_kind='hp_addon'` |
| 15 | Bundle Bonus | `rate_kind='bundle_bonus'` — applies when internet, TV and home phone are all present |
| 16 | Spiff | `rate_kind='spiff'` — date-bounded; header carries the range |
| 17 | Total | sum of 12–16 |

Customer first and last name are separate columns.

## Summary strip

Sits **above** the header row, not below the data:

- counts of Internet, TV, Home Phone
- column sums for each money column
- grand total

Counts are over the boolean columns; money sums respect filtering.

## Period

Statements cover a **week, Monday–Sunday**, with a **sequential bill number** (`Bill 17`).
Pay periods run Sunday–Saturday biweekly, so a bill can straddle two pay periods. Billing needs
its own period rather than reusing `pay_period_id`.

---

## Gap against current behaviour — CLOSED (migration `20260623000000_billing_weekly_line_detail`)

Previously a line was one customer, a `products_summary` string, one `line_total`, priced only through
`rate_kind='product'`.

1. **Speeds as products** — each speed a `products` row under its client. Already possible with no
   schema change; `client_billing_rates` keys on (client, product, rate_kind) and is effective-dated.
   **Data entry only** (the operator's browser pass — see `docs/rate-grid.md`).
2. **Apply the remaining rate kinds — DONE.** `tv_addon`, `hp_addon` and `spiff` now resolve, each
   effective-dated on the sale date, alongside the existing `bundle_bonus`.
   **TV / Home Phone precedence (confirmed):** the client-wide **add-on kind wins**; the TV/HP
   *product* rate is the **fallback**. The two never stack, so a client billing them as products keeps
   billing exactly as before, and adding a `tv_addon` switches that client over with no re-entry.
   A TV/HP product priced by *neither* is still a 422 — never a silent under-bill.
   A priced product with no column of its own (Wireless / Protection Plan / Mesh / Speed-attach)
   lands in **`other_total`** and gains an "Other" column in the export, so nothing is dropped.
3. **Widen the line schema — DONE.** `client_statement_lines` carries per-component amounts,
   presence flags, sale date, rep code + name, address, channel and product. Every new column is
   nullable: statements are immutable and gapless-numbered, so this is **forward-only** — an older
   statement keeps its narrow lines and still downloads as issued; **regenerate** to get the new
   format (which mints a new number and supersedes the prior version).
4. **Export renderer — DONE.** The 17-column layout above, header on row 2, summary strip on row 1 as
   live `COUNTIF` / `SUBTOTAL(9,…)` formulas over an autofiltered range, so the client's filtering
   updates the totals exactly as the source workbook does.
5. **Billing period — DONE.** `billing_periods`: weekly Monday–Sunday, sequential `period_number`
   ("Bill 17"), seeded for 2026, independent of pay periods. Statements and invoices key off it;
   `pay_period_id` is retained (nullable) for documents issued before the change.
6. **Customer first/last name — DONE.** `sales.customer_first_name` / `customer_last_name` are
   captured on sale entry and the bulk-sales import; `customer_name` is derived from them so the two
   can never disagree. A sale entered before the split has its single name split at generation.

Pricing stays server-side and frozen at issue. The UI computes nothing — even the summary strip is
summed by the server from the frozen lines.
