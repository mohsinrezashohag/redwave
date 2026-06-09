# CLAUDE.md — Redwave ERP / HRM Platform

> Operational context for every Claude Code session on this project.
> Read this first. It is intentionally short. The detail lives in the design docs (see References).
> If anything here conflicts with a prompt, **the invariants in this file win** unless a human explicitly overrides them.

---

## 1. What this is

A custom ERP/HRM platform for **Redwave Marketing Inc.**, a telecom sales agency. Independent field reps ("distributors") sell internet/TV/home-phone for program partners ("clients": Valley Fiber, RF Now, CTI). The system automates the full pipeline: sales capture → validation → tiered commission → 70/30 holdback → clawbacks → bi-weekly pay run → expenses → client billing → documents/e-signature → reporting.

**This is a financial ledger first and an app second.** Correctness of money is the highest priority. Underpaying a rep is unacceptable.

This is a **greenfield build** — nothing is reused from any prior system. When the repo is empty, scaffold it per §4. References to a "previous system" describe mistakes to avoid, not assets to inherit.

### References (authoritative; read these for detail — do not duplicate them here)
These live in the repo and the tooling can open them directly:
- **`docs/BRD.md`** — business requirements (what the business needs).
- **`docs/SRS.md`** — system requirements, UI requirements, worked examples, state machine (how it must behave). Requirements are `<MODULE>-NNN`.
- **`docs/data-model.md`** — data dictionary (12 modules, 48 entities, surrogate UUID PKs). The visual ERD is **`docs/Redwave_Data_Model.drawio`** (open in diagrams.net).
- **`docs/architecture.md`** — layers, module boundaries, REST/OpenAPI contract. Visual: **`docs/Redwave_Architecture.drawio`**.
- **`docs/design-system.md`** — design language, tokens (light + dark), component library, states, screen blueprints. Visual colour swatches are in the companion `.docx`.

The client-facing `.docx`/`.drawio` originals may also be kept in `docs/`; the `.md` files above are the canonical in-repo reference for building.

---

## 2. Tech stack (LOCKED — do not deviate)

