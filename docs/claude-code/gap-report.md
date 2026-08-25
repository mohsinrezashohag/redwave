# Polishing packets — gap report vs. the current build

> Written 2026-08-13 against `feat/rate-grid` @ `909ce35`. Every claim below was verified
> against the code, not against `CLAUDE.md` or the packet text. File:line evidence is cited so
> this can be re-checked cheaply when it ages.
>
> Scope: the 11 packet files in `docs/claude-code/`, compared with what exists in `backend/`,
> `frontend/` and `backend/prisma/schema.prisma` today.

---

## 1. Headline

**Every packet's premise is factually correct.** I tried to falsify each one — the missing
table, the missing endpoint, the hard-coded constant, the enum — and in all 10 cases the gap is
real and the described current-state is accurate. That is unusual for a spec set written five
days ahead of the code it describes, and it means the packets can be executed as written rather
than re-scoped.

Three things the packets do *not* say, which change how they should be sequenced:

1. **Packet 04 is the only one fixing an active data-loss-shaped bug.** It is filed as
   independent and small, but it is the reason UAT expenses became unpriceable, and the same
   failure hits every historical rate on go-live day. It is currently sitting behind three
   larger packets in the README ordering.
2. **Packets 02 and 03 disagree with the billing spec about what "Agent ID" means** —
   `external_code` vs `rep_code`. Two artifacts for the same rep will carry different IDs
   unless this is decided deliberately (§4.1).
3. **Packet 03's proposed permission does not fit the RBAC model.** `pay_statements:read_self`
   is not expressible as a module×action pair; it needs a `PermissionAction` enum migration,
   the same way `broadcast` and `business` did (§4.2).

Total footprint: **7 new migrations, 2 new backend modules' worth of surface, ~6 new
frontend screens.** Packets 05, 08 and 09 carry the architectural risk; 04, 06 and 10 are
near-mechanical.

---

## 2. Status at a glance

