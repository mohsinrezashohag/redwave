# Redwave — whole-system audit against the client's files and the polishing packets

> Written 2026-08-13 against `feat/rate-grid` @ `909ce35`.
> Method: parsed all four `docs/uat/*.xlsx` workbooks cell-by-cell (formulas included), read the
> polishing packets, the BRD/SRS/data-model/architecture docs, and the backend + frontend source,
> then ran the full §2.5 verification gate.
>
> Companion: [`gap-report.md`](gap-report.md) has the packet-by-packet detail. **This document is
> the whole-system view** — what the client's own files actually say, what is already built and
> wrong, and what is missing.

---

## 0. System health — measured, not assumed

| Gate | Result |
|---|---|
| `npm -w backend run test` | **115 suites / 959 tests passed** (282 s) |
| `npm -w frontend run build` | ✅ built (tsc --noEmit + vite) |
| `npm -w frontend run lint` | ✅ clean |
| `npm -w frontend run stylelint` | ✅ clean — no token violations |
| `npm -w frontend run test` | **17 files / 89 tests passed** |

The codebase is healthy. **Everything in this report is a specification or data gap, not a
broken build.** Two incidental notes: the `mfa.service.spec` flake recorded in `CLAUDE.md` §12 did
not reproduce, and jest reports a worker teardown leak (cosmetic, exit 0).

**The frozen test counts in `CLAUDE.md` §12 ("602", "623", "632", "817/817") are all stale** — the
real number today is 959.

---

## 1. What the client's workbooks actually contain

This is the part that could not be checked before. All four files parsed; three were fully
readable, the fourth is noted in §7.

### 1.1 `Payroll report.xlsx` — the packet-02 target

**Anatomy:** one sheet, 102 rows, **16 columns (A–P)**, 3 rows of real data.

- **Row 1** — a `SUBTOTAL(9,…)` strip on **only the three money columns** `N1`/`O1`/`P1`
  (375 / 262.50 / 112.50). Note this differs from the billing sheet, which *also* puts `COUNTIF`
  on its flag columns. The payroll strip has **no counts**.
- **Row 2** — the header. **Row 3+** — data.

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Sale Date | Agent ID | Agent (Normalized) | Customer | Address | Channel | Product | Internet | TV | Home Phone | Internet Rate | TV Rate | HP Rate | Total 100 % | 0.7 | 0.3 |

**Packet 02's 18-column target = these 16 + `Greenfield` + `Spiff` inserted before `Total 100 %`.
Confirmed exactly.**

**Formulas — what they reveal about the rep stream:**

| Cell | Formula | Meaning |
|---|---|---|
| `K3` | literal `125` | internet rate typed by hand |
| `K9` | `=IF(G9="fibre 150mb/300mb",145,IF(G9="Fibre 500mb/650mb",145,IF(G9="Fibre 1gig/2.5gig",145,"")))` | **145** — a different tier, hard-coded per row |
| `L3` | `=IF(I3,30,0)` | TV flat **$30** |
| `M3` | `=IF(J3,30,0)` | HP flat **$30** |
| `N3` | `=SUM(K3:M3)` | Total 100% |
| `O3` / `P3` | `=N3*70%` / `=N3*30%` | the 70/30 split |

$30 TV, $30 HP, and 125/145 internet are **Schedule C v2 exactly** (Tier 3 = $125, Tier 2 = $145).
So packet 02's claim — *"internet is tiered, not the flat 125 in their sheet"* — is **confirmed and
understated**: their sheet contains *both* rates, switched manually per row. **The system computes
what they retype by hand.** That is the single strongest argument for this packet.

**Other confirmations:** `Agent ID` = `Redwave11` / `Redwave05` → `reps.external_code`, as packet 02
says. `Customer` is **one column holding a first name only** ("Tim", "Kevin", "Claude") — it is
**not** split first/last the way the billing statement is. `Address` is one string. `Product` is the
speed name (`Fibre 1gig/2.5gig`). There is no Greenfield and no Spiff column today.

### 1.2 `Client billing report.xlsx` — the live client-facing bill

**Anatomy:** one sheet, **17 columns (A–Q)**, 3 data rows, dated 2026-07-13.

- **Row 1** — `COUNTIF(…,TRUE)` on the three flag columns **plus** `SUBTOTAL(9,…)` on every money
  column (`L1..Q1`, grand total 1050).
- **Row 2** — header; **Row 3+** — data.