- **Single-stack TypeScript, end to end.** True modular monolith (one deployable).
- **Backend:** TypeScript + **NestJS** (one module per domain).
- **Frontend:** **React + TypeScript** (consumes the generated API client).
- **Database:** **PostgreSQL**. Exact `NUMERIC` for money. JSONB where the model uses it.
- **ORM:** **Prisma** (PostgreSQL). Money columns use Prisma **`Decimal`** (`@db.Decimal`, backed by Postgres `NUMERIC`) — **never `Float`/`number`** (#1). **Pay-run finalize (#8) and import commit run inside Prisma interactive transactions** (`$transaction`). Prisma owns the migrations (under `backend/prisma/migrations/`); `db/` documents/points to them. Pinned to **Prisma 6** — do not auto-upgrade to v7 (it drops `url` from the datasource block); the VS Code Prisma extension may flag this as an error, which is a false positive for our toolchain.
- **Schema conventions (data model is built — all 48 entities, `init` migration applied).** Models are **PascalCase + `@@map("snake_table")`**; **columns stay snake_case**, 1:1 with `docs/data-model.md`. Surrogate UUID PKs (`@db.Uuid`), business keys `@unique`, join tables composite `@@id`. **Money `Decimal(12,2)`**; non-money decimals: pct `(5,4)`, `*_km` `(10,2)`, `rate_per_km` `(6,3)`, lat/lng `(9,6)`. **Product types are a CONFIGURABLE catalogue** (`product_type_catalogue`, key PK + `behaviour` enum `tiered|greenfield|standard_addon`), NOT a fixed enum — the SA adds types at runtime (always `standard_addon`; the 4 core types are `is_system`, behaviour locked). `products`/`commission_flat_rates`/`incentives.scope_product_type` are String FKs → `catalogue.key`; `sale_items.product_type` stays a plain string snapshot (no FK, #2). `sale_items` snapshot fields are **nullable until paid** (#2). Polymorphic id columns (`audit_log.entity_id`, `notifications.related_entity_id`, `import_rows.matched_entity_id`) carry **no FK**. No cascade deletes (ledger preserves records).
- **API:** **REST, described by an OpenAPI 3 spec** — the spec is the contract/seam for backend, frontend, and the future mobile app.
- **Auth:** JWT bearer tokens. **RBAC enforced server-side** on every endpoint.
- **Files:** S3-compatible object storage; references stored in Postgres.
- **Background jobs:** in-stack job queue (exports, email, heavy aggregation).
- **Dates & timezone (canonical — America/Winnipeg).** Every date-boundary decision (which pay period a `sale_date` falls in, period start/end, "today"/"now" defaults) is made in **America/Winnipeg**, via `backend/src/common/timezone.ts` (`todayInWinnipeg()` → `'YYYY-MM-DD'`, `winnipegDateOnly()` → UTC-midnight `Date`; built on `Intl.DateTimeFormat('en-CA', { timeZone })` — DST-correct, no date lib). Dates are **stored + compared as `'YYYY-MM-DD'` parsed at UTC-midnight on both sides**, so the pure date logic (`resolvePayPeriod`, `selectEffectiveRate`) stays timezone-agnostic; **only** the `now`/`today` derivations are Winnipeg-zoned. This is what keeps a late-night sale (e.g. 23:30 Winnipeg = next-day UTC) in the correct period (#7). Never reintroduce a bare `new Date()` / `toISOString().slice(0,10)` for a date boundary — use the helper. (`timezone.spec.ts` covers DST + a boundary sale.)

Do not introduce a second language/runtime. The data-import module is **in-stack TypeScript**, isolated by boundary (it writes to staging tables), not by language. A separate analytics/ML service is a possible Phase-3+ decision only — not now.

---

## 3. THE INVARIANTS (never violate)

These are the rules that, if broken, produce wrong money or a privacy/security breach. Treat them as hard constraints.

1. **Exact-decimal money, never floats.** All monetary values use a decimal type / integer minor units. No `number` float arithmetic on money, ever. *In API DTOs money is a validated decimal **string** (never a JS `number`), stored as Prisma `Decimal` and serialized back as a string.*
2. **Sale-item snapshots are immutable.** When a `sale_item` is paid, its `tier_at_payment`, `rate_applied`, `commission_paid`, and `incentive_amount` are frozen. Never update a snapshot. Corrections happen via a **new** clawback/adjustment record.
3. **The two rate streams never mix.** `client_billing_rates` (what we charge the client) and the `commission_*` tables (what we pay the rep) are separate, with no code path that joins or combines them. (This was the prior system's core defect.)
4. **No in-system clawback date math.** The system does **not** compute or enforce 30/60-day windows. A clawback is entered manually when the client reports a cancellation, at any time. Recover the exact amount from the snapshot.
5. **Gross tally, never re-tier.** The commission tier is computed from the **gross** internet activation count for the period and applied to every internet activation in it. A cancellation **never** recalculates a period's tier. (Cancellations are flat clawbacks — see #6.)
6. **Clawback is a flat deduction.** A clawback subtracts the exact amount originally paid (incl. any incentive) from the rep's pay-run total. No 70/30 sequencing. Per `sale_item`, so one product can be clawed back without touching others on the same sale. *Built (`modules/clawback/`): entry targets a **PAID** `sale_item` (frozen `commission_paid` ≠ null, else 422); the amount is the engine's `computeClawbackAmount` from the snapshot (rate + incentive) — the snapshot is **never edited** (#2), the period is **never re-tiered** (#5), there is **no date math** (#6), and only the target item + its sale flip to `clawed_back` (one clawback per item). It is `pending` until a pay run deducts it, then `applied` + linked. The `CLAWBACK_TOTAL_PROVIDER` seam is rebound to `ClawbackPayrunProvider`; finalize calls `markApplied(...)` in its transaction so the deduction is recorded exactly once.*
7. **`sale_date` governs the pay period.** Not validation date, not activation date. `activation_date` is stored for reference only and **drives no logic**. *Built (Sales): `sales` has **no `pay_period_id` FK**, so the period is **derived** from `sale_date` via the pure `modules/sales/pay-period.logic.ts#resolvePayPeriod` (period whose `[start,end]` contains `sale_date`). Validation never touches `sale_date`. Pre-loading `pay_periods` is Pay Run's job — derived period is null until then.*
8. **Pay-run finalize is atomic and idempotent.** One DB transaction; an `Idempotency-Key` so a retry never double-pays or double-releases a holdback. Finalize is what freezes the snapshots (#2). *Built (`modules/payrun/pay-run.service.ts`): the whole finalize runs in **one `prisma.$transaction`** (a mid-step throw rolls back entirely). `pay_runs` has **no idempotency-key column**, so idempotency is **state-based** — re-finalizing a non-draft run is a no-op, plus freeze-once guards (sales become `paid`; one `holdback_ledger` row per rep+origin). Finalize freezes `sale_item` snapshots, transitions sales Validated→in_pay_run→paid, records the 30% hold, releases due prior holds, applies bonuses, composes net.*
9. **Greenfield is excluded from the tally** and flat-rated; the tally is computed from each sale's **confirmed state at period close**.
10. **Configuration is effective-dated, read at runtime — never hard-coded.** Tiers, rates, holdback %, incentives, products, billing rates. A change is a new effective-dated row; it never rewrites a closed period. *The supersession pattern is a **shared pure module** `common/effective-dating.ts` (`planSupersession`/`selectEffectiveRate`/`deriveStatus`): a new future row **supersedes** the scope's pending row (deleted) and **bounds** the current row's `effective_to` to the day before; **back-dating is rejected (422)**; selection picks the row in force on a date. Used by Clients billing rates (scope = client+product+rate_kind) and Commission Config (tier schedule = global; flat rates = per product_type; holdback split = global). The holdback-**release** setting is sticky (latest wins), not supersession-dated.*
11. **Rep codes are never reused** — including codes of terminated reps. Enforce uniqueness at the DB level. *Built in `modules/hrm/reps.service.ts`: a **case-insensitive service pre-check** across **all** reps (any status) rejects reuse with `409`, with the DB `@unique` as a backstop. Termination is a **soft status change** (never a delete), so a terminated rep's row persists and its code stays reserved. rep_code is immutable after creation.*

---

## 4. Target repo structure (scaffold to this)

This is a **monorepo** named `RedWave/`. Scaffold to this layout:

```
RedWave/
  CLAUDE.md        this file (repo-root context, read every session)
  docs/            the markdown specs above + the .drawio / .docx originals
  contract/        OpenAPI 3 spec (source of truth) + generated TS types
  backend/         NestJS app
    src/modules/
      auth/        auth & RBAC + account/profile + theme (build FIRST)
      hrm/         reps, documents, equipment
      clients/     clients, products, billing rates
      commission/  tier/flat/holdback config + incentives
      engine/      Commission Engine (PURE, isolated — see §6)
      sales/       sales, sale_items, validation, Sale ID
      payrun/      pay periods, runs, lines, holdback ledger, ADP export
      clawback/    cancellation recoveries
      expenses/    reports, items, km logs, exports
      billing/     statements, invoices
      documents/   documents, signature requests, signatures
      import/      data import & integration (staging → commit)
      reporting/   dashboards, leaderboard, notifications, chatbot
    src/common/    decimal utils, RBAC guard, audit interceptor, errors
  frontend/        React + TS app (consumes contract/ generated client)
  db/              migrations (versioned, ordered) — Prisma-managed; the actual SQL lives in `backend/prisma/migrations/`, this dir documents/points to them
```

One module = one NestJS module owning its tables and endpoints. A module calls another's **defined interface**, never reaches into its internals.

**Seeding & clean-wipe (`backend/prisma/`).** Two operator scripts share one bootstrap:
- `seed/bootstrap.ts` — the **genesis catalogue** the system needs day-one (RBAC 15 modules/90 perms, 4 built-in roles, Super Admin, Schedule C v2 commission config, 2026 pay periods, expense/notification/chatbot configs). Idempotent upserts; **an existing Super Admin password is never overwritten**.
- `seed/demo.ts` — a rich, **idempotent** demo (re-running wipes + regenerates transactional data — never duplicates) anchored to the **run-time current pay period** so the leaderboard/dashboards are live whenever it runs: 3 clients (VF/RF/CTI) + own products + billing rates, a manager + 8 reps (`RW-D-*`), sales across three cycles spread by `sale_date`, a **finalized** prior cycle (70/30 + holdback), clawbacks, a statement, expenses (incl. a KM log), notifications, a pending signature. It drives the **real services** so every invariant holds (#8/#2/#5/#6/#3).
- `seed/wipe.ts` — FK-safe child→parent delete of **transactional tables only** (schema has no cascades; the DB RESTRICTs hard deletes). `seed.ts` (entry, `npm run prisma:seed`) = Nest context → bootstrap → demo. `reset.ts` (`npm run seed:reset`) = the **handover clean-wipe**: guarded by `RESET_CONFIRM=yes`, it wipes transactional data and re-seeds the bootstrap, **keeping the master catalogue** (login, roles, clients, products, reps, commission config, pay periods, chatbot config). Demo logins use `DEMO_PASSWORD` in `seed/demo.ts` (rotate via the UI).

---

## 5. RBAC (enforce server-side, every endpoint)

- Every endpoint declares the `(module, action)` permission it requires (see the API reference). `action` ∈ view/create/edit/approve/delete/export.
- An RBAC guard checks the caller's effective permissions (union of their roles' grants) on **every** request. Missing permission → `403` + audit-log entry.
- **Data scope is enforced in the query, not the response filter.** A rep reads only their own data; a manager only their roster; Super Admin all. The Business/Executive dashboard is **Super Admin only** — partner financials never exposed to anyone else.
- Two reps must never be able to see each other's earnings. The leaderboard shows **counts only, never money**.

### Implementation (built — Auth & RBAC module). Reuse this pattern in every module.
- **Two global guards** (`backend/src/common/guards/`, registered as `APP_GUARD` in `AuthModule`, in order): `JwtAuthGuard` authenticates (verifies the access JWT, loads the user + roles→permissions fresh each request, **rejects inactive users** → immediate revocation) then `PermissionsGuard` authorizes.
- **Decorators** (`backend/src/common/decorators/`): `@Public()` skips auth (login/refresh/health); `@RequirePermission(moduleKey, action)` declares the gate; `@CurrentUser()` injects the `AuthUser`. A route with no `@RequirePermission` is **authenticated-only**.
- **Permission identity is the string `moduleKey:action`** (e.g. `users:view`); effective permissions = the union of the user's roles, built by `buildEffectivePermissions` (`common/rbac/permissions.util.ts`). Denial → `403` **and** an `access_denied` audit row.
- **Query-level scoping** lives in `ScopeService` (`common/scope/`): `all` / `roster` / `self` rep-id scope, plus profile-review routing. Apply `where: { rep_id: { in: … } }`; never filter after fetch.
- **Auditing is explicit** at the service layer via `AuditService` (`common/audit/`, `@Global`) — accurate before/after — not a magic interceptor; the guard logs denials.
- **Auth stack:** `@nestjs/jwt` with **custom guards (no passport)**; **access + refresh** tokens (separate secrets, env `JWT_*`); password hashing with **bcryptjs** (`password_hash` never selected/returned). **TTLs are ms-strings (not coerced):** `JWT_ACCESS_TTL` (`'15m'`) / `JWT_REFRESH_TTL` (`'7d'`) are passed **verbatim** to `signAsync({ expiresIn })` — jsonwebtoken parses the string natively. Do **not** wrap them in `parseInt`/`Number` (that yields `15`/`NaN` ms → tokens expire instantly, the classic "logged out within a minute"). `token.service.spec.ts` locks the access call to `expiresIn: '15m'` (string). The premature-logout bug was **not** here — it was the frontend refresh clearing the session on transient failures; see the §13 auth note.
- **HR-field profile edits** (name/phone/avatar) go through `ProfileChangeRequest` review (`account` module) — never a direct write; **theme applies instantly**. (SRS §4.4)
- **RBAC catalogue:** 17 module keys + 6 actions seeded as the standard grid (the 17th is **`billing_rates`** — its full 6-action set gates the client billing rate cards, **granted to Super Admin only** by default so partner financials aren't visible to every `clients:view` holder; a custom Business-Partner role can be granted `billing_rates:view`), **plus two off-grid permissions `notifications:broadcast` + `reports:business`** (each kept off the module×action grid so the action doesn't cross-product onto every module: `broadcast` gates the manual broadcast, `business` gates the business/executive dashboard + cross-period trends); 4 built-in (`is_system`) roles (`prisma/seed.ts`, idempotent). `broadcast` and `business` are added to the `PermissionAction` Prisma enum (migrations) and granted to **Super Admin only** (already in the SA's all-perms grant); each is seeded by an explicit `permission.upsert` after the grid. Built-in roles can't be deleted/renamed (RBAC keys off names like `Super Admin`). Module keys live in `common/rbac/rbac.constants.ts`. The `permissions` table carries `@@unique([module_id, action])`. **The catalogue is unchanged by the global-search endpoint** — `/v1/search` adds **no new permission**; it reuses the per-entity reads (`hrm:view`/`clients:view`/sales scope) to gate each result group.
- **API surface:** all routes under **`/v1`** (URI versioning; `/health` is version-neutral); Swagger UI at **`/docs`**; `npm run contract:export` writes the spec to `contract/openapi.yaml`.
- **Global error envelope (built — `common/filters/all-exceptions.filter.ts`, Batch A #1).** One `APP_FILTER` (`@Catch()`, registered in `app.module.ts` like the global guards) normalizes **every** error to the contract envelope **`{ error: { code, message, details } }`** (arch §5.1), statuses preserved. Three classes: **`HttpException`** → `CODE_BY_STATUS[status]` (400→`BAD_REQUEST`, 401→`UNAUTHORIZED`, 403→`FORBIDDEN`, 404→`NOT_FOUND`, 409→`CONFLICT`, 422→`UNPROCESSABLE_ENTITY`), message from the response (array joined → `details.messages`), structured payloads (billing's **`unpriced`**, the import gate) preserved into `details`; **`DomainError`** (the **framework-free** marker `common/errors/domain-error.ts` — extends `Error`, **no `@nestjs/common` import**, carries `code`/`message`/`details?`) → **422**; **anything else** (bare `Error`, Prisma, the engine's internal-invariant throws) → **masked 500** generic message + `details.correlationId` (`randomUUID()`) + a server-side `Logger.error` (no internal leak, arch §11). **Map a client-fault domain error at the service boundary**, never inside pure/mirrored logic: e.g. `tier-schedule.service` wraps the pure `validateTierBrackets` bare-`Error` in `DomainError('TIER_SCHEDULE_INVALID', …)`; the engine throws are **left bare → stay 500** (real server faults, NOT 422). Contract: `ErrorEnvelopeDto` is registered via `extraModels` (in `main.ts` + `scripts/export-openapi.ts`) so the envelope is documented in `components.schemas` (per-endpoint `@ApiResponse` wiring still deferred — responses are `never`-typed). FE companion: `frontend/src/lib/query/unwrap.ts` reads `body.error.message`/`body.error.details`. **Reuse `DomainError` for any new client-fault domain rule** instead of returning a bare `Error` (→ 500) or coupling pure logic to Nest.
- **Sensitive-PII gating (built, HRM):** sensitive fields are **redacted in the query/response server-side**, gated on a permission — e.g. rep `payment_details` and document `file_url`s require **`hrm:edit`** (a plain `hrm:view` caller gets them nulled), computed from `user.permissions.has(permissionKey(...))`. Sensitive values are also kept **out of audit payloads**. Reuse this redaction pattern for other PII.
- **Sale lifecycle + Sale ID (built, Sales):** the **§16 state machine** is the authoritative pure model in `modules/sales/sale-status.logic.ts` (`assertTransition` → 409 on any invalid move); Sales owns create→entered, validate (entered→validated), delete (entered|validated→**soft** `status=deleted`); in_pay_run/paid/clawed_back are triggered by Pay Run/Clawback. The composite **Sale ID** is pure (`sale-id.logic.ts`: `sale_date[-mpu]-client`, duplicate → `-1/-2`, never blocked). Sales **produces activations only** — `sale_items` snapshot fields stay **NULL** until Pay Run (#5/#2). Reads/mutations are **scoped via `ScopeService`** in the query (rep=own/manager=roster/admin=all).
- **Pay Run composes, never reimplements (built, `modules/payrun/`):** finalize gathers a rep's validated sales → `mapToEngineProductType` (greenfield internet → `greenfield_internet` flat $100 at close, #9) → **`CommissionConfigProvider.getEngineConfig`** → **`CommissionEngineService`** — it never re-derives tiers/commission (#5). Engine result (decimal.js) → Prisma `Decimal` via `.toFixed(2)` at the write boundary. Net = 70% advance + released 30% + expenses + incentives (full) + bonus − clawbacks; the 30% held goes to `holdback_ledger`. **Expenses & Clawbacks are injected seams** (`EXPENSE_TOTAL_PROVIDER`/`CLAWBACK_TOTAL_PROVIDER`, default zero) — those modules re-bind the token later without touching Pay Run.

---

## 6. The Commission Engine (isolated — get this right)

The most important piece. Build it **first, in isolation, against tests, before anything depends on it.**

- **Pure & deterministic:** given a rep's activations for a period + the effective config, it returns tier, per-item amounts, and totals. No side effects. Same inputs → same outputs.
- **Config-driven:** reads tiers/flat-rates/incentives by effective date. Nothing hard-coded.
- Implements invariants #5, #6, #9.

### Mandatory test fixtures (must pass before use)
- **$3,310 case:** 20 internet → Tier 2 ($145) = $2,900; +4 TV ($30)=$120; +3 HP ($30)=$90; +2 greenfield ($100)=$200 → gross **$3,310**; 70% = $2,317.00, 30% = $993.00.
- **Cross-client aggregation:** 3 VF internet + 9 RF internet → tally **12 → Tier 3** → all 12 at **$125**. (Per-client tallies are wrong.)
- **Tier boundary:** 16 internet → Tier 3 ($125); 17 internet → Tier 2 ($145).
- **Per-product clawback:** a household's TV cancels → **−$30 flat**; the internet activation is untouched; the period is **not** re-tiered. (If a $20 incentive was on the TV, clawback = $50.)

### Tier schedule (Schedule C v2)
| Tier | Gross internet tally | Rate/activation |
|---|---|---|
| 4 (entry) | 0–6 | $110 |
| 3 | 7–16 | $125 |
| 2 | 17–35 | $145 |
| 1 (highest) | 36+ | $160 |

Flat: Greenfield internet **$100** (excluded from tally), TV **$30**, Home Phone **$30**. (Flat rates are a **keyed map** `Record<key, Decimal>` in the engine, not a fixed trio — an SA-added `standard_addon` type is priced by its own effective-dated flat rate; the tally stays `=== 'internet'` and greenfield mapping is unchanged, so #5/#9 are provably preserved.)

### Implementation (built — `backend/src/modules/engine/`)
- **Pure & isolated:** `CommissionEngineService` has no constructor deps and imports **only**
  `decimal.js` + `@nestjs/common` (the `@Injectable`/`@Module` DI markers) — **no `@prisma/client`,
  no DB, no HTTP, no other module**. Tested by direct instantiation. All 4 mandatory fixtures + 7
  edge groups pass (`commission-engine.service.spec.ts`).
- **Money = `decimal.js`** (not `@prisma/client`'s re-export), so the engine is Prisma-free. The
  future Pay Run converts `Prisma.Decimal` ↔ `Decimal` at its boundary (same lib underneath).
- **Incentives are SEPARATE from the 70/30 split:** gross (the split base) = **tier+flat only**;
  incentives are reported as `incentiveTotal` and paid in full (matches `pay_run_lines.incentive_total`).
  Per-item `commissionPaid = base + incentive` is the snapshot the clawback reads.
- **Split rounding (durable):** `advance = roundHalfUp(gross × advancePct)`, `holdback = gross −
  advance` — derived so the two always sum to gross exactly (no lost cent). HALF_UP, applied only at
  the split; passed per-call (no global decimal.js config mutation).
- **`per_activation` incentives** computed (scope + sale_date window); **`target_based` deferred** (§12).
- **Config provider (built — `modules/commission/commission-config.provider.ts`) closes the loop:**
  `getEngineConfig(date)` reads the effective-dated config and returns the typed `EngineConfig` the
  engine expects. **This is the Prisma.Decimal → decimal.js boundary** (keeps the engine pure).
  Proven end-to-end (seeded Schedule C v2 → provider → engine → **$3,310** / 2317.00 / 993.00, and
  cross-client 3 VF + 9 RF → Tier 3 → 1500). The engine — not the config module — determines tiers (#5).

---

## 7. Frontend & UX standards (enforced — not optional)

The product must feel **fast, polished, and purpose-built — never generic.**

- **No generic AI/template aesthetic.** Do **not** use the default framework palette, cookie-cutter card grids, or stock spacing. Use the project's **defined design system** (tokens, components, type scale, motion) — see the Frontend Design System doc. Never invent a one-off color, font size, or spacing value; use a token.
- **One design system, applied consistently.** Every screen uses the same components and tokens. Buttons, inputs, dropdowns, radios/checkboxes, file uploads, tables, modals, toasts, hero/header/footer — all come from the shared component library.
- **Performance:** fast first load; navigation feels instant; long lists virtualized + paginated; optimistic UI where safe; no layout shift.
- **Responsive:** clean from mobile width upward; the future mobile app shares the same API.
- **Accessible:** keyboard-navigable, sufficient contrast, labelled controls, focus states.
- **Every interactive element has all its states:** default, hover, focus, active, disabled, **loading, empty, error, success**. Nothing fails silently — every action shows feedback.
- **CRUD pattern:** list views have filtering, sorting, pagination, and clear row actions; forms validate inline with helpful messages; destructive actions confirm.
- **Data/analytics widgets** (dashboards, leaderboard) are readable at a glance: clear hierarchy, real units, no chartjunk.

If a design decision isn't covered by the design system, **stop and ask** rather than improvising a generic solution.

---

## 8. Workflow

- **Plan first.** Use Plan Mode to explore and produce a reviewed plan per module before writing code. Don't free-code a whole module unprompted.
- **Build order:** (1) Auth & RBAC → (2) Commission Engine against its fixtures → (3) Sales, Commission Config, Clients/Products, HRM → (4) Pay Run, Clawback, Expenses → (5) Billing, Documents, Import, Reporting. Frontend builds against the OpenAPI contract in parallel throughout.
- **Contract-first.** The OpenAPI spec changes **deliberately** and is reviewed; it is not a side effect of a code change. Regenerate the typed client when it changes.
- **Tests for money paths are mandatory**, not optional — Commission Engine, pay run, clawback, holdback release. Use the §6 fixtures.
- **Migrations are versioned and ordered**; never hand-edit production schema.
- **Parallel-run** the pay run against the manual Excel process for 1–2 cycles before cutover.

---

## 9. Comment standard

Every business rule in code cites its source so future developers can trace it:

```ts
// Gross tally; cancellations never re-tier the period. — BRD §4.1 / SRS COMM, SALE
// Clawback is a flat deduction from the pay-run total; no 70/30 sequencing. — SRS CLAW-006
```

Each module file starts with a short header: its responsibility, its inputs/outputs, and the entities it owns. Prefer clear names over clever code in financial paths.

---

## 10. Common mistakes to avoid (this project specifically)

- ❌ Re-tiering a period when a sale cancels. → It's a **flat clawback**; tier is fixed at close. (#5, #6)
- ❌ Joining client billing rates with commission rates "to be efficient." → **Never.** (#3)
- ❌ Building 30/60-day clawback window logic. → The system does **no** date math; clawbacks are entered manually. (#4)
- ❌ Using `sale_date` vs `validation_date` vs `activation_date` interchangeably. → **`sale_date` governs.** Activation date is reference-only. (#7)
- ❌ Floating-point money. → Exact decimal only. (#1)
- ❌ Mutating a paid `sale_item` to "fix" it. → Snapshots are immutable; create a new record. (#2)
- ❌ Counting internet tally per-client. → Tally aggregates across **all** clients for the rep. (§6)
- ❌ Counting greenfield toward the tier tally. → Greenfield is excluded and flat-rated. (#9)
- ❌ Enforcing access by hiding UI controls. → RBAC is **server-side**, scoped in the query. (§5)
- ❌ Shipping generic default-palette UI. → Use the defined design system; ask if uncovered. (§7)
- ❌ Writing a profile edit straight to the user record. → HR-field edits go through `profile_change_requests` review; only the theme preference applies instantly. (SRS §4.4)

---

## 11. Keeping this file current (read this)

This file is the project's **persistent memory**. Claude Code loads it at the start of **every** session — it is not a one-time prompt. There is no hidden memory between sessions beyond what is written in the repo (the code and these docs). So:

- **When a durable decision, convention, or invariant is established, record it here** (or in the relevant `docs/*.md`) — not only in chat. Chat is forgotten next session; this file is not.
- Examples worth recording: a new business rule confirmed by Redwave, a naming/folder convention, a resolved ambiguity, a gotcha discovered during the build, a change to the build order.
- After completing a meaningful piece of work, it is good practice to ask: *"does anything here need updating in CLAUDE.md?"* — and if so, update it in the same session.
- Keep it **lean**: record the rule, not the discussion. Point to `docs/*.md` for detail rather than pasting it in.
- A **stale** CLAUDE.md is worse than none — it misleads. If something here is no longer true, fix it immediately.
- When the three flagged items in **SRS §17** (holdback release timing, greenfield-at-close, current-cycle cancellation) are confirmed by Redwave, record the confirmed rule here and remove the "proposed" caveat.

---

## 12. Deferred items (to revisit)

- **`roles.status` for soft-deactivation of roles.** AUTH-003 says the Super Admin can *deactivate* custom roles, but the data model has no status column on `roles`, so role removal is currently implemented as **delete-of-custom-only** (built-in roles blocked with `409`). Add a `roles.status` (active/inactive) field in a future migration and switch the "deactivate" path to a soft status change rather than a hard delete.
- **`target_based` incentives in the Commission Engine.** Commission Config can now **create/store** `target_based` incentives (modeled, flagged), but the engine still **does not apply** them — its exact rule (one-time bonus vs per-activation after threshold) isn't pinned down in the SRS. Confirm the rule with Redwave, then implement it in `CommissionEngineService` and add fixtures.
- **Holdback-release timing (SRS §17.1, PROPOSED).** Commission Config persists the bulk/sticky setting only: `release_rule` is stored as a **free string** (latest wins) and is **not interpreted** here. The Pay Run module will interpret which cycle a period's 30% releases into — confirm the rule with Redwave before building that logic.
- **Back-dated / historical billing-rate loading (DONE — Import).** Clients & Products rejects a past `effective_from` (422) to protect closed periods; historical rates load through the **Import** module's `master_migration`+`clients` path (`billing-rate.handler.ts`, reconcile-gated, writes `client_billing_rate` directly, #10). The live POST still rejects back-dating.
- **`rate_kind ↔ product_id` pairing rules.** Currently only `rate_kind='product'` is required to carry a `product_id`; add-on kinds (tv_addon/hp_addon/bundle_bonus/spiff) may be client-wide (null product). Confirm with Redwave whether any add-on kind must (or must not) target a product.
- **Object-storage upload wiring (DONE — HRM rep documents; equipment has no file column).** Rep documents upload for real: `POST /v1/reps/{id}/documents` is multipart (PDF/image → `StorageService.upload('rep-docs', …)`, storing the object **path**; the `hrm:edit` redaction of `file_url` is preserved) + `GET /v1/reps/{id}/documents/{docId}/file-url` (`hrm:edit`, short-TTL signed URL). `RepEquipment` has **no file column** — if Redwave wants an equipment agreement/photo, add a column via migration then wire it the same way.
- **Dedicated `reps.contact` column.** Rep contact is currently sourced from the optional linked user (`rep.user_id → users.email/phone`); reps without a login have no separate contact. If Redwave needs contact on login-less reps, add a `reps` contact (phone/email) column via migration.
- **Greenfield two-step at close (SALE-006/§17.2, PROPOSED).** Sales captures the confirmed flag as `sale.is_greenfield` + per-item `sale_item.counts_toward_tally` (`= internet && !is_greenfield`), set at entry and at validation. **Pay Run** must, at period close, map a greenfield internet activation to the flat **$100** rate (engine `productType=greenfield_internet`) when building engine inputs — Sales never runs the engine. Confirm the rule with Redwave.
- **Bulk-validation ↔ Import boundary (DONE — Import).** Sales implements **queue bulk-select** validation (`POST /v1/sales/bulk-validate`) and now exposes the tx-aware `SalesService.validateWithinTx`. The **client-report ingestion** (MPU matching, manual reconciliation, atomic commit) lives in the **Import** module (`client_report`+`sales`), which drives `validateWithinTx` inside its commit transaction. Real Excel/CSV parsing is still stubbed (rows fed).
- **Holdback-release timing in Pay Run (SRS §17.1, PROPOSED).** Finalize schedules each 30% hold via the pure `modules/payrun/holdback-release.logic.ts#resolveScheduledReleasePeriod` (default `next_cycle_after_30_days` = first period with payday ≥ origin payday + 30d). Confirm the exact rule with Redwave and change that one function.
- **Expense ↔ Pay Run seam (built, rebound; ITEM-FIRST).** `EXPENSE_TOTAL_PROVIDER` is bound to `ExpensePayrunProvider` (`modules/expenses/`); **read-only** (no finalize hook — unlike Clawback). It sums approved expense **ITEMS** directly by `{rep_id, pay_period_id, status:'approved'}` — each item's `pay_period_id` is derived from its **own `expense_date`** at create (EXP-009), so an approved item pays in the cycle of its date and Pay Run's finalize idempotency pays it **exactly once**. Pay Run finalize is **unchanged** (`expense-payrun.provider.spec` asserts the item-level where + no report join). Edge: an item **approved after** its period was already finalized is never auto-paid — needs manual re-assignment to an open period (no `paid_in_pay_run_id` column).
- **Clawback ↔ Pay Run seam (built, rebound).** `CLAWBACK_TOTAL_PROVIDER` is now bound to `ClawbackPayrunProvider` (`modules/clawback/`); finalize gained one hooked line `markApplied(rep, period, run, tx)` inside its transaction (atomic pending→applied + link). Two known edges: (a) a clawback entered *during* a finalize (admin-gated, rare) could be marked-but-not-deducted or vice-versa — acceptable now, revisit if concurrent entry becomes real; (b) a clawback for a rep with **no validated sales** in the period being run is not applied until their **next run that has a line** (it stays pending) — fine for active reps, but a terminated rep with a trailing clawback would never have it applied.
- **`pay_run_exports` table (PAY-010).** The data model has no pay-run export table, so the ADP export is currently generated, the run marked `exported`, and the **audit row is the stored record**. Add a `pay_run_exports` table (file_url/format/generated_by, like `expense_exports`) if the artifact must be persisted.
- **Expenses built (ITEM-FIRST; per-item approval).** `modules/expenses/` — the **expense item is the atomic unit**: `expense_items` gained `submitted_by`/`status`/`approved_by`/`approved_at`/`rep_id`/`pay_period_id` (derived from `expense_date`, EXP-009) and `expense_report_id` is **nullable** (the `expense_reports` table is kept for history/optional grouping; new items are report-less — migration `expense_items_item_first` backfills + applies with `migrate deploy`). Endpoints at **`/v1/expense-items`** (`ExpenseItemsController`): create one/**several** in a tx, paginated+scoped list (filters status/category/rep/client/period/date/search), per-item edit, **per-item + bulk review** (`/bulk-review`), delete. The **km log is pure** (`km.logic.ts`: single −30 / round −60, floor 0, `$0.45/km`); the km amount is **server-authoritative**. Approval is **per item** (submitted→approved/rejected/sent_back); **edit-gating** (EXP-007): pre-approval needs `expenses:edit` (Manager/Admin), **after approval only Super Admin**; delete (not-yet-approved) needs `expenses:delete` (Admin/SA). KM dedup is **one per (rep, expense_date)**. Receipt is **config-driven** (`expense_field_configs.requires_receipt`). Meal eligibility = approver judgement. Scoping reuses `ScopeService` (own = `submitted_by`, roster = `rep_id ∈ roster`, all). Seed grants: Admin gained `expenses:delete`.
- **Expense KM Maps + receipt storage (WIRED, env-gated, graceful).** **Distance:** `MapsService` (`GOOGLE_MAPS_API_KEY`) re-derives the authoritative route distance from the stops via the Directions API; falls back to the client `total_km` when no key / stub coords / error. FE (`VITE_GOOGLE_MAPS_API_KEY`, `@react-google-maps/api`) does Places autocomplete + a route map + auto-distance, else manual entry. **Receipts:** `common/storage` `StorageService` (Supabase) + `POST /v1/expense-receipts` (multipart) returns a signed URL; falls back to a selection-only reference when unconfigured. Both never block the build/tests without keys.
- **Expense km-rate config.** The km rate is the **constant `0.45 $/km`** (`km.logic.ts#DEFAULT_RATE_PER_KM`) — there is no rate-config table. If Redwave changes the rate or wants it effective-dated, add a config row + read it at submit (reuse the effective-dating pattern).
- **Configurable expense categories beyond the 7 enum values.** `expense_field_configs` is an open catalogue (label/requires_receipt/is_active), but `expense_items.category` is bound to the **`ExpenseCategory` enum** (km/meals/hotel/flight/rental/gas/other). A new `category_key` is catalogue-only until an **enum migration** adds the value; the POST endpoint accepts the config row but items can't use it yet.
- **Expense export (FE file = real; server record = stub).** The FE generates the actual **CSV/Excel/PDF** client-side via the Batch-1 `ExportMenu`/`exportRows` (per-item rows or grouped daily/weekly/monthly buckets). The **server-recorded** `POST /v1/expense-exports` still writes an `expense_exports` row with a **stubbed `file_url`** (`s3://…`) — the server-side render + object-storage upload is still deferred (reuse `common/storage`).
- **2026 pay-period anchor/payday offset.** The seed generates a standard bi-weekly schedule (anchor Sunday `2026-01-04`, payday = close + 13d). Confirm the exact Redwave 2026 schedule + payday offset; adjust `pay-periods.seed-data.ts` if needed.
- **Billing built (read-only over sales × `client_billing_rates`; computes no commission).** `modules/billing/` — per client+period: **client statement** (one line per **sale** = customer/household, `products_summary` + `line_total`) and one-line **commission invoice**. **#3 is the law here**: priced **solely** from `client_billing_rates` (only `rate_kind='product'`, effective on each **sale_date** via the shared `selectEffectiveRate`, #7/#10) — **zero** path reads `commission_*`/engine; the pure `statement.logic.ts#buildStatement` is reused by the invoice so `total_commission` == statement `total_amount` (billing stream only). Asserted by `billing.no-commission.spec` (structural source scan + behavioral throw-on-touch Prisma mock + total equivalence). Confirmed rules: **invoice total = billing-stream statement total** (NOT rep payout); **missing rate → 422** (never silently under-bill); confirmed sales only (`validated|in_pay_run|paid`), excluding clawed-back sales **and** clawed-back items; **NO GST** (no tax field); **replace-in-place** regeneration per (client, period) in a txn (no `@@unique`, no silent dup). **No `ScopeService`** (per-client partner data, RBAC `billing:{view,create,export}`, Admin/Super Admin only). No seam, no migration, no Pay Run change.
- **Billing add-on `rate_kind` pricing (deferred).** Only `rate_kind='product'` is applied when pricing a statement; the add-on kinds (`tv_addon`/`hp_addon`/`bundle_bonus`/`spiff`) are **not yet combined into line totals** — their combination rules aren't pinned down. Confirm with Redwave, then extend `StatementService.priceClientPeriod` (the pure `buildStatement` already sums whatever priced items it's given).
- **Real billing export generation.** `POST /v1/statements/{id}/export` and `/v1/invoices/{id}/export` (and generation itself) set a **stubbed `file_url`** (`s3://…`); the actual Excel/PDF render + object-storage upload is deferred (same as HRM/Expenses). Wire the storage provider + generator. There is **no `billing_exports` table** — the `file_url` lives on the statement/invoice row and the audit row records the export.
- **Documents & E-Signature built — REAL storage + in-system stamping (no e-sign vendor).** `modules/documents/` — upload (real PDF → Supabase) → share + **place fields** → sign (server **stamps** a per-signer copy) / decline / sign-upload → final all-signatures copy, with the overall status **derived** by the pure `document-status.logic.ts` (`deriveRequestStatus`/`deriveDocumentStatus`) + recomputed in a `$transaction` after every action (`status.recompute.ts` — UNCHANGED). **Share == signature request** (no shares table; DOC-002); recipients become the **visibility** set — a user sees only documents they own or are a recipient of, **Admin/Super Admin see all** (user-based `OR` in the query, NOT `ScopeService`). **Decline is terminal**. **RBAC maps to the real 6 actions**: upload + request = `documents:create`; reads + the `…/file-url` endpoints = `documents:view`; **sign / sign-upload / cancel + `/v1/signatures/{id}/file-url` carry NO permission** — authenticated + row-level (recipient / requester-owner-admin), per arch §6.10. Re-acting → 409. **Storage model (the law):** files (original, per-signer copy, final copy, saved-signature images, rep docs) live in Supabase by **object PATH**; bytes are served only via short-TTL signed URLs minted by the visibility-gated `…/file-url` endpoints — never public; `Document.original_file_url` is **set once, never mutated** (DOC-001/004). **Stamping** = `pdf-lib` (`stamp.service.ts` + the pure `stamp.logic.ts`: top-left-fraction → pdf-lib points, unit-tested) — loads the original, draws each field (signature/initial → image, date → signing date, text → typed value), uploads a NEW object; graceful no-op when storage is off. **PDF-only** at upload (non-PDF → 422; Word→PDF conversion deferred, §12). **New entities** (migration `20260610130000_documents_esign_real`): `signature_fields` (per request/recipient: type signature|initial|date|text, page, normalized x/y/w/h, value_text/value_image_path) + `user_signatures` (per-user saved reusable signature, method, is_default) + `signature_requests.completed_file_path`. **Saved signatures** = own-scoped `/v1/account/signatures` CRUD (no module permission). Signature events (request/sign/complete) emit via the **`NOTIFICATION_EMITTER` seam** (rebound by `NotificationsModule`). decline/sign time+IP in the **audit_log** (DOC-007). Seed unchanged (`documents:create` already on Manager + Sales Rep; **no new permission** — saved signatures + field placement + file-url all ride existing gates).
- **Data Import & Integration built (stage → reconcile → commit; atomic + idempotent #8).** `modules/import/` — the generic pipeline over `import_batches`/`import_rows`. **Stage** classifies each fed row (file upload stubbed; rows in the request body) via pure logic (`mapping.logic` `applyMapping`, `matching.logic` `classify{Sales,Rate,Holdback}Row`) → `matched/unmatched/duplicate/error/ignored` + counts. **Reconcile** (match/edit/ignore) recomputes counts. **Commit** runs the pure `reconcile-gate.logic#evaluateGate` (block while any row is unmatched/duplicate/error; `balance_migration` must also reconcile to the **operator-provided** `reconcile_total`, IMP-007) then applies all rows in **one `prisma.$transaction`** — a throw rolls back the entire batch (stays `staged`, retryable); re-committing a `committed` batch is a **no-op** (state-based idempotency, no key column). Three supported pairings: **`client_report`+`sales`** drives `SalesService.validateWithinTx(tx,…)` (entered→validated, atomic, never reimplemented); **`master_migration`+`clients`** inserts back-dated `client_billing_rate` rows directly (the sanctioned #10 path, bypassing the Clients 422); **`balance_migration`+`holdback`** inserts opening `holdback_ledger` entries (`release_status='scheduled'`, target via the shared `resolveScheduledReleasePeriod`). **Opening-holdback no-double-count is structural**: origin must be a **closed/paid** period (open origins rejected at stage) that Pay Run never re-finalizes, so its freeze-once guard never recreates the hold; it releases **once** when the scheduled period finalizes (proven by smoke). RBAC per arch §6.11: create/view/edit + **commit = `import:approve`** (Admin/Super Admin). **Sales seam added:** `SalesService.validateWithinTx(tx,id,dto,user)` (public `validate` wraps it + audits; `loadScoped` gained an optional tx). ImportModule imports SalesModule (one-directional).
- **Import deferrals.** **Historical/paid sales LOAD** (`master_migration`+`sales`) is unsupported (rejected at stage) — reconstructed paid snapshots conflict with #2 (frozen only by Pay Run) and #5 (engine owns tiers); confirm the go-live rule then build. **No `import_batch_id`/`migration_origin` column** on live targets (sales/client_billing_rates/holdback_ledger) — SRS §15.4 implies one, but schema is frozen; traceability is **one-directional** via `import_rows.matched_entity_id` → the live id (+ batch `source_type`). Add the columns via migration if reverse (entity→batch) lookup is needed. **`mixed` import_type** unsupported. **Field-mapping CRUD/editor** deferred (a saved `import_field_mappings.mapping_json` is applied if `field_mapping_id` given; else identity). **Real Excel/CSV parse + file upload** stubbed (rows fed; `source_file_url` is a stub `s3://…`).
- **Reporting & Dashboards built (read-layer; NO money recompute; leakage-scoped).** `modules/reporting/` — the final backend module: four role-scoped dashboards, a counts-only leaderboard, notifications, and a scoped read-only chatbot. **Every read is scoped server-side**: **rep** dashboard scopes to `user.repId` *directly* (null → 403 + audit — NOT `getRepScope`, which returns `roster` for a player-coach); **manager** uses `getRepScope` roster and **rejects a bare rep** (`scope.level==='self'` → 403); **business** is `@RequirePermission('reports','view')` + a service `if(!isSuperAdmin) 403+audit` (there is **no `business` action**); **admin** = `reports:view` + Admin/SA queues. **All money is READ** from `pay_run_lines`/`holdback_ledger`/`clawbacks`/`client_statements` (business net_margin = revenue − payout, a display subtraction — never recomputed, #1/#5); counts from `sales`/`sale_items`; tier-progress is a pure count→bracket lookup (`tier-progress.logic`, no rates). **Leaderboard** = company-wide ranked internet-activation **counts only** (no money field — asserted), visible to anyone with `reports:view` (Sales Rep seed gained `reports:view`). **Notifications** (`NotificationsModule`): `notify(event,user,…)` reads the global `NotificationEventSetting` (Super-Admin-set, **no per-user override**), creates in-app rows + stubbed `EMAIL_DISPATCHER`; best-effort (never breaks the triggering action); `GET /v1/notifications` is own-only; settings GET/PATCH gated `settings:{view,edit}` (Super Admin). **Chatbot** (`POST /v1/chatbot/query`, authenticated): the stubbed `LLM_PROVIDER` returns ONLY an allow-listed intent (no ids/SQL); tools take **only the AuthUser** + are entitlement-gated (`isToolAllowed`) → a rep can never retrieve another rep's/role's data regardless of prompt (proven by smoke). Seeded: 8 notification settings (`rate_change` in-app-only, RPT-010) + a `gemini` `ChatbotConfig` (`is_active=false`).
- **Reporting deferrals.** **Email/SMS dispatch stubbed** (`EMAIL_DISPATCHER` noop — real SMTP rebinds). **Gemini LLM stubbed** (`LLM_PROVIDER` `StubLlmProvider` keyword router — real provider rebinds; `ChatbotConfig` row exists). **Sales targets (RPT-008) deferred** — leaderboard is pure counts (no target/progress column); no `SalesTarget` endpoints. **Materialized views deferred** — dashboards use Prisma `groupBy`/`count`/`aggregate`; the leaderboard counts a bounded period set in-app (raw GROUP BY / MV is the scale optimization). Other modules (Sales/Expenses/Pay Run) can call `NotificationsService.notify()` later for their events; only Documents signature events are wired now.
- **User-facing notification-preferences READ endpoint (deferred — surfaced by the Account UI).** AUTH-013 says every user can see (read-only) which notifications they receive, but the only channel-config endpoint is `GET /v1/notification-settings`, gated **`settings:view` (Super Admin)**. So the My Account → Notifications tab can only show the real list to a Super Admin; a non-SA gets a graceful "your administrator controls these" banner. Add a small authenticated, **own-scoped read** of the global event×channel settings (no per-user override — still SA-configured) so non-SA users can see their channels. No per-user override is intended (AUTH-013), just visibility.
- **Trend/period-aggregation dashboard endpoint (deferred — surfaced by the Business dashboard).** The business dashboard returns single-period scalars only; cross-period trend/breakdown charts need a backend aggregation endpoint (`date_from`/`date_to` are accepted by the contract but ignored server-side today). Flagged, not built; the FE shows a single-period breakdown + a "trends coming" banner.
- **User invite / password-reset flow (AUTH-002, deferred — surfaced by User Management).** There is **no** admin-set-password, invite/email, must-change, or self-service reset capability: `CreateUserDto.password` is **required** (8–128), `UpdateUserDto` has **no password field**, and the only self-service path is `POST /v1/account/change-password` (needs the current password). So the create-user UI **generates a temp password shown once** and tells the admin to share it securely + the user to change it under My Account → Security. Build the real flow: an invite/email or an admin "reset password" endpoint (and optionally a `must_change_password` flag). Until then a user who forgets their password cannot self-recover. Also note: the server has **no self-protection** (an admin can deactivate themselves / remove their own roles → lockout) — the UI adds guardrails, but a server-side actor self-check (block self-deactivate / self-role-removal) would be safer.
- **KM map / geocoder (DONE — env-gated).** Wired: with `VITE_GOOGLE_MAPS_API_KEY` the FE captures real `lat`/`lng` via Places autocomplete + shows the route map + auto-derives the distance; with `GOOGLE_MAPS_API_KEY` the server re-derives the authoritative route distance via the Directions API. Graceful fallback (no key) = manual address + `total_km` (stops carry `lat`/`lng`=`'0'`, the server falls back to the typed total). The amount is always server-computed.
- **Expense item DELETE (DONE — per item).** `DELETE /v1/expense-items/{id}` (`expenses:delete`, scoped) removes a **not-yet-approved** item (approved items are preserved). The legacy `expense_reports`/`expense_exports` tables still have no delete endpoint. Real **server-side** export-file generation remains stubbed (the FE file export is real — see above).

---

## 13. Frontend conventions (foundation built — `frontend/`)

The design-system FOUNDATION is built (tokens, theming, component library, app shell, typed client, showcase). Build screens on it; do NOT reinvent these. Authoritative visual spec: `docs/design-system.md`. Verify with `npm -w frontend run dev` → the `/` route renders the **component showcase** (every component in light + dark).

- **Tokens are the single source of truth.** `frontend/src/styles/theme.css` is the ONLY file with raw hex. Every component styles via `var(--token)` — never a hard-coded hex/px/font. **stylelint enforces this** (`npm -w frontend run stylelint`; strict-value on colour/font/radius/z-index, `color-no-hex` outside theme.css). Theme switch = swap token values, zero component changes.
- **Theme = `[data-theme]` on `<html>`.** `theme.css` has `:root` (theme-independent) + `:root,[data-theme='light']` (light colour/shadow) + `[data-theme='dark']` (dark overrides, §3.5). Attribute selectors let a nested `<div data-theme>` re-root the cascade (the showcase's side-by-side panels). An **inline boot script in `index.html`** sets `data-theme` before first paint (no flash); `theme/ThemeProvider` owns Light/Dark/System (System follows the OS live), persists to `localStorage` now — **and will `PATCH /v1/account/theme` once login exists** (already in the contract). Storage key `redwave-theme` MUST match the boot script.
- **Styling = CSS Modules** (`*.module.css`) per component. No Tailwind, no CSS-in-JS runtime.
- **a11y-heavy components use Radix unstyled primitives** (Dialog/Tabs/Toast/Select/Checkbox/Radio/Switch/Tooltip/Popover/DropdownMenu) — styled 100% with tokens (focus-trap/ARIA/keyboard for free, no generic look). Simple components are hand-rolled. Icons: `lucide-react` (one line set). Import components from `@/components/ui` (barrel `src/components/ui/index.ts`); layout from `components/layout/` (`AppShell`/`Sidebar`/`TopBar`/`Footer`).
- **Fonts: Figtree (UI) + JetBrains Mono (money/codes)** self-hosted via `@fontsource` → `--font-sans`/`--font-mono`; money/numeric uses the `mono` class (`tabular-nums`), **right-aligned** (`MoneyInput`, `TD numeric`).
- **Typed API client**: `openapi-fetch` over types generated from the contract — **`npm -w frontend run gen:api`** writes `src/api/generated/schema.d.ts` (never hand-edit; regenerate when the contract changes). **NO `baseUrl`** (the generated path keys already include `/v1`, e.g. `"/v1/auth/login"`; a `/v1` baseUrl would double it); the Vite dev proxy forwards `/v1` (+ `/api`,`/health`) → backend :3000. Bearer injected via the `onRequest` middleware from the session.
- **Deferred (next sessions):** feature screens; **Combobox/autocomplete** + full **date-range picker** (placeholders shipped); chart components (chart TOKENS exist); real file upload + receipt camera. Feature routes are added with their screens (code-split via `React.lazy`).

### Brand assets & the `Logo` component (built — real Redwave mark, tokenized + themed)
The real two-tone logo (orange wave + "Red" / black "wave marketing") replaced the placeholder "R" marks.
- **`Logo`** (`components/ui/Logo.tsx`, barrel-exported): inlines the SVG via **`svgr`** (`import … from
  '…svg?react'`; added `vite-plugin-svgr` with `svgrOptions:{svgo:false}` + the `vite-plugin-svgr/client`
  type ref in `vite-env.d.ts`). Props: `variant 'full'|'mark'`, `size 'sm'|'md'|'lg'` (heights 20/28/40px),
  `title`, `decorative`. Used in the **Sidebar** (`full`, `mark` when collapsed, `decorative`) and **Login**
  (`full`); **TopBar/AppShell carry no logo** (brand lives in the always-visible sidebar). In the showcase.
- **The dark-theme treatment (the design decision):** the logo "ink" (wordmark + lower wave) is
  **`currentColor`**, so it inherits each placement's text token — light on the navy sidebar (which is navy in
  BOTH themes via `--on-brand`), near-black/near-white on the theme-flipping login card (its `.brand` sets
  `color: var(--text-primary)`). The orange is the **constant** token **`--brand-orange: #ff6600`** (added to
  theme.css `:root`, like `--on-accent`; legible on white, navy, and dark). Two SVGs in
  `assets/brand/` (`redwave-logo.svg` full, `redwave-mark.svg` icon-only) are edited to be themeable: root
  `fill="currentColor"` (ink inherits) + orange paths `style="fill:var(--brand-orange)"` (no `<style>`/`<defs>`;
  svgo off keeps them). **No hard-coded hex anywhere but the brand SVGs + theme.css** (stylelint-clean).
- **Convention:** **`src/assets/brand/`** = themeable in-app brand assets (logo + mark variants; future client
  logos — VF/RF/CTI), consumed via `?react` + `Logo`. **`public/`** = static, fixed-colour browser/OS artifacts:
  `favicon.svg` (square, orange-only mark — reads on any tab bar) + the raster set (`favicon.ico`,
  `apple-touch-icon.png`, `icon-192/512.png`, `site.webmanifest`) **generated by `npm run gen:icons`**
  (`scripts/gen-icons.mjs`, via `@resvg/resvg-js` + `to-ico`; navy tile bg). `index.html` links them + sets
  `theme-color`. Re-run `gen:icons` if the mark changes. **Verified:** stylelint + build (svgr/tsc) + lint green.

### `LoadingSpinner` — the branded loading animation (built; visual-only)
The plain-text/placeholder loading states were replaced by the branded SMIL-animated SVG (`assets/brand/
loading.svg` — a hand + bouncing "LOADING" letters). **`components/ui/LoadingSpinner.tsx`** (barrel-exported):
inlined via svgr (`?react`, the `Logo` convention), props `size 'sm'|'md'|'lg'` (48/96/160px square) + `label`
(a11y, default "Loading", on a `role="status"` wrapper). **Theme-safe:** the gray `#444444` "LOADING" ink was
swapped to `currentColor`, driven by the wrapper's `color: var(--text-secondary)`, so it's legible on BOTH
themes; the blue hand keeps its own colours; the SMIL animation is preserved (svgo off). The art already reads
"LOADING", so callers add NO separate text label. **Used at the two genuine full-area spinner spots only:** the
route-level **Suspense fallback** (`routes/router.tsx`) and the **session boot** (`auth/SessionLoading.tsx`,
which also dropped its stale "R" placeholder + CSS spinner). **Deliberately left as purpose-built indicators:**
table/`Skeleton`/`TableSkeleton` (the `DataState` loading default), the `Button` inline spinner, and the
chatbot "thinking" dots — the big "LOADING" illustration would be wrong in those micro/skeleton contexts. In the
showcase. **Note:** the motion is SMIL, so `prefers-reduced-motion` doesn't gate it (a property of the asset).

### Auth / session (built — login flow)
Login, the session, protected routes, the convenience-only permission gate, and the server theme-sync
are wired (`frontend/src/auth/`, `pages/login/`). Verify: backend up + seeded, `npm -w frontend run dev`,
sign in as `superadmin@redwave.local` / `DevSuperAdmin!123`.

- **UI permission-gating is CONVENIENCE ONLY — the server is the real gate (§5).** `useAuth().permissions`
  (the `effective_permissions` from `/v1/auth/me`) drives routing + `useCan(perm)` / `<Can permission>`,
  which only hide/show UI. The backend RBAC guard rejects any unpermitted call with 403 + audit
  regardless of what the UI renders. Every `useCan`/`<Can>` carries this caveat in-code.
- **Token storage:** access token **in-memory** (`api/auth-store`); refresh token in **`localStorage`**
  (`redwave-refresh`) so a reload silently re-authenticates (`auth/session.ts`). Tradeoff accepted for an
  internal ERP. **`auth/session.ts`** owns: token storage, a **single-flight `refreshAccessToken`**,
  `clearSession`, and the `onSessionExpired` callback (how the non-React client signals React).
- **Refresh = SILENT; only a DEFINITIVE 401/403 logs you out (never a 5xx/network).** `doRefresh()` returns
  a discriminated `RefreshResult` (`{ok,token}` | `{ok:false, expired:true}` | `{ok:false, expired:false}`):
  refresh **200** → new access token, keep session; refresh **401/403** → `clearSession` + `expired:true`;
  refresh **5xx/408/429 or a network throw** → **transient, session KEPT** (`expired:false`). The `onResponse`
  401 interceptor (`api/client.ts`) runs a single-flight refresh and **retries the original request once**
  (raw `fetch`, excludes `/v1/auth/login|refresh|logout`, no loops); only `expired` calls `notifySessionExpired`
  → redirect to `/login`; a transient result **returns the original response without logging out**. On boot
  `AuthProvider` **retries a transient refresh** (~4×2s) to ride a Render cold start before giving up (and even
  then keeps the refresh token, so a later reload recovers). This fixed the "logged out within a minute" report
  — the cause was the old refresh clearing the session on any non-OK response, so a cold-start 503 nuked it; the
  JWT TTLs were fine (see §5 auth-stack note). `session.test.ts` (Vitest) covers 200/401/503/network. **Multi-tab**
  logout/expiry syncs via the `storage` event on the refresh key.
- **`AuthProvider`** (App.tsx order: `ThemeProvider › AuthProvider › QueryClientProvider › Tooltip › Toast
  › Router`) boots by restoring the session (refresh→`/me`, StrictMode-guarded), exposes
  `login`/`logout`/`setTheme`, and holds `{status, user, roles, permissions, isSuperAdmin}`; `logout` calls
  `queryClient.clear()` so the next session starts with no stale cache. **`RequireAuth`** is an element
  guard (loaders can't read context). Routes: `/login` (public) + protected `/` (home), `/showcase`, and
  the Sales cluster (`/sales`, `/sales/new`, `/sales/:id`).
- **Theme server-sync (loop closed):** on login the user's `theme_preference` from `/me` is applied
  locally; changing the theme while authed PATCHes `/v1/account/theme` (`useAuth().setTheme`, used by
  `ThemeToggle`); logged-out = local/System. No-flash boot preserved.
- **Deferred / proposals (NOT built):** **httpOnly secure refresh cookie** (more XSS-resistant; needs a
  backend change — it currently returns/accepts the refresh token in the JSON body); password-reset flow
  (AUTH-002, the login forgot-password link is a placeholder). *(`@ApiResponse` typed responses — incl.
  `auth/auth.types.ts` — are DONE, Batch A #2.)*

### Screen patterns (built — Sales cluster is the reference; COPY these for every later screen)
The Sales cluster (`frontend/src/features/sales/`) is the FIRST feature screen and sets the conventions.
Build new screens by copying its shape — don't invent a second pattern.

- **Feature-module folder shape:** `features/<name>/` = `sales.types.ts` (response types **aliased to the
  generated schema** + request DTOs re-exported from it — Batch A #2) · `api/keys.ts` (query-key factory) · `api/use*.ts`
  (queries + mutations + the list hook) · `components/` · `pages/` (one default-export per route). Keep a
  module's code under its folder; cross-module reads go through the typed client, not shared internals.
- **Server-state = TanStack Query** over the existing `openapi-fetch` `api`, via a thin
  **`unwrap<T>(api.GET(...))`** (`lib/query/unwrap.ts`) that ok-checks and casts (responses are
  `never`-typed — see below) and throws **`ApiError`** on failure. Query keys come from a **factory**
  (`salesKeys.list(filters)`); **mutations `invalidateQueries({ queryKey: salesKeys.all })` on success**.
  `queryClient` config: `staleTime 30s`, `retry 1`, no refetch-on-focus (`lib/query/queryClient.ts`).
- **Loading/empty/error = `<DataState>`** (`components/data/DataState.tsx`) wrapping the content — it
  renders the foundation `TableSkeleton`/`TableError`(with retry)/`TableEmpty` from `isLoading/isError/
  isEmpty`. **Errors → toast** via **`useApiErrorToast()`** (`lib/api/apiError.ts`): its handler is
  `(err) => void` so it drops straight into a mutation `onError` (extra RQ args ignored). Mutation
  success → an explicit `useToast()` call by the caller.
- **Forms = react-hook-form + zod** (`zodResolver`) wired to the foundation **`FormField`**: plain inputs
  use **`register`** (forwardRef `Input`/`Textarea`); Radix controls (`Select`/`MultiSelect`/`Checkbox`)
  use a **`Controller`**; `fieldState.error?.message` / `formState.errors.<f>?.message` → `FormField error`.
  Radix `Select` forbids an empty `value` — use a sentinel (`'__all__'`/`'__self__'`) mapped to `undefined`.
  See `SaleForm.tsx` (dependent client→products dropdown; live composite-ID preview).
- **List = server-side FILTERS + client-side sort/paginate**, isolated in one hook (`api/useSalesList.ts`,
  `PAGE_SIZE` 15). This is the **swap-seam**: when the backend adds list pagination, change only this hook.
  **Filter state lives in the URL search params** (page owns it via `useSearchParams`, passes
  `{filters, onChange}` to the filter bar) so a preset like `/sales?status=entered` is a shareable link
  (the sidebar "Validation" item IS that link). Bulk row-select → foundation `BulkActionBar`.
- **Detail = a deep-linkable route `/sales/:id`** (NOT a drawer) — `useParams` → a `*DetailView` that
  fetches + handles its own loading/error/not-found via `DataState`. This is the canonical detail pattern.
- **`useCan` + status gating is CONVENIENCE ONLY (§5).** Call `useCan(perm)` **unconditionally** (rules of
  hooks — never inside `&&` after a status check), then combine: e.g. `canValidate = status==='entered' &&
  useCanApprove`. The server re-authorizes every call; a hidden button is not security. Reads degrade
  gracefully when a permission is absent (e.g. the client column/dropdown only render with `clients:view`).
- **Sidebar routing:** items with a `to` render as `NavLink` (active via a `match(location)` predicate for
  query-param presets); screens not yet built stay disabled placeholders.
- **Verified live** (seeded backend): full Sales write path 200/201 (create→`sale_date[-mpu]-client_code`,
  list+filters, get with derived pay period, greenfield toggle, single+bulk validate, soft-delete), 400 on
  a bad payload, and a **Sales-Rep token reads `/v1/clients` → 200** (the seed grant) with `/v1/sales`
  own-scoped. A rep create requires a Manager-role `field_manager_id`; the seed ships only a Super Admin
  (which has **no linked rep**, so it must create sales **on-behalf** with `rep_id`).
- **Backend follow-ups this surfaced:** (1) **`@ApiResponse` response DTOs** across modules so `gen:api`
  emits typed responses — **DONE (Batch A #2)**; every feature's `*.types.ts` now ALIASES the generated
  schema instead of hand-writing response shapes (see "Typed responses & the error envelope" below);
  (2) **server-side list pagination** for `/v1/sales` (returns a plain array today — hence the client-side
  seam) — still open, not blocking.

### Typed responses & the error envelope (built — Batch A #2; the contract now carries response schemas)
The OpenAPI contract used to declare request bodies but **no response schemas**, so `gen:api` emitted
`content?: never` and every feature **hand-wrote** its response types. Batch A #2 added `@ApiResponse`
response DTOs across **all ~22 controllers / ~65 endpoints**, regenerated the client, and re-pointed every
feature onto the generated types. Reuse these conventions for any new endpoint/feature.

- **Backend: one `*.response.ts` per module** (`modules/<m>/dto/*.response.ts`, ~50 DTO classes) — each
  field an explicit `@ApiProperty`. **Money/Decimal → `string` ALWAYS** (`@ApiProperty({ type: String })`;
  #1) — incl. non-money decimals (pct, km). Nullable/enum/nested fields carry an **explicit** `type`/`enum`/
  `type: () => Child` so swagger reflection never degrades them to `Record<string,never>`. **Free-form JSON
  blobs** (`payment_details`, import `raw_data`/`mapped_data`, `error_summary`, expense `scope_filters`) use
  `@ApiProperty({ type: 'object', additionalProperties: true })` (counts map →
  `additionalProperties: { type: 'number' }`); a KNOWN object shape (e.g. `proposed_changes`) is modeled as a
  real nested DTO, NOT a blob. Naming: `<Entity>Response` → `components['schemas']['<Entity>Response']`.
- **Error envelope is now per-endpoint.** `@ApiErrorResponses()` (`common/errors/api-error-responses.decorator.ts`,
  `applyDecorators`) attaches `ErrorEnvelopeDto` to 400/401/403/404/409/422 at the **controller-class level**
  (one line, cascades to every route) — closing the Batch A #1 gap. Success stays per-method
  (`@ApiOkResponse`/`@ApiCreatedResponse`, `isArray: true` for lists; `@ApiNoContentResponse` for 204).
- **Frontend: ALIAS, don't hand-write.** Every `features/*/*.types.ts` now does
  `export type Sale = components['schemas']['SaleResponse']` (type NAME kept → zero call-site churn). Enums
  derive from the contract (`SaleStatus = …['SaleResponse']['status']`). `unwrap<T>` keeps its cast signature
  (responses are now typed at the call site via the alias). **HRM has no frontend feature** → backend DTOs +
  annotations only, no re-point.
- **Request-quirk fixes (also Batch A #2):** `TierBracketDto.max_count` + import `rows`/`mapped_data` no longer
  regenerate as `Record<string,never>`, so the last hand-written request bodies + boundary casts were dropped.
  (Pre-existing `CreateRepDto`/`UpdateRepDto.payment_details` still regenerate as `Record<string,never>` — a
  REQUEST DTO with no frontend consumer; harmless, left as-is.)
- **Verified:** backend 61 suites/305 tests + lint green; `contract:export` (82 paths, +~50 schemas) →
  `gen:api` emits real response types (no field `Record<string,never>` regression); frontend build (tsc, the
  coupling guard) + lint green; live spot-checks across every module = **exact key parity** (money = string,
  nested shapes, JSON blobs, PII redaction, leaderboard money-free). **Deliberately NOT done:** per-endpoint
  `@ApiResponse` already covers success+errors, but a few action endpoints over-declare a field the runtime
  omits (e.g. Pay Run `setBonus` types the line WITH `rep`; the service returns it without — the UI only
  invalidates, never reads it) — acceptable, documented.

### Dashboards, charting & notifications (built — reporting read-layer; reuses the Sales playbook)
The four role-scoped dashboards, the counts-only leaderboard, and the notifications bell compose the
existing leak-proof Reporting endpoints. They REUSE the Sales playbook exactly; the ONE new pattern is
**charting**. Folders: `features/dashboards/` (+ `charts/`) and `features/notifications/`.

- **Charting = Recharts, themed via tokens (THE chart pattern).** Every series colour is a `var(--chart-N)`
  (`charts/chartTheme.ts` `CHART_SERIES`/`seriesColor`), NEVER a hard-coded hex — so charts adapt to
  light/dark for free. **`styles/theme.css` now defines `--chart-1..5` for BOTH themes** (the dark block
  lightens them; the light slate `--chart-5` is invisible on dark otherwise). `charts/ChartContainer.tsx`
  is the chrome shell (title + fixed-height body the recharts `ResponsiveContainer` fills);
  `charts/ThemedBarChart.tsx` is the reusable single-series bar (per-category colour via `<Cell>`, value
  printed on the bar, **series labelled directly — no legend box**, §3.4); `charts/ChartTooltip.tsx` is a
  token-styled tooltip replacing the library default. **Recharts is pinned to v3** — its `dataKey` is a
  strict `TypedDataKey`, so `ThemedBarChart` types `data` as an **open `Record<string,string|number>`**
  (NOT a generic `T`) so plain-string `categoryKey`/`valueKey` are accepted; charts are **lazy-loaded**
  with the dashboard pages so the ~350 kB recharts chunk never loads on other screens.
- **`StatCard` is a foundation component** (`components/ui/StatCard.tsx`, in the barrel): the design-system
  KPI tile (mono `--text-2xl` value + label + optional `Delta`/footnote). Use it for every KPI everywhere.
- **Money is display-only via `lib/format/money.ts`** — pure string grouping ("1234.5"→"$1,234.50"), **no
  float math** (#1). For charts, values are `Number()`-coerced ONLY to plot (never to compute money).
- **Role landing + nav.** `useAuth()` now exposes **`repId`** (from `/me`'s `rep_id`). The index route is
  `features/dashboards/pages/DashboardLanding.tsx` → `<Navigate>` by role: **SA→business · Admin→admin ·
  Manager→manager · linked rep→rep · else reports:view→leaderboard · else module-card home**. The Sidebar
  "Dashboards" group shows items per **access predicate** (Business=`isSuperAdmin`; Operations=admin/SA;
  Team=`reports:view`+admin/manager; My Dashboard=`!!repId`; Leaderboard=`reports:view`). All gating is
  convenience — the **server is the real gate (§5)**: each dashboard page treats a query **403** as a
  graceful `AccessDenied` (helper `isForbidden(error)` in `lib/api/apiError.ts`).
- **Business dashboard is SUPER ADMIN ONLY** (server-enforced); it has a pay-period selector
  (`usePayPeriods`, gated `payrun:view`). The endpoint returns single-period **scalars only**, so the chart
  is a single-period financial breakdown and a `<Banner>` states that **cross-period trend charts await a
  backend aggregation endpoint** (NOT faked by looping). **Leaderboard is counts-only** at the source — the
  UI renders rank/rep/activation_count with **no money column, ever** (smoke asserts no money key).
- **Notifications bell** (`features/notifications/NotificationsBell.tsx`, wired into `TopBar`): a Popover
  list of the caller's OWN notifications (own-scoped server-side); unread dot from `useNotifications({is_read:
  false})`; click an unread row → `PATCH /v1/notifications/{id}/read` → invalidate. **No mark-all** (no
  endpoint). Closes the in-app notification loop (signature events now surface here).
- **Verified live** (seeded backend): SA loads business/admin/manager/leaderboard/notifications/pay-periods
  (all 200, correct shapes), SA→`/v1/dashboards/rep` **403** (no linked rep → `AccessDenied`); the rep
  fixture confirms rep→business **403** (server-enforced) and rep→rep-dashboard/leaderboard **200**; the
  leaderboard JSON carries **no money key**. **Not done (needs a browser):** the light/dark visual pass of
  the charts.
- **Backend follow-up this surfaced:** a **period-aggregation/trend endpoint** for the business dashboard
  (so trend-over-time charts can be built). *(The `@ApiResponse` response-DTO follow-up is DONE — Batch A #2;
  all dashboard/leaderboard/notification responses now alias the generated schema.)*

### Account & Settings (built — Session 1: My Account + Administration hub + profile-change-review)
The personal "My Account" area + the profile-change-review workflow. Reuses the playbook exactly.
Folders: `features/account/` (the tabbed personal area) and `features/admin/` (the Administration area;
Session 1 = hub shell + review queue; Session 2 adds users/roles/notification-settings editors).

- **HR-edit is request-not-live-write (the law here, SRS AUTH-011, design-system §10.6).** The Profile tab
  reads `GET /v1/account/profile` (which carries **`change_pending` + `pending_request`** — NOT
  `useAuth().user`, which lacks the flag). Saving name/phone/avatar POSTs **only the changed fields** to
  `/v1/account/profile-change-requests` → toast "Submitted for review (not saved live)" → invalidate; the
  **live profile is unchanged** and a `PendingChangeBanner` shows the proposed values. While a change is
  pending the edit form is **disabled** (one request at a time). **Theme is the deliberate INSTANT
  exception** — the Preferences tab reuses the wired `<ThemeToggle/>` (`useAuth().setTheme` → instant +
  `PATCH /v1/account/theme`); the UI calls this out explicitly.
- **My Account = foundation `Tabs`** (`features/account/pages/AccountPage.tsx`): Profile · Security
  (change-password RHF+zod, `type="password"`, never echoed/logged) · **Signatures** (manage saved reusable
  e-signatures — draw/type/upload, set default, delete; own-scoped) · Preferences (theme) · Notifications
  (**read-only**). No permission gate — every user manages their own account.
- **Notifications tab degrades by design.** The only channel-config endpoint is `settings:view`-gated
  (Super Admin), so the tab shows the real event×channel list ONLY to an SA (`useCan('settings:view')` gates
  the fetch); everyone else gets a graceful "your administrator controls these" Banner. **There is no
  per-user override** (AUTH-013). A user-facing read endpoint is the §12 follow-up.
- **Profile-change-review queue** (`features/admin/pages/ProfileReviewPage.tsx`, `useCan('profile:approve')`
  + server-scoped): the queue (`GET /v1/profile-change-requests`) is **routed server-side** (SA=all,
  Admin=any rep, field-manager=own reps — AUTH-012); **the UI NEVER filters it**. Each `ReviewRequestCard`
  shows the subject + **current → proposed** per changed field (current from `subject`, proposed from
  `proposed_changes`) + **Approve** (applies to the live user) / **Reject** (confirm Modal → discards). 403 →
  `AccessDenied`.
- **Administration hub** (`features/admin/pages/AdminHomePage.tsx`): a card grid; each `AdminHubCard` is
  gated by reading `useAuth().permissions.has(perm)` (so the page can `.filter` without breaking
  rules-of-hooks — do NOT call `useCan` per item in a loop). Built card → a `Link`; unbuilt → a **"coming
  soon"** card (Users/Roles/Notification-settings = Session 2; Commission/Clients/Expense-categories = their
  own future screens). No admin permission at all → `AccessDenied`.
- **`Avatar` is a foundation component** (`components/ui/Avatar.tsx`, barrelled): initials circle +
  optional `avatar_url` image; `size sm|md|lg`. Used by the profile header + review queue (+ Session-2 user
  list). **Avatar file upload stays stubbed** — `avatar_url` is a text field in the edit-as-request form.
- **Nav:** Sidebar gained an **"Administration"** group ("Administration" `/admin` shown if the caller has
  any admin-card permission; "Profile reviews" `/admin/profile-review` shown with `profile:approve`) and an
  **"Account"** group ("My Account" `/account`, always). The TopBar user-menu "My Account" button now
  `navigate('/account')`.
- **Verified live** (seeded backend, `smoke.rep` fixture so SA creds stay pristine): **request → SA-approve
  → APPLIED** and **request → SA-reject → DISCARDED** (proving the live write is withheld until approval),
  the SA queue contains the rep's request (routing), change-password (wrong current → 400, change → 200,
  restore → 200), read-only notification-settings (200), and the instant theme PATCH (200). **Not done
  (needs a browser):** the light/dark visual pass.
- **Deferred to Session 2:** user management (list/create/edit/roles/deactivate), the role builder
  (module×action matrix; built-in roles `is_system` → rename/delete blocked 409, permissions editable), and
  the notification-settings **editor** (`PATCH /v1/notification-settings`). The read hook + types already
  live in `features/notifications/` for the editor to reuse.

### Administration admin CRUD (built — Session 2: Users · Role builder · Notification-settings editor)
Fills the three Session-1 "coming soon" hub cards. All in `features/admin/` (one administration feature);
the notification-settings WRITE lives in `features/notifications/` next to its read hook. Reuses the playbook.

- **User management** (`features/admin/pages/UsersPage.tsx`, `users:view`): a Table (Avatar, email, role
  Badges, status) + a create/edit **Modal** (`UserFormModal`, RHF+zod). **Create** generates a strong
  **temp password shown once** (`lib/password.generateTempPassword`, Web Crypto; copy + regenerate) → POSTs
  the required `password` (the backend has no invite/reset/must-change — see §12); the user changes it under
  My Account → Security. **Edit** has NO password field (no admin-set-password endpoint); it PATCHes
  name/phone/status and, if roles changed, `PUT /users/{id}/roles` (full replacement). **Soft-deactivate** =
  `PATCH {status:'inactive'}` (immediate revoke; never a hard delete) behind a confirm. **Self-guardrails**
  (the server has NO self-protection): you can't deactivate your own account or change your own roles/status.
- **Role builder** (`RolesPage` + `RoleEditorPage` at `/admin/roles[/new|/:id]`, `roles:view`/`edit`): list
  shows a **"Built-in" Badge** + permission/user counts; the editor is a **deep-linkable route** (the matrix
  is too big for a modal). **`PermissionMatrix`** = rows × 6 action columns (`view/create/edit/approve/
  delete/export`), a Checkbox per existing `(module,action)` permission keyed by **permission id** (empty
  cell where a module lacks an action), with **row + column "select-all"** (indeterminate when partial); the
  selected `Set<permissionId>` is owned by `RoleEditor`, the matrix computes the next set. Save = `PUT
  /roles/{id}/permissions` (+ `PATCH` name/description). **Built-in rules (reflect the backend exactly):**
  rename + delete are blocked (server 409; the UI disables them) but **permissions ARE editable** on built-in
  roles (with a warning) — **EXCEPT Super Admin, which the UI keeps fully read-only** (it holds all 90; the
  server has no self-protection, so neutering it would lock everyone out).
- **Notification-settings editor** (`NotificationSettingsPage`, `settings:view`; save `settings:edit`):
  **reuses `useNotificationSettings()`** (Session 1) for the read + `useSaveNotificationSettings()`
  (`features/notifications/api`) for the write. A per-event in-app/email **Switch** grid, **dirty-tracked**
  vs the loaded settings; "Save changes" PATCHes **only the changed rows**. No per-user override (global).
- **Wiring:** the AdminHomePage cards now link (`/admin/users`, `/admin/roles`, `/admin/notifications`); the
  Sidebar Administration group gained Users/Roles/Notifications NavLinks (each `show`-gated by its permission).
- **Verified live** (seeded backend, SA token, creates-then-cleans-up): user create + role-assign + edit +
  **deactivate → login 401 (immediate revoke)** + reactivate; `GET /modules`=15 + `/permissions`=90; create
  custom role + **edit permissions persists** (re-GET confirms); **built-in rename → 409, delete → 409**;
  custom role DELETE → 204 (cleanup); notification-settings toggle → 200 + restore. The test user is left
  **inactive** (no hard-delete endpoint exists). **Not done (needs a browser):** the light/dark visual pass
  (esp. the matrix). **§12 follow-ups recorded:** AUTH-002 invite/reset + a server-side self-protection check.

### Expenses (built — ITEM-FIRST: DataTable list, multi-add, KM maps, real receipts, per-item bulk approval, grouped export)
The daily expenses workflow, rebuilt item-first. `features/expenses/`. Reuses the playbook (DataTable +
`use{Feature}Table` + bulk + export). SRS §11; design-system §10.4. The **expense item is the unit** — no
weekly report in the UI.

- **Item-first API hooks.** `expenses.types.ts` aliases the generated schema (`ExpenseItem(Page)`,
  `BulkReviewResult`, `ReceiptUpload`). `api/useExpenseItems.ts` = `useExpenseItemsTable(filters)`
  (server page+sort, reset-on-filter), `useExpenseItem(id)`, `useAllExpenseItems`/`fetchAllExpenseItems`
  (export/grouped summary), `useFieldConfigs`, `useExpenseExports`. `api/useExpenseMutations.ts` =
  create-items / update / review / **bulk-review** / delete / export + **`useUploadReceipt`** (raw multipart
  fetch to `POST /v1/expense-receipts`, bearer from the session).
- **List = item DataTable** (`ExpenseItemsTable` on `ExpensesListPage`): server-paginated; filters in the URL
  (status/category/rep/client/date-range/search), **default = current pay cycle** (`payrun:view`). Columns:
  date · category (+ KM badge) · rep/client (gated) · description · status · amount (mono). Row kebab →
  View/Edit/Delete (edit-gating EXP-007; delete only pre-approval, `expenses:delete`). Approvers
  (`expenses:approve`) get row-select → a **bulk approve/reject/send-back** bar (`BulkReviewBar` →
  `/bulk-review`). `ExpenseApprovalsPage` is the same table fixed to `status=submitted`.
- **Add = multi-item** (`ExpenseForm`, RHF+zod+`useFieldArray`): "Add another item" captures several at once →
  `POST /v1/expense-items`; **edit = a single item** → PATCH. `ExpenseItemRow` picks a category →
  `KmItemFields` or `StandardItemFields`. Schema/builders in `components/expenseForm.schema.ts`
  (`buildItemsBody`/`buildItemBody`; km amount omitted).
- **KM amount is SERVER-AUTHORITATIVE; distance via Maps (env-gated).** `KmItemFields` branches on
  `maps.config#mapsEnabled` (`VITE_GOOGLE_MAPS_API_KEY`): with a key → `MapStops` (`@react-google-maps/api`
  Places autocomplete per stop → real lat/lng, a route `GoogleMap` + `DirectionsService` that **auto-derives
  `total_km`**); without → manual address + total-km entry (lat/lng `'0'`). The server re-derives the
  authoritative distance + always computes the amount; `km.ts#kmPreview` is the indicative-only preview.
- **Receipts upload for real** (`ReceiptField`): selecting a file → `useUploadReceipt` → stores the returned
  access-controlled URL; required per category (config-driven, client + server gate). Graceful when storage
  is unconfigured (server returns a reference).
- **Grouping + export (FE-6).** `ExpenseExportControls` = a grouping Select (none/daily/weekly/monthly;
  from/to = custom range) + the Batch-1 `ExportMenu` (per-item rows, or grouped period·count·total buckets) as
  CSV/Excel/PDF; `GroupedSummary` (StatCards) shows the bucket totals. `format.ts#groupItems` buckets via
  `sumMoney` (exact, #1). The server-recorded export (`ExportModal` → `POST /v1/expense-exports`) is kept for
  the per-rep KM-log client submission (stub `file_url`). `ExpenseStatusBadge` unchanged.
- **Nav/routes unchanged:** `/expenses[/new|/approvals|/:id|/:id/edit]` (Sidebar Expenses + Approvals).
  Removed the report-era files (`useExpenses`, `ExpenseReportsTable`, `ExpenseReviewCard`).
- **Verified LOCAL only** (tsc + build + lint + stylelint green). Operator applies `migrate deploy` + re-seeds
  bootstrap, and optionally sets `GOOGLE_MAPS_API_KEY`/`SUPABASE_*`/`VITE_GOOGLE_MAPS_API_KEY`. Light/dark +
  live-data + the map/upload visual pass needs a browser/running backend with the keys.

### Clients & Products + the EFFECTIVE-DATING UI (built — Admin Config Session 1; Commission Config = Session 2)
The deployment-setup config for the **billing stream** (what we charge partners). `features/clients/`. Fills
the "Clients & Products" hub card. Reuses the playbook + the admin list+detail-route shape. SRS §6; CLAUDE
#3 (keep billing rates SEPARATE from commission) + #10 (effective-dating).

- **#3 is structural here:** the feature reads ONLY `/v1/clients*` — **zero path touches `commission_*`**.
  Commission Config is a **separate feature** (Session 2), never one screen/hook joining the two streams.
- **EFFECTIVE-DATING UI = APPEND-NEW-FUTURE-ROW, never edit/delete (#10).** Billing rates have GET + POST
  only. The UI is a **read-only current/pending/past table** (`EffectiveDatedTable`, status badged via
  `RateStatusBadge` — both **domain-agnostic**, written for Session 2 to reuse on tiers/flats/holdback) +
  an **"Add rate" form** (`BillingRateFormModal`). Adding a **future-dated** rate **supersedes the scope's
  pending row + bounds the current** (server-side); the form states this. **The `status` comes from the
  server** (`'current'|'pending'|'past'`) — no client-side date math (just a `todayIso` default + a
  client-side back-date guard that the **server enforces with 422**). Existing rows are NEVER edited.
  `BillingRate.amount` is an exact-decimal string (`MoneyInput` in, `money()` out). The shared table takes
  `EffectiveColumn<T>[]` (caller's leading columns) + auto-renders effective_from/to + status.
- **Clients/Products CRUD = Modals** (`ClientFormModal`, `ProductFormModal`); billing rates live on the
  **client DETAIL route** `/admin/clients/:id` (header+edit · Products · BillingRatesPanel). **Soft-deactivate**
  = `PATCH {is_active:false}` (preserves history; never delete) behind a confirm; reactivate flips it back.
  **`product_type` is IMMUTABLE** — the edit form omits it (shows it read-only as a Badge); the backend
  **rejects** a `product_type` in `UpdateProductDto` with **400** (`forbidNonWhitelisted`) — stronger than
  ignoring. `rate_kind='product'` requires a product (server 422); add-on kinds (tv_addon/…) don't.
- **Nav:** AdminHomePage "Clients & Products" card now links `/admin/clients`; Sidebar Administration group
  gained a "Clients & Products" item (`clients:view`). Routes: `/admin/clients`, `/admin/clients/:id`.
- **Verified live** (seeded backend, SA token; clients/products/rates have no DELETE so they persist — the
  test client is soft-deactivated as cleanup): client create + **dup code → 409** + rename + deactivate/
  reactivate; product create + **product_type-immutable edit → 400** + deactivate; **effective-dating core:**
  rate@today → **current**, rate@+10d → **A bounded (→+9d) + B pending**, rate@+30d → **B superseded/gone, A
  current, C pending**, **back-date → 422**, **product-kind without product_id → 422**, tv_addon without
  product → 201; list rows carry `status`, `?status=current` filters. **Not done (needs a browser):** the
  light/dark visual pass (esp. the effective-dated table). **Session 2 (DONE):** Commission Config — see the
  next subsection.

### Commission Config + the TIER-BRACKET editor (built — Admin Config Session 2)
The deployment-setup config for the **rep-commission stream** (what we pay reps). `features/commission/`.
Fills the "Commission Config" hub card. Reuses the playbook + the promoted effective-dating UI. SRS §7;
CLAUDE #3 (keep commission SEPARATE from clients) + #5 (engine owns tiering; UI only stores) + #10
(effective-dating) + #1 (exact decimal). One scannable page `/admin/commission` (`commission:view`; 403 →
AccessDenied) of stacked Card sections; every Add/Set action gated `commission:edit` (server is the real gate).

- **PROMOTION:** `EffectiveDatedTable` + `RateStatusBadge` (+ the `RateStatus` type) were moved from
  `features/clients/components/` → **`components/ui/`** (barrel-exported) and Session-1 clients re-pointed to
  the barrel. So Commission imports them from the **foundation**, NOT from `features/clients` — there's no
  commission→clients code dependency and **#3 reads cleanly**. (Both features still build/lint/stylelint clean.)
- **#3 is structural here:** the feature's RATE reads are ONLY `/v1/commission/*` + `/v1/incentives`. The
  incentive scope picker's `/v1/clients` read (gated `clients:view`) is a **client reference** the backend
  validates `scope_client_id` against — **never a join of the two rate streams** (no path combines
  `commission_*` with `client_billing_rates`).
- **TIER-BRACKET editor (the custom piece — STORAGE + VALIDATION ONLY, #5).** `TierBracketEditor` is a
  `useFieldArray` of 4 brackets (default Schedule-C-v2 shape); each row = tier_number, min_count, max_count
  + an **"open top" Switch** that nulls max_count, rate (`MoneyInput`); add/remove rows. The pure
  `tiers.logic.ts#validateTierBrackets` is a **client-side MIRROR of the backend** `tier-schedule.logic.ts`
  (≥1 bracket · first min=0 · exactly one open and it's highest · max≥min · **contiguous: each min = prev
  max+1**). It runs live on `useWatch` and **blocks submit** (disabled button) while invalid, showing a
  Banner; a valid set renders a read-only range preview. **It never determines which tier a count falls in
  — the engine does that at runtime (#5).** Shared form types/mappers live in `tierForm.ts` (avoids a
  circular import between the editor + modal). **Batch A #2 fixed** the `TierBracketDto.max_count` swagger
  nullable quirk (explicit `type: Number, nullable: true`), so the generated `CreateTierScheduleDto` is now
  used directly — the hand-written `CreateTierScheduleBody` + boundary cast were **dropped**.
- **Effective-dating = APPEND-NEW-FUTURE-ROW (#10), reusing the shared table.** Tier schedules / flat rates /
  holdback split each render in `EffectiveDatedTable` (server `status`; a future-dated row supersedes the
  scope's pending + bounds the current; **back-date → 422**; closed rows never edited). `TierScheduleModal`,
  `FlatRateModal`, `HoldbackSplitModal` all show the supersession Banner + an `effective_from` ≥ `todayIso()`
  client guard (server re-enforces 422).
- **Flat rates** (`FlatRatesSection`/`FlatRateModal`): product_type Select offers **only greenfield_internet /
  tv / home_phone** (internet omitted — "internet is tiered; set it in the tier schedule"); the server still
  **422s internet** (proven). Amount `MoneyInput`/`money()`.
- **Holdback split** (`HoldbackSplitSection`/`HoldbackSplitModal`): advance_pct + holdback_pct as decimal
  fractions; a **live "Total = 100%" ✓/✗** computed with **exact integer basis points** (`pct.ts`
  `toBasisPoints`/`totalsToHundred` — no float, #1); submit blocked unless they sum to 10000 (server 422s ≠1).
- **Holdback-release** (`ReleaseSettingSection`): **PROPOSED (SRS §17), store-only & sticky** (NOT
  effective-dated) — a `ProposedChip` + an explicit "stored only; Pay Run/Redwave interprets which cycle the
  30% releases into" note; a free-text `release_rule` Set form pre-filled via RHF `values`. (§12.)
- **Incentives** (`IncentivesSection`/`IncentiveModal`): a Table (name · scope client/product · target ·
  window · amount via `money()` · status) with row actions Edit + End (status→ended) and a status filter.
  Create = **per_activation only**; `target_based` is shown but **DISABLED** with a `ProposedChip` + "deferred
  §12 — not engine-applied yet" note (and renders with a `ProposedChip` in the list). Scope client = **All /
  Specific → `useClients` picker** (the #3-safe reference); scope product type = static enum Select, optional.
  Edit = name/amount/status. The created-then-ended incentive persists (no delete endpoint).
- **Nav:** AdminHomePage "Commission Config" card links `/admin/commission`; Sidebar Administration group
  gained a "Commission Config" item (`SlidersHorizontal`, `commission:view`). Route: `/admin/commission`.
- **Verified live** (seeded backend, SA token; effective-dated configs have NO delete → valid future rows are
  written **value-identical** to Schedule C v2 at far-future dates, the release rule is **restored**, the
  incentive **ended** — SA creds untouched): **29/29 smoke checks pass** — seeded Schedule C v2 current
  (110/125/145/160, flats 100/30/30, split 0.70/0.30); a future VALID schedule → **bounds current + pending**,
  a later one **supersedes** the pending; **flat internet → 422**; **holdback 0.60+0.30 ≠1 → 422**; release
  set→read-back→restore; **per_activation → 201**; **target_based without target_count → 422**; **back-dated
  tier schedule → 422**. **Two backend findings (NOT this session's code; flagged):** (1) the API serializes
  Prisma `Decimal` as a **canonical string without trailing zeros** (`"160"`, `"0.7"`) — still a string (#1
  holds) and `money()` pads to 2dp, so display is correct; (2) **tier contiguity violations returned 500, not
  422 — FIXED (Batch A #1, global exception filter).** See "Global exception filter & error envelope" below:
  a global `AllExceptionsFilter` now normalizes every error to the contract envelope `{ error: { code, message,
  details } }`, and `tier-schedule.service` wraps the pure `validateTierBrackets` throw in a framework-free
  `DomainError` → **422 + code `TIER_SCHEDULE_INVALID`** (verified by smoke). **Not done (needs a browser):** the
  light/dark visual pass (esp. the bracket editor + the effective-dated tables).

### Pay Run UI (built — the money orchestrator's review-and-commit surface)
The UI for the Pay Run pipeline (SRS §9). `features/payrun/`. The backend does ALL money logic (engine,
70/30, holdback, snapshots, atomic+idempotent finalize); **this UI computes NOTHING** — every amount is
server-sourced and displayed via `money()` (exact-decimal, tabular-mono, right-aligned) / `sumMoney()`
(integer-cents totals, no float). Reuses the playbook exactly. Two pages under the Money nav group.

- **The line API carries only 7 components + net** (verified `lineData`): `commission_70` (70% advance),
  `holdback_release_30` (released), `incentive_total`, `expense_total`, `bonus_amount`/`bonus_note`,
  `clawback_total`, `net_payout`. **No tier, no gross, no current-period 30%-held on the line** — those would
  need UI math (forbidden #1/#5). So the review is **server-faithful**: the **current 30%-held is surfaced
  from the holdback ledger AFTER finalize** (`amount_held`; during draft a note says it's recorded at
  finalize); **tier + gross are a flagged backend follow-up** (a future field on the line). The drill-down
  states this honestly.
- **Period list `/pay-runs`** (`payrun:view`): the pre-loaded 2026 schedule (`usePayPeriods`) **joined
  client-side** with the run headers (`usePayRuns`, latest run per period) to derive each row's run state —
  no run / draft / finalized / exported. Action by state: **no run → "Draft a run"** (`payrun:create`, POSTs
  then routes to the workspace); **draft → "Open draft"**; **finalized/exported → "View"**. `PeriodStatusBadge`
  (open/closed/paid) + `PayRunStatusBadge` (draft/finalized/exported) — **NOT `StatusPill` (sale-only)**.
- **Workspace `/pay-runs/:id`** (`usePayRun`): header + status badge + KPI `StatCard`s (reps, total advance,
  total net via `sumMoney`); a **"Draft — not finalized"** banner vs a **"Finalized — locked"** banner once
  committed. `PayRunLinesTable` = one row per rep (advance · released · incentives · expenses · bonus ·
  clawback · NET), money right-aligned mono, a totals row (`sumMoney`). **`NetPayoutCell` is the one place
  net is shown — a NEGATIVE net (clawbacks > commission) renders in danger colour with the sign, never
  hidden/floored.** Row kebab → "View breakdown" (+ "Set bonus" when draft+approver). The empty period shows
  a graceful "no validated sales" banner.
- **Drill-down** (`LineBreakdownDrawer`): the rep's component **waterfall** straight from the line (advance +
  released + expense + incentive + bonus − clawback = net — the +/−/= are presentation, no math) + that
  rep's **holdback ledger** rows (period labels joined from the schedule). **`HoldbackPanel`** = the same
  ledger run-wide (read-only).
- **Bonus** (`BonusModal`, `payrun:approve` + draft): `MoneyInput` decimal string + note → `useSetBonus`; the
  **server recomputes net**. **Finalize** (`FinalizeConfirmModal`, `payrun:approve` + draft): a deliberate,
  **explained** confirm (lists what it commits: freezes snapshots, sales→Paid, records/releases holdback,
  applies expenses/clawbacks, composes net; "cannot be undone"); the button is **disabled while in flight
  (no double-submit)**; on success the run is **locked/read-only** and finalize is no longer offered
  (re-finalize is a backend no-op). **Export** (`ExportModal`, `payrun:export` + finalized): csv/json →
  `useExportRun` → toast with `line_count`; the run shows **exported**. `useCan` is convenience — the **server
  is the real gate (§5)**; 403 → `AccessDenied`.
- **Nav/route:** the Sidebar **Money** group's "Pay Run" placeholder now links `/pay-runs` (`Wallet`,
  `payrun:view`). Routes: `/pay-runs`, `/pay-runs/:id`.
- **Verified live** (seeded backend, SA token; **a full end-to-end path now exists** — seed the $3,310 case
  via the Sales/HRM/Clients APIs, then draft/finalize here; created users/reps/clients persist, SA creds
  untouched): **25/25 smoke checks pass** — manager→rep→client+products→27-item sale + greenfield sale →
  bulk-validate → **draft: 70% advance = $2,317.00** (the $3,310 fixture) → **idempotent re-draft** → **bonus
  recomputes net (+$100 exactly)** → **finalize: status finalized, period → paid, sales → paid, holdback
  `amount_held` = $993.00, re-finalize no-op** → **export csv (run → exported)** → **empty period draft → 0
  lines** → **NEGATIVE net via the real clawback path** (claw back a paid $145 item, a tiny next-period sale
  → line `clawback_total` 145, `net_payout` < 0). **Not done (needs a browser):** the light/dark visual pass
  (esp. the line table, the breakdown drawer, and the finalize confirm).

### Clawback UI (built — enter a recovery against a paid/frozen item + list pending→applied)
The entry + list surface for cancellation recoveries (SRS §10). `features/clawback/`. The backend does the
clawback CALCULATION (the engine, off the frozen snapshot) and feeds the deduction into Pay Run; **this UI
computes no money and does no date math**. Reuses the playbook; two pages under the Money nav group.

- **The recovery AMOUNT is SERVER-SOURCED (#1/#6) — confirmed UX "blank = server computes".** The entry form's
  amount field is **BLANK by default** (`ClawbackEntryModal`): leaving it blank **omits `amount`** from the
  POST body so the backend defaults it to the engine's `computeClawbackAmount` (rate + incentive off the
  frozen snapshot). The snapshot **components** (`rate_applied`, `incentive_amount`) are shown **read-only**
  for transparency but the **UI never sums them**; a typed value only overrides. The created clawback's
  **server `amount`** is what the list/toast show. (No preview endpoint exists — this is the only invariant-
  pure way to "show the default.")
- **NO date math (#6):** `reported_date` is captured (default `todayIso()`) and **labelled informational** —
  "drives no logic; no window is computed or enforced." Nothing in the UI reads/computes a 30/60-day window.
- **Only PAID/frozen items clawable (#2):** the pure `clawback.logic.ts#isClawable` = `commission_paid != null
  && item_status != 'clawed_back'`. The snapshot is **never edited** — a clawback is a NEW record.
- **Per-item / no re-tier (#5):** the items panel + the entry modal **state** that a clawback recovers ONE
  item and does not touch the internet activation or re-tier the period.
- **Entry `/clawbacks/new`** (`clawback:create` + `sales:view` to search): a **paid-sale finder**
  (`PaidSaleFinder`) — the Sales API has **no text search**, so it fetches **paid + clawed_back** sales
  (`useSalesQuery` from the Sales feature; a sale flips to `clawed_back` when one item is recovered but its
  other paid items stay clawable) and filters CLIENT-side by Sale ID / customer; a "# clawable items" COUNT
  column. Select a sale → **`PaidItemsPanel`** shows its clawable items (frozen `rate_applied` /
  `incentive_amount` read-only) with a "Claw back" action; non-clawable items are greyed with the reason →
  **`ClawbackEntryModal`**. **422 (not paid) / 409 (double)** surface via `useApiErrorToast` (the panel also
  pre-disables non-clawable items, so they're rare).
- **List `/clawbacks`** (`clawback:view`): `useClawbacks({status?})` + a status filter (all/pending/applied).
  Records are **FLAT** (no joins) → `ClawbackListTable` shows reported_date · amount (`money()`) · reason ·
  `ClawbackStatusBadge` (pending→warning, applied→success; **NOT StatusPill** — sale-only) · **Applied run**
  (period # mapped from `applied_in_pay_run_id` via `usePayRuns()` when `payrun:view`, else "—") · **View
  sale** (`sale_id` → `/sales/:id` for context). Connects to Pay Run: a **pending** clawback is deducted →
  shows **applied + the linked run** once a run finalizes.
- **Reuse:** the Sales feature's `useSalesQuery`/`useSaleQuery` + `Sale`/`SaleItem` types power the finder;
  `sales.types.ts#SaleItem` was **extended** with the real frozen-snapshot fields it already returns
  (`tier_at_payment`, `rate_applied`, `commission_paid`, `incentive_id`, `incentive_amount` — additive; the
  Sales feature is unaffected). The create mutation invalidates **both** `['clawback']` and `['sales']` (a
  clawback flips the item + sale to `clawed_back`).
- **Nav/route:** the Sidebar **Money** group's "Clawbacks" placeholder now links `/clawbacks` (`Undo2`,
  `clawback:view`). Routes: `/clawbacks`, `/clawbacks/new`.
- **Verified live** (seeded backend, SA token; seed a paid item via Sales→validate→Pay-Run-finalize; created
  rows persist, SA creds untouched): **16/16 smoke checks pass** — finalize freezes a paid **$30 TV** item →
  **clawback with no amount → server default `amount` = 30.00, status `pending`** → **a $20 incentive →
  default = 50.00** (engine calc, separate client) → **override `12.34` accepted** → **late `reported_date`
  2030-12-31 accepted (no date math)** → **second clawback on the same item → 409** → **non-paid item → 422**
  → list shows the two as `pending` → **finalize the rep's next period → both flip to `applied` + linked to
  that run**. **Not done (needs a browser):** the light/dark visual pass (esp. the finder, the items panel,
  and the entry modal).

### Billing & Statements UI (built — generate + view the client statement & commission invoice per client·period)
The CLIENT-FACING billing surface (SRS §12). `features/billing/`. The backend prices EVERYTHING from
`client_billing_rates` (effective-dated by `sale_date`); **this UI prices nothing and shows NO commission
data (#3)** — it triggers generation and renders the server's numbers. Reuses the playbook; two pages under
the Money nav group.

- **#3 is structural here:** the feature's data reads are ONLY `/v1/statements`, `/v1/invoices`, `/v1/clients`
  (names), `/v1/pay-periods` (labels) — **ZERO path touches `commission_*`/engine/pay-run money**, and no
  commission amount is ever shown on a statement. The invoice `total_commission` IS the **billing-stream**
  statement total (server) — never the rep payout.
- **The UI prices NOTHING (#1):** generate is a backend call; the statement total + line totals are
  server-sourced; `money()` is display only; **no `sumMoney` on the lines** (the total is the server's
  `total_amount`). **NO GST** — no tax line/field anywhere. **ONE LINE PER CUSTOMER** — the backend aggregates;
  `StatementLinesTable` just renders (customer · products_summary · line_total).
- **Generate / regenerate (`GenerateBillingModal`, `billing:create`):** client + period Selects
  (`ClientPeriodPicker`, reusing `useClients`/`usePayPeriods`) → generate the **statement THEN the paired
  invoice**. Generation **PERSISTS + REPLACES** (no preview endpoint), so when a statement already exists for
  the (client, period) the modal shows an explicit **regenerate-confirm Banner**. On success → the statement
  detail page. The UI states "the server prices from billing rates — this screen computes nothing."
- **UNPRICED 422 → helpful (`UnpricedBanner`):** the backend refuses to under-bill (422 with
  `unpriced:[{product_name, sale_date}]`). To surface the per-product detail, the shared **`ApiError` was
  extended with an optional `details`** (the parsed body) and **`unwrap` now threads the response body
  through** (additive; all features inherit). `billing.logic.ts#extractUnpriced` pulls the array → the banner
  lists each product + date with a link to **Clients & Products** (`/admin/clients/{clientId}`) to add the
  rate.
- **Statement detail `/billing/statements/:id`** (`billing:view`): `useStatement(id)` (lines + total) +
  `useInvoiceFor(client_id, pay_period_id)` (the paired invoice). Renders the **total `StatCard`** (server
  `total_amount`, no client sum), `StatementLinesTable` (one line per customer, NO GST note), and the
  **`InvoiceCard`** (one-line `total_commission` = billing-stream statement total). **Regenerate** (explicit,
  `billing:create`) + **Export** (`BillingExportModal`, pdf/excel, `billing:export`) → stub `file_url`.
- **List `/billing`** (`billing:view`): `useStatements({client_id?, pay_period_id?})` + the `ClientPeriodPicker`
  filter (`allowAll`). Columns: client (name via `useClients` map) · period (`#num` via `usePayPeriods` map) ·
  **total** (`money()`) · generated date · View. **No status badge** — the backend has **no status column**
  on statements/invoices (generated vs exported isn't distinguishable; the list shows the generated date).
- **Nav/route:** the Sidebar **Money** group's "Billing" placeholder now links `/billing` (`FileText`,
  `billing:view`). Routes: `/billing`, `/billing/statements/:id`.
- **Verified live** (seeded backend, SA token; seed client + products + `client_billing_rate`s + confirmed
  sales in a **FUTURE** period — billing rates reject back-dating, so they must be effective on the sale_date;
  created rows persist, SA creds untouched): **18/18 smoke checks pass** — generate → **ONE line per customer
  (2 lines)**, **NO GST field**, **effective-dating by sale_date** (internet $50 up to D2-1 vs $60 from D2 →
  Alice $50, Bob $90), **total $140 server-sourced**; **invoice `total_commission` == statement total**;
  **regenerate → same id, exactly one statement (replace-in-place, no duplicate)**; an **unpriced product →
  422 with `unpriced[]`** (product + sale_date) **that does NOT replace the existing statement**; **export
  statement (excel) + invoice (pdf) → stub `file_url`**. **Note:** effective-dating across a rate change needs
  the earlier rate to be **current** (effective today) so the later future rate **bounds** it rather than
  **superseding** a pending row. **Not done (needs a browser):** the light/dark visual pass (esp. the statement
  table, the generate modal, and the unpriced banner).

### Documents & E-Signature UI (built — REAL: PDF upload · preview · field placement · in-system signing · download)
The documents workflow (SRS §13). `features/documents/`. The backend DERIVES the overall status, enforces
ROW-LEVEL sign/cancel auth, scopes visibility (owner-or-recipient; 404 for outsiders), and STAMPS signed
copies server-side; **this UI displays the server's truth, never re-derives status, models signing as
row-level (not a permission), and computes no money/coordinates the server is authoritative for**. Reuses the
playbook. **Upload + signing are now REAL** (storage + pdf-lib stamping). Two pages under the People nav group
+ a **My Account → Signatures** tab. NEW deps (frontend): `pdfjs-dist` (preview, **lazy** — its own ~360 kB
chunk, loads only on document screens) + `signature_pad` (drawing).

- **Signing is ROW-LEVEL, NOT a permission (the law here, §5).** Sign/decline/cancel carry **no
  `@RequirePermission`**; the pure `documents.logic.ts#findMyPendingSignature(doc, userId)` (current user via
  `useAuth().user.id`) decides whether to OFFER Sign/Decline — only when the user has a **`pending` signature
  in a `pending` request**. **No `documents:sign` anywhere.** The server is the real gate: a non-signer → 403,
  an already-closed request → 409 (both surfaced via the error toast). Cancel shows for requester/owner/admin
  on a pending request (`canCancel`).
- **The overall status is SERVER-DERIVED — displayed, never recomputed.** `DocumentStatusBadge` (draft·shared·
  partially_signed·completed·declined) + `SignerStatusBadge`/`RequestStatusBadge` render `doc.status` /
  request / signer statuses straight from the server. **Decline is terminal** (the modal warns; once declined
  nothing more can be signed).
- **Share == request-signature, UNIFIED (DOC-002, confirmed UX).** One **"Request signatures"** action
  (`RequestSignatureModal`): a `MultiSelect` of users (recipients) + optional message/due-date. Recipients
  become BOTH the shared-with/visibility set AND the asked signers — there is no share-without-signing.
- **Visibility is the server's.** The list returns ONLY visible docs (owner/recipient; Admin/Super see all) —
  the UI never filters. A non-visible **detail fetch → 404 → a GRACEFUL not-found** Banner (`isNotFound(err)`;
  `useDocument` uses `retry:false`), **NOT** an `AccessDenied`/permission error.
- **The detail returns raw user IDs only** (no names) — `useUserLookup` (reuses `useUsers`, gated `users:view`)
  builds an id→name/avatar map; the current user resolves to **"You"** (`useAuth`), an unknown id to a short
  id. **There is NO audit-timeline endpoint** — `DocumentTimeline` is **composed** from the detail's nested
  `signature_requests` + `document_signatures` (request created · each sign with `signed_at` · declines); IP +
  full audit_log aren't exposed (a flagged backend follow-up). Declines carry no timestamp in the response.
- **Upload is REAL + PDF-only** (`UploadDocumentModal`, `documents:create`): a multipart PDF + title + doc_type
  via the shared `lib/api/multipartUpload.ts` (bearer from the session) → `POST /v1/documents`; non-PDF guarded
  client-side + the server 422s. The **original is stored once + never mutated** (DOC-001/004).
- **Preview + download = pdf.js + access-controlled URLs.** `PdfDocumentView` (lazy) renders all pages to
  canvases + exposes each page's display size for overlays; `DocumentPreview` wraps a `…/file-url` query.
  Every file (original / per-signer copy / final copy / saved signature) is fetched via a **short-TTL signed
  URL** from an RBAC/visibility-gated endpoint (`useDocumentFileUrl`/`useCompletedFileUrl`/`useSignatureFileUrl`);
  `DownloadLink` is the download/open anchor. The object path is never exposed.
- **Field placement** (`FieldPlacer`, in `RequestSignatureModal` behind a Switch): the requester places
  signature/initial/date/text fields per recipient on the PDF (drag to move, corner to resize), stored as
  normalized 0..1 fractions (top-left) sent with the request. No fields → a simple click-to-sign.
- **In-system signing** (`SignDeclineModal`): preview the document with the signer's fields highlighted, apply
  a signature (**a saved one, drawn via the `SignaturePad` ui primitive, or typed → PNG**), fill text fields
  (dates auto server-side) → the server stamps a per-signer copy. A **"sign outside the app"** path uploads an
  externally-signed PDF (`/sign-upload`, method=uploaded). The signature image goes up as `signature_id` (saved)
  or `signature_image` (inline data-URL).
- **Saved signatures** (`features/account` → Signatures tab): list (image thumbnails via own-scoped file-url),
  create by **draw / type / upload**, set default, delete — own-scoped, no permission. Shared helpers in
  `lib/signature.ts` (`dataUrlToFile`/`typedSignatureDataUrl`).
- **Nav/route:** the Sidebar **People** group's "Documents" item links `/documents` (`FileSignature`,
  `documents:view`). Routes: `/documents`, `/documents/:id`.
- **Verified LOCAL only** (tsc + build + lint + stylelint green; `PdfDocumentView` is its own lazy chunk;
  backend 74 suites / 394 tests green incl. real pdf-lib stamping on an in-memory PDF + the `original never
  mutated` assertion). The operator applies `migrate deploy` (the `documents_esign_real` migration) + sets the
  Supabase creds; the **live + light/dark + real preview/stamp visual pass needs a browser** with storage
  configured. The earlier 18-check smoke predates the storage/stamping rewrite (the workflow assertions still
  hold; re-run against Supabase to exercise the real files).

### Data Import & Integration UI (built — the stage → reconcile → commit wizard)
The import wizard (SRS §15). `features/import/`. The backend does ALL pipeline work (staging, matching, the
reconcile-before-commit GATE, the ATOMIC + idempotent commit, the 3 handlers); **this UI walks the steps and
RECONCILES — it does NO matching/commit logic**. Unblocks **bulk sales validation** (drives the Sales
`validateWithinTx` seam server-side). Reuses the playbook; real Excel/CSV parse stays **STUBBED** (§12). Three
pages under the Administration nav group.

- **The UI does NO matching/commit logic.** STAGE feeds rows (the backend classifies → matched/unmatched/
  duplicate/error/ignored); RECONCILE asks the backend to match/edit/ignore a row; COMMIT is the backend's
  **ATOMIC + IDEMPOTENT** apply (#8). The `import.logic.ts` helpers only **parse the JSON editor** and
  **mirror the gate to disable + explain** — never match or apply.
- **Rows entry = JSON editor + per-type template (confirmed UX; parse stubbed §12).** `RowsEditor` = a
  Textarea pre-fillable with the kind's **template** + a **stub `FileUpload`** that reads a selected `.json`
  file into the editor (the real Excel/CSV parse is deferred). `parseRows` validates a non-empty array of
  objects client-side before staging. **Batch A #2 fixed** the `rows`/`mapped_data` swagger quirk
  (`additionalProperties:true`), so the generated `CreateImportDto`/`ReconcileDto` are used directly — the
  hand-written request bodies + boundary casts were **dropped**.
- **The 3 kinds** (`KINDS` in `import.types.ts`; the UI offers only these, so an unsupported pairing can't be
  staged): **Bulk sales validation** (`client_report+sales`, needs `client_id`; commit drives the Sales seam),
  **Historical billing rates** (`master_migration+clients`, back-dated — the sanctioned #10 path), **Opening
  holdback balances** (`balance_migration+holdback`, needs `reconcile_total`; origin must be closed/paid).
- **STAGE** (`NewImportPage`, `import:create`): kind Select + (client / reconcile_total when needed) +
  `RowsEditor` → POST → the batch detail. **REVIEW + RECONCILE** (`ImportDetailPage`, `import:view`):
  `StepIndicator` (Stage→Reconcile→Commit) + count `StatCard`s + `ImportRowsTable` (per-row status + the
  mapped data + matched target + the **issue**). While staged, a kebab per row (`import:edit`): **Match a
  sale** (`MatchSaleModal` — reuses the Sales `useSalesQuery({status:'entered', client_id})` finder →
  reconcile `match`), **Edit data** (`ReconcileEditModal` → fix `mapped_data` JSON → reconcile `edit`, server
  re-classifies), **Ignore** (direct reconcile `ignore`).
- **The reconcile-before-commit GATE:** the **Commit** button (`import:approve`) is **disabled while
  `outstandingCount > 0`** (unmatched+duplicate+error) with a Banner naming what's outstanding — the UI
  prevents it and the **server 422 is the real gate** (incl. the holdback `reconcile_total` ≠ staged-sum
  check, which the **UI never computes** — it shows the value + a note and surfaces the server's message).
- **COMMIT** (`CommitConfirmModal`): a deliberate confirm that **explains the per-kind atomic apply**
  ("validates the matched sales / writes the back-dated rates / writes the opening holdback — one transaction,
  cannot be undone"), **double-submit-safe** (`isPending` disables). On success the batch is **committed +
  locked** (read-only; shows `committed_at` + "N matched rows applied"); **re-commit is a backend no-op and is
  NOT offered**.
- **Nav/route:** the Sidebar **Administration** group's "Import" placeholder now links `/import` (`Upload`,
  `import:view`). Routes: `/import`, `/import/new`, `/import/:id`.
- **Verified live** (seeded backend, SA token; created users/reps/clients/batches persist, SA creds untouched):
  **20/20 smoke checks pass** — **Bulk validation**: stage 3 rows → 2 matched + 1 unmatched → **commit while
  unreconciled → 422 (gate)** → reconcile (ignore) → **commit → committed**, the matched sales **validated via
  the Sales seam**, **re-commit → no-op** → **ATOMIC ROLLBACK** (re-point a row at an already-validated sale →
  commit throws → **batch stays staged + the good row's sale rolled back to entered**). **Historical rates**:
  back-dated rate (`effective_from 2025-01-01`) → matched → commit (**bypasses the live 422**). **Opening
  holdback**: a **paid** period (finalized) + a **second rep** (no ledger) → **reconcile_total 999 ≠ 100 →
  422**, then **=100 → committed**; an **open-origin row → error** + commit blocked. **Not done (needs a
  browser):** the light/dark visual pass (esp. the rows table, the reconcile modals, and the gate).

### Chatbot UI (built — the FINAL screen; a thin surface over the leak-proof, intent-only assistant)
The natural-language assistant (SRS RPT-011). `features/chatbot/`. The backend is **structurally leak-proof**:
the (stubbed) LLM returns an **intent only** (no ids/SQL) and the entitlement-gated tools take **only the
AuthUser**, so a user can only ever get their own-scope data. **This UI is a THIN SURFACE** — it sends a prompt
and renders the server's scoped text answer; it does **NO data access of its own** and enforces **NO scope**.
Reuses the playbook. One page under the Dashboards nav group.

- **THIN SURFACE (the law here, §5).** The feature's ONLY network call is `POST /v1/chatbot/query`
  (`useChatQuery`). **ZERO other data fetch** — no path reads sales/commission/holdback/etc. to "help" the
  bot. The UI renders the answer text and applies no scope logic; the backend is the guarantee.
- **Authenticated-only — no permission gate.** The endpoint carries no `@RequirePermission`, so the page has
  **no `useCan`/`AccessDenied`** and the Sidebar item (`show: () => true`) is shown to **every** signed-in
  user. Per-user scope is enforced **server-side** in the tool layer (`isToolAllowed` + tools that take only
  the AuthUser): self tools need a linked rep, roster needs manager/admin, business needs Super Admin — a
  disallowed tool returns the **refusal** text.
- **Text-only response** `{ conversation_id, intent, answer }` — `answer` is a string the server already
  formatted (no structured data). **Refusals / unrecognized prompts come back as a normal 200** → rendered as
  ordinary assistant bubbles (graceful "I can't answer that"), NOT errors. Only a **400** (empty / >500-char)
  or a network failure is a real error → `useApiErrorToast` (the typed prompt is kept).
- **SESSION-ONLY conversation.** There is **no history endpoint** (conversations persist server-side for audit
  only), so the thread lives in **component state** — navigating away/reloading clears it (the banner says so).
  No invented persistence.
- **HONEST stub framing (§12).** The stubbed LLM recognises **5 keyword intents** (`my_sales_count`,
  `my_commission`, `my_holdback`, `roster_summary`, `business_summary`; else `unknown`). A `Banner` frames it
  as a **preview with limited capability**, and `SuggestionChips` (the 5 example prompts) make it usable + show
  what it can answer. Assistant bubbles show a **subtle intent chip**; the `MessageBubble`/`ChatMessages`/
  `ChatInput` (Enter sends, Shift+Enter newline; auto-scroll; a "thinking" indicator) are hand-built from
  foundation components (no chat lib).
- **Nav/route:** the Sidebar **Dashboards** group gained an **"Assistant"** item (`Sparkles`, `/chatbot`,
  shown to all). Route: `/chatbot`.
- **Verified live** (seeded backend; a rep fixture — a Sales-Rep user **linked** to a rep — proves per-user
  scoping; created user/rep persist, SA creds untouched): **10/10 smoke checks pass** — **SA (no linked rep)**:
  `business_summary` **allowed** (real answer), `my_commission` **refused** (no rep), `unknown` refused,
  **>500-char → 400**, **empty → 400**; **rep**: `my_commission` **allowed** (own scope), `roster_summary`
  **refused** (not a manager), `business_summary` **refused** (not SA) — same prompts, different allow/deny per
  user, proving the server's leak-proof scoping while the UI just renders. **Also fixed:** a corrupted
  `components/ui/Breadcrumbs.tsx` (a missing interface `}` — an IDE truncation) restored so the build passes.
  **Not done (needs a browser):** the light/dark visual pass (the conversation + input).

### Shared data primitives + the SERVER-SIDE list contract (built — adopt these on every new list/form)
A batch of shared primitives + an app-shell pass. **New screens MUST reuse these** rather than reinventing.

- **SERVER-SIDE list contract (arch §5.1) — `{ data, meta }`.** List endpoints accept `?page=&limit=&sort=field:dir&search=` (+ their filters) and return `{ data: [...], meta: { total, page, limit, pageCount } }`. **`page` is 1-based**, `limit` default 20 / **max 100**. Shared backend primitives in **`common/pagination/`**: `PaginationQuery` (base DTO feature query DTOs `extends`), pure `paginate.ts` (`toSkipTake`/`buildPage`/`resolveOrderBy(sort, allowlist, fallback)` — the **allowlist is the orderBy-injection guard**), `PageMetaResponse`. A service builds `where` (preserving `ScopeService` scoping + filters + a `search` OR-filter), then `Promise.all([findMany({where,orderBy,skip,take}), count({where})])` → `buildPage`. Each list has a per-entity `*PageResponse` DTO (`@ApiProperty({ type: () => [X] })` + `@ApiOkResponse`). **Done on `/v1/sales` + `/v1/clients`; new `GET /v1/products` (cross-client, `clients:view`)**; the nested `/v1/clients/{id}/products` stays a plain array. **Indexes** added (`sales` status + `client_id,sale_date`; `clients` is_active; `products` client_id,is_active + product_type) via the hand-authored `add_list_pagination_indexes` migration (CREATE INDEX only — applies with `migrate deploy`, no shadow DB).
  - **Ripple:** moving an endpoint to `{data,meta}` breaks every dropdown/finder that unwrapped it as an array. The fix pattern: keep the array-returning hook (`useClients`, `useSalesQuery`) but **unwrap `.data` with a capped `limit` (100)**; add a SEPARATE paginated hook (`useClientsPage`/`useSalesPage`) for the management DataTable. (Finder/dropdown reads cap at 100 until a typeahead combobox lands.)
- **`<DataTable>`** (`components/data/DataTable.tsx`) — the enterprise list surface over the `Table` primitives: `DataColumn<Row,SortKey>[]` (header/align/numeric/`sortKey`/`render`), server `sort`+`onSortChange`, pager (`page/pageCount/total/limit/onPageChange`), controlled selection (`selectedIds`/`onSelect`/`isRowSelectable`/`onToggleAll`, tri-state select-all), `rowActions`+`bulkActions` slots, and a **dedicated FORBIDDEN state** (`isForbidden(error)` → friendly panel, **not** "Failed to load"). The server-driven list hook (`useSalesList`/`useClientsTable`/`useProductsTable`) owns page+sort state and resets to page 1 on a filter/sort change. **Reference adoptions: Sales, Clients, Products** — copy their shape.
- **`<ConfirmDialog>`** (`components/ui`) — confirm on `Modal` that restates the consequence; **`requireTyped`** gates irreversible/financial actions (type a phrase to enable). Used for bulk soft-delete; **finalize/clawback can adopt it**.
- **`exportRows` + `<ExportMenu>`** (`components/data`, `lib/export/`) — CSV (hand-rolled), Excel (**`write-excel-file`**) + PDF (**`jspdf`+`jspdf-autotable`**) **dynamically imported** (load only on export). Caller passes `getRows()` (a paged `fetchAll*` respecting filters, OR the selection). **Print** = browser dialog + a print stylesheet (`#main-content` only; `.no-print` opt-out in `base.css`). Chose `write-excel-file` over SheetJS `xlsx` (parse-side CVEs) / `exceljs` (pulls `jimp→request`).
- **`<DatePicker>`** (`components/ui`) — a custom token-styled calendar in a Radix Popover; value/onChange **always `'YYYY-MM-DD'`**, opens to today, optional min/max. **Replaced every native `<input type=date>`** (OS-locale bug). **`<PayPeriodSelect>`** (`components/data`) — effective-dated config selects a **pay period** (`Period N · start–end`), emitting the period's start (`effective_from`) or end (`effective_to`, with open-ended); future-only (server rejects back-dating). Used in the billing-rate + commission config modals (BRD §9.4 / SRS §6.2).
- **`<SelectWithOther>`** (`components/ui`) — a Select that reveals a text input on "Other" → `{ value, other_text }`. Available wherever free entry is needed.
- **Overlays + z-index + responsive shell.** Radix menus already portal; the clip fixes were (a) `max-height: var(--radix-*-content-available-height)` + `overflow-y:auto` on the Select/DropdownMenu/Popover viewports, and (b) **reordering the z-index ladder so floating menus (dropdown/select/popover = 1300) sit ABOVE modal/drawer content (1200)** — a Select opened inside a Modal was rendering behind it (both portal to `<body>`; z-index decides). The shell is now responsive on the design-system §8 breakpoints (`--bp-mobile 640` / `--bp-tablet 1024`, `lib/useMediaQuery`): **<640px** sidebar → off-canvas drawer (hamburger); **640–1024** icon rail; **>1024** full. `.sr-only` helper in `base.css`.
- **Global search** (`GET /v1/search?q=`, `modules/search/`) — authenticated; the SERVICE scopes each group to the caller's perms (reps→`hrm:view`, clients→`clients:view`, sales→`ScopeService`). **No new RBAC permission** (the role-permission matrix is unchanged). FE: `features/search/GlobalSearch` is the real top-bar box (debounced, grouped results, deep-links).
- **Verified LOCAL only** (build + lint + stylelint + 329 backend tests green; the `add_list_pagination_indexes` migration is applied by the operator with `migrate deploy`). The light/dark + live-data visual pass needs a browser/running backend.

### Notifications overhaul + SA event management/broadcast + dead-tab fixes (built — Notifications batch)
A real, Super-Admin-manageable notification system + the previously dead Reps/Reports/`/users` tabs fixed.
The architecture below is durable — reuse it; don't reinvent.

- **The emitter seam is PROMOTED to `common/notifications/`** (`notification-emitter.ts`: `NOTIFICATION_EMITTER`
  token + `NotificationEmitter {emit, emitMany, emitRole}` interface + `NotificationEvent` with optional
  `variables`). `NotificationsModule` (`modules/reporting/`) is **`@Global()`** and binds it via
  `NotificationEmitterAdapter`, so **any** domain module injects `@Inject(NOTIFICATION_EMITTER)` with no
  import + no cycle (NotificationsService depends only on Prisma/Audit/`EMAIL_DISPATCHER`). Emits are
  **post-commit, best-effort** (never inside a `$transaction`, never throw to the originating action); rep
  `user_id` is nullable → **`emitMany` centralizes the null-skip**. `emitRole(event, roleName, payload)`
  targets active users in a role. **Templates render in `notify`** via the pure
  `common/notifications/render-template.ts#renderTemplate(tpl, vars, fallback)` — `{var}` substitution that
  **falls back to the complete call-site text if ANY token is unfilled** (never shows a raw `{placeholder}`).
- **Catalogue (bootstrap, idempotent):** **17 automatic events** + `broadcast`, each with `label` +
  `title_template` + `body_template` (new nullable `NotificationEventSetting` columns). The upsert `update`
  refreshes label/templates but **never clobbers** the SA's channel toggles. The documented
  **recipients + variables per event** live in `frontend/src/features/notifications/eventCatalogue.ts`
  (mirrors the emit sites) — shown read-only in the editor. **A genuinely NEW automatic trigger needs a code
  change** (a new emit call); the SA manages wording/channel, not trigger logic.
- **API (own-scoped, paginated):** `GET /v1/notifications` → `{data, meta}` (PaginationQuery: page/limit/
  sort/search + `is_read`); `GET /unread-count`; `PATCH /:id {is_read}` (replaced `/:id/read`);
  `POST /mark-all-read`; `POST /mark-read {ids, read}`; `POST /broadcast` gated
  **`@RequirePermission('notifications','broadcast')`**. Settings GET/PATCH carry label/title/body templates.
- **Frontend:** the bell shows a **numeric unread-count badge** (`useUnreadCount`, `refetchInterval 60s` +
  `refetchOnWindowFocus`); **`lib/notifications/resolveLink.ts`** deep-links a notification to its record by
  `related_entity_type`; clicking marks read + navigates. **Notification Center** `/notifications` (DataTable:
  unread/all filter + search, bulk mark read/unread, row click-through). **SA event management** extends the
  settings editor (per-event channels + title/body template inputs + read-only recipients). **Broadcast
  composer** `/admin/broadcast` (audience everyone/role/specific-users, gated `notifications:broadcast`).
- **Dead-tab fixes:** `features/reps/` (server-paginated roster on DataTable, `/admin/reps`, `hrm:view`);
  `features/reports/ReportsLandingPage` (hub of dashboard cards, `/reports`, `reports:view`); router gained
  `/users`→`/admin/users` + `/reps`→`/admin/reps` redirects and a friendly **catch-all `NotFoundPage`** so no
  path dead-ends. Sidebar Reps/Reports items now carry a `to`.
- **Paginated `GET /v1/reps`** (`buildPage`, sort allowlist `rep_code/full_name/status/hire_date/created_at`,
  PII redaction preserved) — the contract was regenerated.
- **Verified LOCAL only** (backend build + affected specs green; frontend build + lint + stylelint green). The
  **operator applies the migration (`migrate deploy`) + re-seeds bootstrap** (idempotent) against Supabase to
  add `notifications:broadcast` + the 17-event catalogue/templates. Light/dark + live-data visual pass needs a
  browser.

### Configurable product types · rate-card CRUD · client custom fields · commission CRUD (built — Config batch)
The deployment-config surfaces are now runtime-managed. Reuse these patterns; the invariants below are load-bearing.
- **Product-type catalogue (the engine's behaviour seam).** `product_type_catalogue` (key PK · label ·
  `behaviour` enum `tiered|greenfield|standard_addon` · `is_system` · `is_active`) replaced the fixed Prisma
  `ProductType` enum (dropped); `products`/`commission_flat_rates`/`incentives.scope_product_type` are String
  FKs → `catalogue.key`, `sale_items.product_type` is a plain snapshot (no FK, #2). **CRUD lives in the
  COMMISSION module** (it's an engine-config concept): `GET /v1/product-types` (authenticated reference) +
  `POST`/`PATCH /:key` (`commission:edit`). **A new type is FORCED `standard_addon`** (behaviour never
  client-supplied) so it can NEVER change tally/greenfield logic (#5/#9); the 4 core types are `is_system`
  (behaviour immutable, non-deletable, non-deactivatable). **Q2: create may carry an inline COMMISSION flat
  rate** written to `commission_flat_rates` in the same `$transaction` (the catalogue row stores no rate — #3
  holds; this is the commission stream, distinct from the product inline CLIENT-BILLING rate). FE:
  `features/productTypes/` (DataTable manager at `/admin/product-types`) + `useProductTypes()`; the hard-coded
  `PRODUCT_TYPES` arrays were replaced by the live catalogue in the product / flat-rate / incentive / filter
  dropdowns; `productTypeLabel` humanizes unknown SA keys.
- **`billing_rates` module (SA-only).** The 17th RBAC module — its 6-action grid gates the client rate cards,
  granted to **Super Admin only** by default (Admin/Manager/Rep lose default rate visibility; a custom
  Business-Partner role can be granted `billing_rates:view`). The nested `/v1/clients/:id/billing-rates`
  endpoints were re-gated (`view`/`create`) and gained **`PATCH`/`DELETE .../:rateId`** (`edit`/`delete`).
- **Rate-card + commission CRUD honour #10 (pending-only edit/delete).** `billing-rates.service` +
  `tier-schedule`/`flat-rate`/`holdback` services gained `update`/`remove` restricted to **pending** rows
  (current/past → 422, supersede instead); edit re-runs `planSupersession`, delete re-opens any predecessor it
  had bounded (no gap). Shared `commission/effective-edit.util` (`assertPending`/`resolveEditWindow`).
  Incentives gained `remove` (only if no `sale_item` references it — else end it, #2). FE: `EffectiveDatedTable`
  grew an optional `rowActions` slot; the clients `BillingRatesPanel` (gated `billing_rates:view`, hidden
  otherwise) + the commission sections offer pending-row Edit (reusing the create modals in an edit mode) +
  Delete (`ConfirmDialog`); tier-edit = delete + re-add (the bracket editor is the create surface).
- **Product create inline CLIENT-BILLING rate** — `CreateProductDto.initial_billing_rate` (rate_kind
  `product`) written with the product in one tx; providing it additionally requires `billing_rates:create`.
- **Client custom fields** — `client_custom_fields` (name/value + display_order, no cascade); Create/Update
  client accept a `custom_fields[]` REPLACED in a tx; the detail GET includes them. FE: a `useFieldArray` on
  `ClientFormModal` (edit fetches the detail first so existing fields load before a save — never wiped) +
  display on `ClientDetailPage`.
- **Two hand-authored migrations** (`product_type_catalogue`, `client_custom_fields`) — operator runs
  `migrate deploy` + re-seeds bootstrap (idempotent: 4 core types `is_system`, the `billing_rates` grid).
  **Verified LOCAL only** (backend 68 suites/350 tests + build green; contract regen; frontend build + lint +
  stylelint green). Light/dark + live-data visual pass needs a browser.

### Dashboards & Reporting overhaul (built — Operations queues · Business KPIs · trends · scoped Manager/Rep · greenfield)
The read-layer is now real end-to-end. **Money invariant holds throughout: dashboards are READ-ONLY aggregation
over frozen tables — no commission is recomputed, no new money logic.** Reuse these patterns.
- **`reports:business` (off-grid, SA-only)** — a `business` `PermissionAction` value (migration
  `reports_business_action`) seeded off-grid; gates `GET /v1/dashboards/business` + `…/business/trends`. The
  `SalesTarget`/`sales_targets` entity ALREADY existed (original 48-entity schema / init migration) — no new
  table; BE-4 wired its CRUD.
- **Business dashboard (`dashboards.service#business`)** — period-aware (default = current period). KPIs READ
  from frozen tables: revenue (`client_statements.total_amount`), payout (`pay_run_lines.net_payout`), net
  margin $/% (display), holdback {held/scheduled `holdback_ledger`, released `pay_run_lines.holdback_release_30`},
  clawback total + **rate** (= clawback ÷ `commission_70`), expense km/other (`expense_items` by category),
  activations by product/client + internet + greenfield $ (`sale_items.commission_paid`), validation funnel,
  tier distribution (all active reps bucketed via `countToTier`), client mix, and PoP growth. One bounded
  confirmed-items `findMany` reduces the count breakdowns in JS.
- **Trends (`#businessTrends`, `GET …/business/trends?periods=N`)** — last N periods (≤24) reduced from single
  `findMany` passes; returns headline series + `by_product` / `by_client_revenue` / `tier_distribution` over
  time. **Bounded in-app aggregation; materialized views stay deferred.**
- **Manager (`#manager`)** — roster AGGREGATE money (payout/holdback) + top performers by activation count +
  target-vs-actual ALWAYS; **per-rep payout + money-ranking only when the caller holds `hrm:edit`** (the
  payment_details gate), built/omitted server-side (`can_see_rep_money`). **Rep (`#rep`)** — adds own target +
  recent sales. **Targets** (`targets.{service,controller}`): `GET /v1/sales-targets` (scoped) + `PUT`
  (`hrm:edit` + roster-scope check).
- **FE** — `features/dashboards/`: business page rebuilt (KPI `StatCard`s + funnel + by-product/tier/client
  bars + `BusinessTrends`); new token-themed `ThemedLineChart` / `ThemedStackedAreaChart` + `SeriesTooltip`
  (colours from `--chart-N`, lazy-loaded). Manager/Rep pages scoped (roster aggregates, `SetTargetsModal`,
  rep target + recent-sales). **Operations queues** are all live (`AdminQueueCard` `to` for every card; a
  `/documents?queue=awaiting-signatures` preset + the `pending_signatures` documents filter, with the admin
  count counting those DOCUMENTS so count==queue); **expense approvals gained bulk-approve** (`BulkActionBar`).
- **Greenfield** — `Switch` gained `tone="success"` (grey off / green on); `SaleForm` uses it; `GreenfieldBadge`
  is now green "Greenfield" / muted "Standard", shown across the sales list/detail/validation queue.
- **Verified LOCAL only** (backend 69 suites/358 tests + build green; contract regen — 2 enum migrations
  `reports:business` only; frontend build + lint + stylelint green). Operator: `migrate deploy` + re-seed
  bootstrap to add `reports:business`. Light/dark + live-data visual pass needs a browser.
