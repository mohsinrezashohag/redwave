# Packet 01 — Load the real client rate grid and per-speed products

## Goal
Replace the demo placeholder pricing with Redwave's real grid, so every later packet
can be verified against real money. **No behaviour change — data and tooling only.**

## Why this is needed
`backend/prisma/seed/demo.ts` seeds three generic products per client at an identical
$60 / $25 / $20. That is why UAT showed `Internet 60.00` and a $105 bundle line for every
client. The pricing engine is correct; the rates were never entered.

## Read first
- `docs/claude-code/system-audit.md` §1.2 and §2.4 — the workbook has been parsed; `L3` is
  transcribed there, and §2.4 documents the conflict described immediately below.
- `docs/rate-grid.md` — the grid, plus entry instructions. **Two stale things in it:** its closing
  scope note claims only `rate_kind='product'` is applied (`statement.service.ts` applies
  `tv_addon`, `hp_addon`, `bundle_bonus` and `spiff` too), and its grid is superseded — see below.
- `docs/uat/Client billing report.xlsx` — the client's own rate formula, cell `L3`.

## ⚠ BLOCKED until Redwave answers: which grid is authoritative

`docs/rate-grid.md` and the July workbook price by **different models**, not just different numbers:

| | `docs/rate-grid.md` (Meeting 3) | `Client billing report.xlsx` `L3` (July) |
|---|---|---|
| Pricing key | **per client** — one internet rate each | **per product name** — channel-blind |
| VF internet | **350 flat**, every speed | 350 for `Fibre 1gig/2.5gig`; `Fibre 150mb/300mb` → **280** |
| RF add-ons | HP **90** · TV **100** | one formula → **50 / 50**, no channel distinction |

`client_billing_rates` keys on (client, product, rate_kind), so it can express either — but only one
can be entered, and the wrong one bills every VF sale below 1 gig incorrectly while still verifying
green. **Do not enter rates until this is answered.** The table below is the workbook's, which is
the newer source.
- `backend/prisma/seed/demo.ts`
- `frontend/src/features/import/templates.ts`
- `backend/src/modules/import/handlers/billing-rate.handler.ts`

## What to build

**1. A rate-grid seed module** — `backend/prisma/seed/rate-grid.ts`, invoked from the demo seed,
replacing the three placeholder products per client.

Eight internet products, taken from the client's own `L3` formula:

| Product name | Client rate |
| --- | --- |
| Fibre 150mb/300mb | 280 |
| Fibre 500mb/650mb | 340 |
| Fibre 1gig/2.5gig | 350 |
| RF Fibre 1gig/2.5gig | 365 |
| WI Internet 25/5 | 380 |
| WI Internet 50/10 | 380 |
| Business Internet 150 | 400 |
| Business Internet 500/1gig | 450 |

**Use these names verbatim.** They are transcribed from the workbook's `L3` / `I3` formulas, which
match on the name with `COUNTIF(H3,"…*")`. An earlier draft of this packet wrote
`Business Internet 500mb/1gig`; the workbook has no `mb` there. Since this packet's whole design is
"speed lives in the product name", a one-character drift breaks import matching and reconciliation.

Plus per client: `TV` 50, `Home Phone` 50 (`tv_addon` / `hp_addon`), RF Now `bundle_bonus` 35,
CTI priced in **USD**. Speed lives in the **product name** — that is what closes the
"no internet speed at sale entry" finding, with no code change.

**2. Add VF Business as a client.** It does not exist in the seed today.

**3. Import workbooks** for the same data, generated into `docs/uat/rate-grid/`, using the
existing `billing_rates` and `products` templates. This is how Redwave loads it themselves.
Back-dated effective dates are fine here — `billing-rate.handler.ts` is the sanctioned #10 path.

**4. A verification script** — `backend/scripts/verify-rate-grid.ts`. Generates a VF and an RF
statement for a known billing week and diffs the totals against `docs/uat/Client billing report.xlsx`.
Exit non-zero on any mismatch.

## Invariants at risk
- **#1** — rates are decimal strings → Prisma `Decimal`. No floats anywhere in the seed.
- **#10** — every rate row is effective-dated. Do not hard-code a rate anywhere in application code.
- **#12** — CTI is USD. Do not convert at seed time; FX freezes at document issue, not here.

## Definition of done
- A generated VF statement and a generated RF statement match the fixture **to the cent wherever the
  fixture is correct**, with a written reconciliation note for every cell where they differ.
  **The workbook contains real formula bugs** (see `system-audit.md` §1.4): `O3`/`O5` are
  `=IF(AND(…),0,0)` so the bundle can never pay, and `N5` keys the *HP* rate off the **TV** flag.
  A correct system must disagree with those cells. Byte-equality here would mean reproducing the
  bugs — do not chase it, and do not "fix" the engine to match them.
- RF Now's bundle bonus appears. VF's behaviour depends on the answer to the blocked question above;
  the sample sheet is itself inconsistent (`O4` uses 35 on a VF row, `O3`/`O5` use 0).
- The sale form's product dropdown shows the eight speed variants for the right clients.
- `verify-rate-grid.ts` passes.

## Do NOT
- Do not change `statement.service.ts` or any pricing logic. If a rate does not price correctly,
  the grid data is wrong — fix the data, report the discrepancy, do not patch the engine.
- Do not touch `commission_*`. This packet is the **client** stream only (#3).