**This matches [`statement-excel.renderer.ts`](../../backend/src/modules/billing/renderers/statement-excel.renderer.ts#L97-L116)
column-for-column, including the row-1-above-header convention, the live formulas, the autofilter,
and the `Spiff (July 13- july 19 ,2026)` header carrying its own window.** The billing renderer is a
faithful reproduction of the client's file. That work is done and correct.

**The `L3` rate formula — the authoritative client-bill grid:**

```
Fibre 150mb/300mb        → 280      WI Internet 25/5           → 380
Fibre 500mb/650mb        → 340      WI Internet 50/10          → 380
RF Fibre 1gig/2.5gig     → 365      Business Internet 150      → 400
Fibre 1gig/2.5gig        → 350      Business Internet 500/1gig → 450
```

`M3 =IF(J3,50,0)` → **TV 50**; `N3 =IF(K3,50,0)` → **HP 50**; `O` → bundle **35** or **0**.

**`C3` is an `XLOOKUP` over a hard-coded 43-agent roster** mapping `Redwave01…Redwave43` → full
names. So Redwave runs **43 reps**, keyed by `RedwaveNN` — which is `external_code`, **not**
`rep_code`. See §2.1.

### 1.3 `Sales Upload.xlsx` — matches the built importer

Sheet `Historical Sales`, 9 columns: `Client code · Rep code · Product type · Sale date ·
Activation date · Billed amount · Customer · MPU ID · Greenfield`. Values are `VF` / `RW-D-0002` /
`Internet, TV` / `2026-06-01` / `400` / `VF-1042`.

**This is exactly what the import module already handles** — `master_migration:sales`, the
comma-separated multi-type cell resolved through `value-vocabulary.logic.ts` (§14 #5), `rep_code` as
the business key, optional MPU. **No gap.** Note it uses `RW-D-0002` (internal `rep_code`), so both
identifier schemes are genuinely in play across the client's files.

### 1.4 The client's manual sheets contain real arithmetic bugs

Found while parsing. Each one is money that is currently wrong in Redwave's own process:

| File | Cell | Formula | Defect |
|---|---|---|---|
| Payroll | `M9` | `=IF(J8,30,0)` | **Off-by-one row** — row 9's HP rate keys off row **8**'s Home Phone flag |
| Billing | `N5` | `=(shared:M4)` → `=IF(J5,50,0)` | **Wrong column** — row 5's *HP Rate* keys off the **TV** flag |
| Billing | `O3`, `O5` | `=IF(AND(…),0,0)` | Bundle bonus **can never pay** — both branches are 0, while `O4` on an identical VF row uses `35` |

**Implication for packet 01's definition of done.** It says the generated statement must match the
fixture *"to the cent"*. Against these cells, a correct system will **disagree with the workbook**.
The DoD should read: *match the workbook where the workbook is correct, and produce a documented
reconciliation note for each cell where it is not.* Chasing byte-equality with a buggy sheet would
mean reproducing the bugs.

---

## 2. Confirmed defects in what is already built

These are not packet gaps. They are places where shipped behaviour does not match the client's
requirement **today**.

### 2.1 🔴 The client statement prints the wrong Agent ID

**Confirmed.** [`statement.service.ts:360`](../../backend/src/modules/billing/statement.service.ts#L360)
freezes `rep_code: sale.rep.rep_code`, and
[`statement-excel.renderer.ts:162`](../../backend/src/modules/billing/renderers/statement-excel.renderer.ts#L162)
writes that value into the column headed **`Agent ID`**.

- Our output: `RW-D-0001`
- The client's own bill: `Redwave20`
- The payroll sheet: `Redwave11`

**Both of the client's workbooks use `external_code`. We emit the internal code on a
partner-facing document.** A client reconciling our statement against their roster cannot match a
single agent.

`docs/uat/billing-target-format.md` documents this incorrectly ("Agent ID → `reps.rep_code`"), which
is how it got built this way. This is the same conflict flagged as §4.1 in the gap report — now
resolved by evidence: **`external_code` is right, and the shipped statement is wrong.**

Fix is small (source `external_code`, fall back to `rep_code` when null) but it touches a **frozen
line** on already-issued statements, so it needs a decision: new column vs. changed source, and
whether historical statements re-render. `external_code` is nullable and reps are only creatable via
import (`CLAUDE.md` §12), so the fallback matters.

### 2.2 🔴 `SEED_DEMO=yes` is broken — demo data cannot be generated

**Confirmed.** [`demo.ts:340`](../../backend/prisma/seed/demo.ts#L340) calls
`documents.upload({ title, doc_type }, stubPdf, sa)` — three arguments — against
[`DocumentsService.upload(dto, user)`](../../backend/src/modules/documents/documents.service.ts#L73),
which takes **two** and whose first line is `this.files.claim(dto.file_path, …)`. The seed passes no
`file_path`, so even fixing the arity throws on the claim.

This is recorded in `CLAUDE.md` §12 but understated: it is not a latent typing issue, it is a
**hard failure of the demo seed at the documents step**, hidden because the seed runs
`--transpile-only` and `tsconfig.json` `include` is `src/**/*`. Anyone standing up a demo or UAT
environment hits it. **Fix the call and widen the typecheck to `prisma/`**, or the next drift lands
identically.

### 2.3 🟠 The sales export has no Agent columns

[`saleExport.ts`](../../frontend/src/features/sales/saleExport.ts#L25-L39) projects
`product_name · has_internet · has_tv · has_home_phone · internet_rate · tv_rate · hp_rate ·
other_total · total` — **no rep code, no rep name**. `SaleResponse` exposes only `rep_id`.

This is the closest existing artifact to packet 02's payroll report (same component split, frozen
commission money, blank-until-paid), and it is **missing the two columns that make a payroll row
identifiable**. Fixing this is a prerequisite the packet does not list: add rep to `SALE_INCLUDE`
and the response DTO first, or packet 02 rebuilds the same plumbing.

### 2.4 🔴 Two incompatible rate grids exist, and the operator is pointed at the wrong one

`CLAUDE.md` §12 and `docs/rate-grid.md` instruct the operator to enter rates from **`docs/rate-grid.md`**
(the Meeting-3 grid). The client's July workbook prices differently:

| | `docs/rate-grid.md` (Meeting 3) | `Client billing report.xlsx` `L3` (July) |
|---|---|---|
| Pricing key | **per client**, one internet rate each | **per product name**, channel-blind |
| VF internet | **350 flat**, all speeds | 350 only for `Fibre 1gig/2.5gig`; `Fibre 150mb/300mb` → **280** |
| RF internet | 280 / 340 / 365 by speed | same three, `RF Fibre 1gig/2.5gig` → 365 |
| RF add-ons | HP **90** · TV **100** | one formula: **50 / 50**, no channel distinction |
| Products | ~1 internet product per client | **8 named speed variants** |

These are two different pricing **models**, not two number sets. `client_billing_rates` keys on
(client, product, rate_kind) so it can express either — but only one can be entered, and entering
the wrong one silently produces wrong invoices for every VF sale below 1 gig.

**This blocks packet 01 and needs a client answer, not a developer decision.** `docs/rate-grid.md`
already says to get sign-off on the figures; that sign-off has not visibly happened, and the newer
workbook now contradicts the doc. Packet 01's table comes from the workbook and is the better
starting point.

### 2.5 🟠 Product-name mismatch will break name-keyed pricing

The workbook's `L3` and `I3` formulas both match on **`Business Internet 500/1gig`**.
Packet 01's table writes **`Business Internet 500mb/1gig`**.

Since packet 01's whole design is *"speed lives in the product name"*, an extra `mb` means the
product will not match the client's file on import or reconciliation. **Use the workbook spelling
verbatim for all eight products.**

### 2.6 🟡 An unresolved Meeting-3 question was answered by building the opposite

[`meeting-3-deltas.md`](../meeting-3-deltas.md) §1: *"**RF Now $35 HP+TV bundle** — client wants it
dropped from the system (handled manually). Confirm removal vs. keep."* — and §6 lists it as open
question 6.

The system then **built** configurable bundle pricing (`bundle_product_types`, migration
`20260616000000`), and `docs/rate-grid.md` step 4 tells the operator to enter the RF $35 bundle.

Low risk — a bundle only applies if its rate row exists, so "dropped" is achievable by not entering
it. But the open question was never closed, and the client's own sheet is inconsistent about it
(§1.4). **Confirm, then either enter the rate or record that it is deliberately absent.**

### 2.7 🟡 SRS PAY-011 is the one requirement with no implementation

Of 150 requirement IDs in the SRS, 99 are cited in code. I sampled the 51 uncited ones — CLAW-002…008,
BILL-006/008/009/010, PAY-004/005/007/008/009, DOC-008/009, IMP-006/011, RPT-012/013, EXP-005/008 —
and **all are implemented**; they simply are not cited in a `// —` comment. Citation coverage is not
functional coverage.

The exception: **PAY-011** — *"Where a tier cannot yet be finalized at advance time, the system may
advance at Tier 4 and true-up at close."* No implementation, no test, no build-log mention. The SRS
says **"may"**, so this is likely a deliberate non-implementation — but it should be recorded as
such rather than left silently absent.

---

## 3. The ten packets — status

Full detail in [`gap-report.md`](gap-report.md). Every packet's premise re-verified as accurate.
Nothing in the workbooks changed any packet's scope; the workbooks **strengthened** 01, 02 and 09.

| # | Packet | Built | Blocked on |
|---|---|---|---|
| 01 | Rate-grid load | none | **client sign-off** (§2.4) + name fix (§2.5) |
| 02 | Payroll report | none | rep columns (§2.3); format now fully specified (§1.1) |
| 03 | Rep pay statement | none | permission model decision (gap-report §4.2) |
| 04 | Back-date import handlers | billing rates only | nothing |
| 05 | Teams + target spiff | no team concept at all | **3 client answers** |
| 06 | Bulk statements | per-client only | nothing |
| 07 | Margin / rate transparency | cash-basis `net_margin` only | #3 review |
| 08 | Configurable periods | hard-coded constants | nothing |
| 09 | Configurable exports | static arrays | packet 02 |
| 10 | Expense categories | 7-value enum | nothing |

---

## 4. Documentation that is now wrong

A stale doc caused §2.1 (`billing-target-format.md` → wrong Agent ID was built from it). These are
the rest, all verified:

| Doc | Says | Reality |
|---|---|---|
| `docs/uat/billing-target-format.md` | Agent ID → `reps.rep_code` | client's workbooks use `external_code` (§2.1) |
| `docs/rate-grid.md` closing note | pricing applies only `rate_kind='product'` | `tv_addon`/`hp_addon`/`bundle_bonus`/`spiff` all apply |
| `docs/rate-grid.md` grid | per-client single internet rate | superseded by the July workbook (§2.4) |
| `CLAUDE.md` §12 | "Sales targets (RPT-008) deferred" | `SalesTarget` + `TargetsService` + `/v1/sales-targets` are built |
| `CLAUDE.md` §12 | folder-per-week "enforced in the SERVICE, not the DB" | migration `20260629000000` added two partial unique indexes; §13.10 says so correctly |
| `CLAUDE.md` §12 | test counts 602 / 623 / 632 / 817 | **959** |
| `docs/go-live-punch-list.md` | Batch A "do first" items | all shipped (exception filter, response DTOs, sales pagination) |

---

## 5. What to do, in order

**Before any packet — decisions only Redwave can make.** These block real work and cost nothing
to ask:
1. **Which rate grid is authoritative** — the July workbook (per-product) or the Meeting-3 doc
   (per-client)? (§2.4)
2. **Agent ID on the client statement** — confirm `external_code`; agree whether issued statements
   re-render. (§2.1)
3. **RF $35 bundle** — keep or drop? (§2.6)
4. Packet 05's three questions — target precedence, metric, team-per-client.

**Then, in this order:**

| Order | Work | Why here |
|---|---|---|
| 1 | **Fix §2.2** (demo seed) | One-line fix; unblocks every demo/UAT environment |
| 2 | **Fix §2.1** (Agent ID) | Client-facing correctness bug in an issued document |
| 3 | **Packet 04** (back-date handlers) | Only packet fixing a live bug; go-live blocker in disguise |
| 4 | **Packet 01** (rate grid) | Needs decision 1; everything downstream verifies against it |
| 5 | **§2.3 + Packet 02** (rep columns → payroll report) | Format now fully specified by §1.1 |
| 6 | Packet 03 → 09 | Chain from 02 |
| 7 | Packets 06, 10 | Small, independent; slot anywhere |
| 8 | Packet 07 | After 01; needs the #3 discipline review |
| 9 | Packet 08 | Wide blast radius; run alone |
| 10 | Packet 05 | Blocked; Phase A (teams) can start once scoped |

**Doc fixes (§4)** should ride along with whichever packet touches each area — except
`billing-target-format.md`, which should be corrected **with** §2.1 so the fix and its rationale
land together.

---

## 6. What is genuinely strong

Worth stating, because an audit that only lists problems misrepresents the system:

- **The billing renderer reproduces the client's workbook faithfully** — row-1 strip above the
  header, live `COUNTIF`/`SUBTOTAL` over an autofiltered range, real date and boolean cell types,
  the spiff window frozen into its own column header. That is a hard thing to get right and it is
  right.
- **The invariants hold under test.** 959 backend tests pass, including the structural guards that
  make #3 and engine purity enforceable rather than aspirational.
- **The importer already matches the client's real file shape** (§1.3) with no changes.
- **The rep-stream rates in the client's payroll sheet are exactly Schedule C v2** ($30/$30,
  125/145) — the engine's configuration matches the client's reality.

---

## 7. Limits of this audit

- **`Sample Billing for Client.xlsx` was not parsed** — exceljs did not finish reading it within
  5 minutes (the other three parsed in seconds). Its format is documented in
  `docs/uat/billing-target-format.md` and is consistent with `Client billing report.xlsx`, which
  did parse; re-attempt with a streaming reader if its tab `Vf and RF Bill` needs direct checking.
- **The three parsed workbooks contain 3 data rows each** — enough to confirm structure and every
  formula, not enough to be a volume fixture.
- **No runtime/browser pass.** Findings are from source, schema, tests and workbook contents. UI
  behaviour, real Postgres migrations and rendered PDFs were not exercised.
- **Requirement coverage was sampled, not exhaustive** — 51 uncited SRS IDs reviewed by reading
  their text and locating the owning module, not by testing each end to end.