| # | Packet | Premise verified | Built today | Size | Risk |
|---|---|---|---|---|---|
| 01 | Rate-grid load | ✅ accurate | **Nothing** — demo seeds `Internet 60.00` / `TV 25.00` flat | S (data only) | Low |
| 02 | Payroll report | ✅ accurate | **Nothing** — no logic, table, renderer or route | L | Med |
| 03 | Rep pay statement | ✅ accurate | **Nothing** | M | **High** (leakage) |
| 04 | Back-date import handlers | ✅ accurate | Billing rates only; KM + commission have no path | S | Low |
| 05 | Teams + target spiff | ✅ accurate | **No team concept anywhere**; spiff is flat-only | **XL** | **High** |
| 06 | Bulk statements | ✅ accurate | Per-client endpoints only | S | Med (numbering) |
| 07 | Rate transparency / margin | ✅ accurate | `net_margin` exists but is cash-basis, not per-sale | M | **High** (#3) |
| 08 | Configurable periods | ✅ accurate | Both calendars are `const` in seed-data files | L | **High** (#7/#8) |
| 09 | Configurable exports | ✅ accurate | Static column arrays; no `export_layouts` | L | Med |
| 10 | Expense category enum | ✅ accurate | 7-value Prisma enum | S | Low |

---

## 3. Packet-by-packet

### 01 — Rate-grid load · *premise confirmed*

**Verified.** [demo.ts:80-81](backend/prisma/seed/demo.ts#L80-L81) seeds exactly three products
per client at `Internet 60.00` / `TV 25.00` (+ HP), which is the source of the UAT
`Internet 60.00` and the uniform $105 bundle line. `docs/uat/` holds the four source workbooks
including `Client billing report.xlsx`. No `seed/rate-grid.ts`, no `scripts/verify-rate-grid.ts`,
no `docs/uat/rate-grid/`.

**The packet's correction to `docs/rate-grid.md` is right, and worth acting on separately.**
That doc's closing scope note claims *"statement pricing currently combines only
`rate_kind='product'`"*. It does not: [statement.service.ts:249-352](backend/src/modules/billing/statement.service.ts#L249-L352)
resolves `tv_addon`, `hp_addon`, `bundle_bonus` **and** `spiff`, and
[schema.prisma:1321-1325](backend/prisma/schema.prisma#L1321-L1325) has a frozen column for each.
The note is a leftover from before the bundle-pricing track landed. **Fix the doc in this packet**
— it is the exact kind of stale line that causes someone to rebuild a feature that already ships.

**Downstream readiness is better than the packet assumes.** `client_statement_lines.product_name`
is already commented *"the internet speed product on this sale"*, so the pipeline for
speed-in-the-name needs no code change — the packet's claim that this closes the "no speed at
sale entry" finding holds end to end.

**One gap the packet doesn't mention:** `VF Business` needs to exist as a client *and* the rate
grid gives it its own products, but per `CLAUDE.md` §12 **there is no rep create/edit form** —
reps arrive by import. If VF Business needs its own reps for a realistic verification statement,
that is the reps import, not a UI step.

---

### 02 — Payroll report · *premise confirmed; nothing exists*

**Verified absent.** [backend/src/modules/payrun/](backend/src/modules/payrun/) has no
`payroll-report.logic.ts`, no `renderers/` directory, and
[pay-run.controller.ts](backend/src/modules/payrun/pay-run.controller.ts) exposes only
`lines` · `holdback` · `bonus` · `finalize` · `export` (the ADP export). No `payroll_report_lines`
model. The mirror target is real and complete: `statement.logic.ts`, `ClientStatementLine`
(schema:1293) and `statement-excel.renderer.ts` all exist and are the right pattern to copy.

**`reps.external_code` exists** ([schema.prisma:532](backend/prisma/schema.prisma#L532), `String? @unique`,
migration `20260627000000`), so the Agent ID source is available — but see §4.1, it conflicts with
the billing artifact.

**The "rows are empty until finalize" instruction is correct and consistent.** `sale_items`
snapshot fields are NULL until Pay Run freezes them (#2), which is exactly why the sales export is
deliberately blank on an unpaid sale (`CLAUDE.md` §13.10). The packet's guidance to say so in the UI
rather than fake a number matches existing precedent — reuse the sales-export copy rather than
inventing new wording.

**Watch:** `POST /v1/pay-runs/{id}/export` already exists and flips the run to `exported`. The new
payroll export must **not** reuse that state transition, or generating a payroll workbook will
silently mark an ADP export as done.

---

### 03 — Rep pay statement · *premise confirmed; two design frictions*

**Verified absent.** No rep-facing statement route; `frontend/src/features/payrun/pages/` has only
the list and detail pages. `Rep.user_id` and the `RepLogin` relation exist
([schema.prisma:306](backend/prisma/schema.prisma#L306)) as the packet says, so no identity work is needed.

**Friction 1 — the permission does not fit the model (§4.2).**

**Friction 2 — "reconcile exactly with the packet-02 payroll report" needs a definition.** The
payroll report is per-sale rows for a whole pay run; the rep statement is per-sale rows for one rep.
Those reconcile trivially *only* if both read the same frozen `payroll_report_lines`. If packet 02
lands without that table (e.g. computed on the fly at export time), packet 03 loses its foundation.
**Treat `payroll_report_lines` as the hard deliverable of 02**, not the renderer.

The security section is the strongest part of the packet set and needs no addition — the "403, not
an empty 200" assertion is precisely the right test, because a scoped query naturally returns `[]`
and passes a naive test.

---

### 04 — Back-date import handlers · **do this first, not fourth**

**Verified precisely.** The asymmetry is real:

| Config | Back-date via UI | Sanctioned import path |
|---|---|---|
| Client billing rates | 422 | ✅ [billing-rate.handler.ts](backend/src/modules/import/handlers/billing-rate.handler.ts) — header names #10 explicitly |
| KM rates | 422 ([km-rate.service.ts:84](backend/src/modules/expenses/km-rate.service.ts#L84)) | ❌ **none** |
| Tier / flat / product-type / holdback | 422 (`effective-dates.util.ts`, 4 services) | ❌ **none** |

[import/handlers/](backend/src/modules/import/handlers/) contains five handlers; neither
`km-rate.handler.ts` nor `commission-config.handler.ts` is among them.

**Why this should move to the front of the queue:** it is the only packet repairing a failure that
already happened in UAT, its blast radius is one new file per handler plus templates, and it has no
dependencies. It is also a **go-live blocker in disguise** — on cutover day every historical KM rate
and every historical tier schedule hits the same 422 that broke Siam's week. Doing it after packets
01–03 means discovering the migration path is missing while loading production data.

The "do not add a Super-Admin UI override" instruction is right and matches how the billing-rate
bypass was justified: one audited path.

---

### 05 — Teams + target spiff · *premise confirmed; genuinely blocked*

**Verified.** `grep -c team backend/prisma/schema.prisma` → **0**. No team, group, branch or squad
model. `RateKind` ([schema.prisma:94-100](backend/prisma/schema.prisma#L94-L100)) has `spiff` with no
target fields; `ClientBillingRate` (schema:693) carries only `amount` + `bundle_product_types` +
effective dates. The packet's read is exact.

**One thing the packet doesn't know about, and should:** `SalesTarget`
([schema.prisma:1533](backend/prisma/schema.prisma#L1533)) **now exists and is wired** —
`TargetsService` + `/v1/sales-targets`, gated `hrm:edit`, scoped rep/roster/all. `CLAUDE.md` §12
still says *"Sales targets (RPT-008) deferred"*; that line is stale.

This matters for two reasons:
- It is a **rep-stream** count target (`rep_id`, `target_count`, period range). The packet's warning
  about not merging rep-side incentives with client-side spiff targets now applies to a *third*
  table that looks even more like what packet 05 wants. **`SalesTarget` must not be reused for the
  client-stream spiff** — same shape, opposite stream (#3).
- `SalesTarget.rep_id` is **nullable**, i.e. a non-per-rep target already has a slot. That is a
  tempting shortcut for "team target" and it is the wrong one, for the same reason.

**Blocked on Redwave.** The packet's three questions (both-met precedence, internet-only vs all
products, team-per-client) are not implementation details — the first one changes the money.
Do not start Phase B before they are answered; Phase A (teams CRUD) can proceed independently.

---

### 06 — Bulk statements · *premise confirmed; smallest real win*

**Verified.** [billing-generation.controller.ts](backend/src/modules/billing/billing-generation.controller.ts)
exposes `POST :id/statements/preview`, `POST :id/statements`, `POST :id/invoices` — all
`@Controller('clients')`, one client at a time. No period-level generate.

**The two risks the packet names are the right two**, and both already have precedent to follow:
- Per-document FX freeze (#12) — `generate()` already takes `fx_rate` per call, so batching must
  loop the existing call rather than hoist the rate.
- Gapless numbering under concurrency — `SequenceService.next(tx, key)` row-locks the counter
  (`CLAUDE.md` §14 #2), so sequential per-client transactions are safe; parallel ones are the thing
  to test, not assume.

Add one item to its definition of done: **invoices too, or explicitly not.** The packet says
"statements" throughout but the controller has a symmetric invoice endpoint, and an operator who
can bulk-generate statements will immediately ask why invoices are still one-by-one.

---

### 07 — Rate transparency / margin · *premise confirmed; highest architectural care*

**Verified.** `net_margin` exists at
[dashboards.service.ts:332](backend/src/modules/reporting/dashboards.service.ts#L332) and
[:479](backend/src/modules/reporting/dashboards.service.ts#L479) and is exactly what the packet says
— `revenue − payout`, a cash margin, not per-sale product margin. No per-sale margin read anywhere.

**The packet's handling of invariant #3 is the correct one** and its conditions should be treated as
binding, not advisory. Two additions:

- **The guard spec already exists and must stay green.**
  `billing.no-commission.spec.ts` does a **source scan** plus a throw-on-touch Prisma mock
  (`CLAUDE.md` §14 #10). A margin read model in `reporting/` does not trip it — that spec scans
  `billing/` — which is precisely why the packet's "reporting only" rule is what keeps the guard
  meaningful. Consider adding a **mirror scan** asserting that `client_billing_rates` appears in
  `reporting/` in exactly one file, so the sanctioned exception cannot silently spread.
- **Verify the grep condition before starting.** The packet's DoD says references should appear only
  in `billing/`, `clients/`, `import/` and the new read model. That is true today. Capture the
  current file list in the build-log entry so the next person can diff it.

The closing note about margin never reconciling across the two calendars is correct and important
(`CLAUDE.md` §14 #1) — it belongs **in the UI**, not only in the build log.

---

### 08 — Configurable periods · *premise confirmed; widest blast radius*

**Verified.** Both calendars are compile-time constants:
- [pay-periods.seed-data.ts:15-17](backend/src/modules/payrun/pay-periods.seed-data.ts#L15-L17) —
  `ANCHOR = '2026-01-04'`, `PERIOD_DAYS = 14`, `PAYDAY_OFFSET_DAYS = 13`
- [billing-periods.seed-data.ts:16-17](backend/src/modules/billing/billing-periods.seed-data.ts#L16-L17) —
  `ANCHOR = '2026-01-05'`, `WEEK_DAYS = 7`

The pay-periods file even carries the comment *"ASSUMPTION pending confirmation (flagged in
CLAUDE §12)"* — so this packet also closes that long-standing open item.

**The forward-only constraint is the right design.** One addition to the risk list the packet
doesn't name: **`resolvePayPeriod` derives a sale's period from `sale_date` by containment** (#7,
`sales/pay-period.logic.ts`). If a config change leaves a **gap or an overlap** between generated
periods, a sale lands in no period (silently unpayable) or two. The DoD should assert
**contiguity and non-overlap** of the regenerated set, not only that existing sales still resolve.

---

### 09 — Configurable exports · *premise confirmed; correctly sequenced last*

**Verified.** [exportDefs.ts](frontend/src/features/reports/exportDefs.ts) holds four static
report defs with fixed column arrays; no `export_layouts` model. The precedent the packet names
is real and strong — [templates.ts](frontend/src/features/import/templates.ts) has 10 static
templates across 4 groups plus server-side `ImportFieldMapping`.

**The asymmetry the packet identifies is the crux and it is understated.** The statement workbook's
`SUBTOTAL`/`COUNTIF` strip references columns **positionally**, and the frozen
`client_statement_lines` columns (`internet_rate`, `tv_rate`, `hp_rate`, `bundle_bonus`, `spiff`,
`other_total`) are what those formulas point at. So "configurable columns" over a server-rendered
workbook is really *configurable projection of a fixed frozen line* — worth stating that way in the
build-log entry, because "make exports configurable" invites someone to make the **line** dynamic,
which would break the re-render-identical guarantee (#2).

Its DoD item *"a re-downloaded historical statement is byte-identical to the original issue"* is the
single most valuable assertion in the packet set. Keep it.

---

### 10 — Expense category enum · *premise confirmed; smallest packet*

**Verified.** [schema.prisma:160-168](backend/prisma/schema.prisma#L160-L168) — exactly the seven
values named. The field schema is dynamic (`expense_field_configs.fields[]`), the category list is
not. `CLAUDE.md` §12 already records this ceiling twice.

**The Postgres gotcha is real and correctly stated.** `ALTER TYPE ... ADD VALUE` cannot be used in
the transaction that adds it, and Prisma wraps migrations — so two migrations or a raw block.

**Recommendation: option B, with a caveat the packet doesn't state.** `km` and `meals` are not the
only behavioural bindings — `km` also drives the KM-rate resolution path, the Maps route derivation,
the one-per-(rep, date) dedup, and its own `TripType`. So the "behaviour" retained by the enum is
larger than a two-item list; the config table should carry a `behaviour` discriminator the way
`product_type_catalogue` already does (`tiered|greenfield|standard_addon`, with `is_system` locking
the core types). **Mirror that model** rather than inventing a second pattern — it is the same
problem, already solved once in this codebase.

---

## 4. Cross-cutting findings

### 4.1 "Agent ID" means two different things

- Packet 02: *"`Agent ID` is `reps.external_code` (`Redwave11`), not the internal `rep_code`."*
- [docs/uat/billing-target-format.md](docs/uat/billing-target-format.md) row 2: *"Agent ID →
  `reps.rep_code`"* — and that is what ships:
  [`client_statement_lines.rep_code // Agent ID`](backend/prisma/schema.prisma#L1304).

Both may well be right (the client's sheet and Redwave's payroll sheet are different audiences), but
today it is undocumented divergence. **Decide it explicitly, write it in the build-log entry, and
put the reason in both format docs** — otherwise the first person who spots the mismatch "fixes" one
of them and breaks a partner-facing file.

### 4.2 `pay_statements:read_self` is not expressible in the RBAC model

[PermissionAction](backend/prisma/schema.prisma#L53-L62) is `view · create · edit · approve ·
delete · export` plus two deliberately off-grid values, `broadcast` and `business`. A `read_self`
action does not exist, and adding it to the grid would cross-product `read_self` onto all 20
modules — the exact thing `CLAUDE.md` §5 says the off-grid pattern exists to prevent.

**Two clean options:**
1. **Off-grid permission** — add `read_self` to the enum (migration) and seed a single
   `pay_statements:read_self`, exactly as `broadcast`/`business` were done. Follows precedent.
2. **No new permission at all** — make the endpoint authenticated + row-level self-scoped from the
   token, which is how document signing already works (`CLAUDE.md` §13.10: *"signing is ROW-LEVEL,
   not a permission"*). Simpler, and arguably more correct: every rep may see their own pay.

Option 2 is likely right — but it is a decision, and packet 03 as written assumes option 1 without
noticing it needs a migration.

### 4.3 Three packets each add a "wide frozen line" table

`payroll_report_lines` (02), plus whatever 05 freezes for spiff decisions, plus 09's layout
snapshots — all mirroring `client_statement_lines`. That is fine and intentional, but **write the
shared rationale once** (why a wide frozen line instead of a join at render time) and cite it from
each, rather than re-deriving it three times in three build-log entries.

### 4.4 Doc hygiene — three stale lines found while verifying

These are small, but each one is a trap for whoever reads it next:

| Where | Says | Reality |
|---|---|---|
| [docs/rate-grid.md](docs/rate-grid.md) closing note | statement pricing combines only `rate_kind='product'` | applies `tv_addon`/`hp_addon`/`bundle_bonus`/`spiff` too — packet 01 already flags this |
| `CLAUDE.md` §12 | *"Sales targets (RPT-008) deferred"* | `SalesTarget` + `TargetsService` + `/v1/sales-targets` are built |
| `CLAUDE.md` §12 last bullet | folder-per-week *"enforced in the SERVICE, not the DB"* | migration `20260629000000` added **two partial unique indexes**; §13.10 of the same file says so correctly |

---

## 5. Recommended sequence

The README's ordering is sound on dependencies but not on risk. One change and one split:

```
04 back-date handlers      ← MOVE UP. Fixes a live bug; unblocks loading real historical rates.
01 rate-grid load          ← then real money exists to verify against
02 payroll report          ← delivers payroll_report_lines (the actual dependency)
   ├── 03 rep pay statement    (settle §4.2 first)
   └── 09 configurable exports (last, as written)
06 bulk statements         ← small, independent, high operator value; slot anywhere
07 rate transparency       ← after 01; needs the #3 discipline review before code
10 expense categories      ← independent; mirror product_type_catalogue
08 configurable periods    ← wide blast radius; do when nothing else is in flight
05 teams + target spiff    ← BLOCKED on Redwave's 3 answers; Phase A can start now
```

**Why 04 first:** it is the only packet whose absence is currently costing anyone anything, it has
no dependencies, and 01's back-dated rate load exercises the very path 04 builds. Doing 04 before 01
means the rate-grid load can use the sanctioned import path for *every* config type rather than only
billing rates.

**Do not start 05 Phase B or 08 in parallel with anything.** Both change how money is attributed —
05 to a client document, 08 to which period a sale belongs to — and each wants an uncontested
verification run.

---

## 6. What I did not check

- The contents of the four `.xlsx` files in `docs/uat/` (including packet 01's `L3` formula and
  packet 02's exact column set) — binary; verify against the source workbook when building.
- Whether the eight internet product names and their rates in packet 01 are Redwave-approved.
  `docs/rate-grid.md` says to get a client sign-off on the grid **values** before entry; that has
  not visibly happened.
- Test-suite state — no suite was run for this report; every claim is from source inspection.
