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
- **`docs/build-log.md`** — the per-batch build history (37 entries, oldest first): what each batch established and **why**, the bugs it fixed and their causes, its migration, what it deferred. Not loaded into context — read the relevant entry before reworking an area. The **rules** distilled from it live in §13/§14 here, which win on any disagreement.

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

## 2.5 Commands (build · test · contract · migrate · seed)

npm **workspaces** monorepo (`backend`, `frontend`, `contract`); run everything from the repo
root with `-w`. Numbered `2.5` on purpose — §3–§13 are cross-referenced by number from this file,
`docs/*.md`, and code comments, so they are never renumbered.

### First run on a fresh clone

```sh
npm install                                   # root; workspaces are hoisted
cp backend/.env.example backend/.env          # then edit: DATABASE_URL, JWT_* secrets
cp frontend/.env.example frontend/.env        # optional (Maps key, API origin)
npm run prisma:generate                       # Prisma client from schema.prisma
npm -w frontend run gen:api                   # REQUIRED — see below
npm -w backend run prisma:deploy              # apply the migrations to your DB
npm -w backend run prisma:seed                # bootstrap catalogue (+ SEED_DEMO=yes for demo data)
```

**`gen:api` is not optional on a fresh clone.** `frontend/src/api/generated/` is gitignored
(`.gitignore` `**/generated/`), so `schema.d.ts` does not exist until you generate it and
`npm -w frontend run build` fails until you do. It reads the **committed**
`contract/openapi.yaml`, so it needs no running backend and no database.

### Dev servers

```sh
npm run dev:backend     # NestJS :3000 — /health, Swagger /docs (dev only)
npm run dev:frontend    # Vite :5173 — proxies /v1, /api, /health → :3000
```

### The verification gate

This is the runnable form of what every `docs/build-log.md` entry calls *"Verified LOCAL"*. Run it before
calling a piece of work done:

```sh
npm -w backend run test              # jest
npm -w backend run lint
npm -w backend run build             # nest build — this IS the backend typecheck
npm -w backend run contract:export   # only when an endpoint/DTO changed → contract/openapi.yaml
npm -w frontend run gen:api          #   "  must follow contract:export (see below)
npm -w frontend run build            # tsc --noEmit && vite build
npm -w frontend run lint
npm -w frontend run stylelint        # token enforcement — no raw hex/px outside theme.css (§13)
npm -w frontend run test             # vitest
```

### Running a single test

Backend jest: `rootDir` is `src`, `testRegex` is `.*\.spec\.ts$`; the positional argument is a
regex matched against the file path.

```sh
npm -w backend exec -- jest src/modules/engine/commission-engine.service.spec.ts
npm -w backend exec -- jest commission-engine         # path pattern
npm -w backend exec -- jest -t "cross-client"         # by test name
npm -w backend exec -- jest --watch commission        # watch a subset
```

Frontend vitest:

```sh
npm -w frontend run test -- saleExport                          # positional filter
npm -w frontend exec -- vitest run src/features/sales/saleExport.test.ts
npm -w frontend exec -- vitest                                  # watch
```

### Database & seeds

| Command | Does | Who runs it |
| --- | --- | --- |
| `npm -w backend run prisma:migrate` | `migrate dev` — **authors** + applies a new migration | developer, local only |
| `npm -w backend run prisma:deploy` | `migrate deploy` — **applies** pending migrations, authors nothing | operator / CI / prod |
| `npm -w backend run prisma:seed` | bootstrap catalogue (idempotent); demo data **only** under `SEED_DEMO=yes` | both — prod deploys run this |
| `npm -w backend run seed:reset` | handover clean-wipe of transactional data, keeps the master catalogue | operator; needs `RESET_CONFIRM=yes` |
| `npm -w backend run sa:reset` | Super Admin password/lockout recovery | local only; needs `RESET_SA_CONFIRM=yes` |
| `npm -w backend run prisma:studio` | Prisma Studio | developer |

Never run `prisma:migrate` against a deployed database — it can reset it. Operators run
`prisma:deploy`. Details of what each seed writes are in §4.

### Gotchas (each of these cost real time to rediscover)

- **Root `npm test` runs the backend jest suite only.** Frontend vitest is a separate command.
  There is no root aggregate for typecheck, stylelint, or frontend tests — run them per workspace.
- **`contract:export` → `gen:api` is one unit.** Running the first without the second leaves the
  frontend typed against a stale contract, and the drift surfaces as a confusing `tsc` error in
  an unrelated feature.
- **`backend/tsconfig.json` `include` is `src/**/*` only**, and the seed entry runs with
  `--transpile-only`. So `backend/prisma/` (seeds) and `backend/scripts/` are **never
  typechecked** — this is exactly how the `demo.ts` argument drift recorded in §12 stayed hidden
  until someone ran `SEED_DEMO=yes`.
- **PowerShell is the primary shell here.** `&&` chaining is unavailable in Windows PowerShell 5.1
  — use `;` with an `if ($?)` guard, or the Bash tool.

---

## 3. THE INVARIANTS (never violate)

These are the rules that, if broken, produce wrong money or a privacy/security breach. Treat them as hard constraints.

1. **Exact-decimal money, never floats.** All monetary values use a decimal type / integer minor units. No `number` float arithmetic on money, ever. *In API DTOs money is a validated decimal **string** (never a JS `number`), stored as Prisma `Decimal` and serialized back as a string.*
2. **Sale-item snapshots are immutable.** When a `sale_item` is paid, its `tier_at_payment`, `rate_applied`, `commission_paid`, and `incentive_amount` are frozen. Never update a snapshot. Corrections happen via a **new** clawback/adjustment record.
3. **The two rate streams never mix.** `client_billing_rates` (what we charge the client) and the `commission_*` tables (what we pay the rep) are separate, with no code path that joins or combines them. (This was the prior system's core defect.)
4. **No in-system clawback date math.** The system does **not** compute or enforce 30/60-day windows. A clawback is entered manually when the client reports a cancellation, at any time. Recover the exact amount from the snapshot.
5. **Gross tally, never re-tier.** The commission tier is computed from the **gross** internet activation count for the period and applied to every internet activation in it. A cancellation **never** recalculates a period's tier. (Cancellations are flat clawbacks — see #6.) **The tally is CROSS-CLIENT and stays client-blind.** Commission tier schedules and flat rates can each be **scoped to one client** (a `client_id`-null row is the GLOBAL fallback), but that scopes only the **rate lookup** — never the tally. The engine counts every internet activation across all clients into ONE number, then looks the bracket up on each activation's own client schedule (falling back to global). A per-client tally would be the "per-client tallies are wrong" defect in §6.
6. **Clawback is a flat deduction.** A clawback subtracts the exact amount originally paid (incl. any incentive) from the rep's pay-run total. No 70/30 sequencing. Per `sale_item`, so one product can be clawed back without touching others on the same sale. *Built (`modules/clawback/`): entry targets a **PAID** `sale_item` (frozen `commission_paid` ≠ null, else 422); the amount is the engine's `computeClawbackAmount` from the snapshot (rate + incentive) — the snapshot is **never edited** (#2), the period is **never re-tiered** (#5), there is **no date math** (#6), and only the target item + its sale flip to `clawed_back` (one clawback per item). It is `pending` until a pay run deducts it, then `applied` + linked. The `CLAWBACK_TOTAL_PROVIDER` seam is rebound to `ClawbackPayrunProvider`; finalize calls `markApplied(...)` in its transaction so the deduction is recorded exactly once.*
7. **`sale_date` governs the pay period.** Not validation date, not activation date. `activation_date` is stored for reference only and **drives no logic**. *Built (Sales): `sales` has **no `pay_period_id` FK**, so the period is **derived** from `sale_date` via the pure `modules/sales/pay-period.logic.ts#resolvePayPeriod` (period whose `[start,end]` contains `sale_date`). Validation never touches `sale_date`. Pre-loading `pay_periods` is Pay Run's job — derived period is null until then.*
8. **Pay-run finalize is atomic and idempotent.** One DB transaction; an `Idempotency-Key` so a retry never double-pays or double-releases a holdback. Finalize is what freezes the snapshots (#2). *Built (`modules/payrun/pay-run.service.ts`): the whole finalize runs in **one `prisma.$transaction`** (a mid-step throw rolls back entirely). `pay_runs` has **no idempotency-key column**, so idempotency is **state-based** — re-finalizing a non-draft run is a no-op, plus freeze-once guards (sales become `paid`; one `holdback_ledger` row per rep+origin). Finalize freezes `sale_item` snapshots, transitions sales Validated→in_pay_run→paid, records the 30% hold, releases due prior holds, applies bonuses, composes net.*
9. **Greenfield is excluded from the tally** and flat-rated; the tally is computed from each sale's **confirmed state at period close**.
10. **Configuration is effective-dated, read at runtime — never hard-coded.** Tiers, rates, holdback %, incentives, products, billing rates. A change is a new effective-dated row; it never rewrites a closed period. *The supersession pattern is a **shared pure module** `common/effective-dating.ts` (`planSupersession`/`selectEffectiveRate`/`deriveStatus`): a new future row **supersedes** the scope's pending row (deleted) and **bounds** the current row's `effective_to` to the day before; **back-dating is rejected (422)**; selection picks the row in force on a date. Used by Clients billing rates (scope = client+product+rate_kind) and Commission Config (tier schedule = global; flat rates = per product_type; holdback split = global). The holdback-**release** setting is sticky (latest wins), not supersession-dated.*
11. **Rep codes are never reused** — including codes of terminated reps. Enforce uniqueness at the DB level. *Built in `modules/hrm/reps.service.ts`: a **case-insensitive service pre-check** across **all** reps (any status) rejects reuse with `409`, with the DB `@unique` as a backstop. Termination is a **soft status change** (never a delete), so a terminated rep's row persists and its code stays reserved. rep_code is immutable after creation.*
12. **Captured FX rates and their converted CAD amounts are frozen — never re-converted** (Meeting 3; treat like immutable snapshots #2). Foreign-capable records store the fieldset `{original_amount, original_currency, fx_rate, fx_rate_date, amount_cad}`. The rate/`amount_cad` are captured **once** at a single defined event and never recomputed: **client-bill FX freezes at document ISSUE** (statement/invoice/client-expense-doc — never on preview; a correction re-issues a new numbered doc with a fresh rate), **rep-expense FX freezes at APPROVAL**. Reconciliation and all roll-ups read the stored `amount_cad`; the original amount + currency + rate + date are retained for audit. `fx_rate` is high-precision (`Decimal(18,8)`); `amount_cad` is rounded 2 dp **half-up** (the house rule). The allowed currency set is config-driven (`currencies`, USD/CAD + extensible), never hard-coded. **Rep pay is CAD-only** — `commission_*`, `pay_run_lines`, `holdback_ledger`, and `clawbacks` carry no FX fields; a foreign rep expense reaches the pay run already converted as its frozen `amount_cad`. FX source is env-gated (Bank of Canada Valet API) with approver manual override + graceful no-key fallback — the confirmed rate is what's frozen. (§8.3/BILL-011/EXP-014 · `docs/*`.)

---

## 4. Repo structure (built — this is the actual layout)

This is a **monorepo** named `RedWave/`. The scaffold is long done; what follows describes what is
there now.

```
RedWave/
  CLAUDE.md        this file (repo-root context, read every session)
  docs/            the markdown specs above + the .drawio / .docx originals
  contract/        OpenAPI 3 spec (source of truth; openapi.yaml IS committed)
  backend/         NestJS app
    src/modules/   21 domain modules — see below
    src/common/    cross-cutting building blocks — see backend/src/common/README.md
    prisma/        schema.prisma + migrations/ + seed/ (bootstrap · demo · wipe)
  frontend/        React + TS app (25 features; consumes the generated client)
  db/              migration docs/pointer — the actual SQL lives in `backend/prisma/migrations/`
```

**The 21 backend modules** (`backend/src/modules/`). The first 13 are the original domain set;
the last 8 were split out or added as the system grew.

| Module | Owns |
| --- | --- |
| `auth/` | login, JWT + refresh sessions, MFA, password reset, the global guards |
| `account/` | own profile + theme + profile-change requests + saved e-signatures |
| `users/` | user CRUD, role assignment, admin-assisted reset |
| `roles/` | role CRUD + the permission matrix (built-in roles are `is_system`) |
| `hrm/` | reps, rep documents, equipment |
| `clients/` | clients, products, client billing rates, custom fields |
| `commission/` | tier/flat/holdback config, incentives, product-type catalogue |
| `engine/` | the Commission Engine — **PURE, isolated, no deps** (see §6) |
| `sales/` | sales, sale_items, validation, the composite Sale ID |
| `payrun/` | pay periods, runs, lines, holdback ledger, ADP export |
| `clawback/` | cancellation recoveries against frozen snapshots |
| `expenses/` | expense reports (folders), items, km logs, field configs, km rates |
| `billing/` | statements, invoices, client expense documents, billing periods, exports |
| `documents/` | documents, signature requests, in-system stamping |
| `import/` | data import & integration (stage → reconcile → commit) |
| `reporting/` | dashboards, leaderboard, notifications, chatbot, report exports |
| `reconciliation/` | statement + pay-run tie-out (deliberately **not** inside `billing/`, so the #3 source scan stays clean) |
| `files/` | the unified upload pipeline (`POST /v1/files`) + claim validation |
| `currencies/` | the currency catalogue reference read |
| `audit/` | the append-only audit-log read surface (SA only) |
| `search/` | global search — reuses each entity's own permission, adds none |

One module = one NestJS module owning its tables and endpoints. A module calls another's **defined interface**, never reaches into its internals.

**Seeding & clean-wipe (`backend/prisma/`).** Two operator scripts share one bootstrap:
- `seed/bootstrap.ts` — the **genesis catalogue** the system needs day-one (RBAC 15 modules/90 perms, 4 built-in roles, Super Admin, Schedule C v2 commission config, 2026 pay periods, expense/notification/chatbot configs). Idempotent upserts; **an existing Super Admin password is never overwritten**.
- `seed/demo.ts` — a rich, **idempotent** demo (re-running wipes + regenerates transactional data — never duplicates) anchored to the **run-time current pay period** so the leaderboard/dashboards are live whenever it runs: 3 clients (VF/RF/CTI) + own products + billing rates, a manager + 8 reps (`RW-D-*`), sales across three cycles spread by `sale_date`, a **finalized** prior cycle (70/30 + holdback), clawbacks, a statement, expenses (incl. a KM log), notifications, a pending signature. It drives the **real services** so every invariant holds (#8/#2/#5/#6/#3).
- `seed/wipe.ts` — FK-safe child→parent delete of **transactional tables only** (schema has no cascades; the DB RESTRICTs hard deletes). `seed.ts` (entry, `npm run prisma:seed`) = Nest context → bootstrap **(always)** → demo **only when `SEED_DEMO=yes`**. **Production deploys run `prisma:seed`, so they seed the idempotent BOOTSTRAP ONLY — never the demo** (the demo wipes + regenerates transactional data, so it must never run on a deploy once real data exists; opt in locally with `SEED_DEMO=yes`). `reset.ts` (`npm run seed:reset`, unchanged) = the **handover clean-wipe**: guarded by `RESET_CONFIRM=yes`, it wipes transactional data and re-seeds the bootstrap, **keeping the master catalogue** (login, roles, clients, products, reps, commission config, pay periods, chatbot config). Demo logins use `DEMO_PASSWORD` in `seed/demo.ts` (rotate via the UI).
- `scripts/reset-superadmin.ts` (`npm run sa:reset`) — a **guarded, LOCAL-RUN-ONLY** Super Admin recovery (for a locked-out / unknown-password SA, since bootstrap never overwrites the password). Guarded by `RESET_SA_CONFIRM=yes`; re-hashes `SEED_SUPERADMIN_PASSWORD` for `SEED_SUPERADMIN_EMAIL` (case-insensitive; refuses a non-SA) with the canonical `common/crypto/password-hash`, clears lockout, revokes that user's sessions, and **deactivates any leftover extra Super Admins** (`KEEP_EXTRA_SA=yes` to keep). Never prints the password/hash. Testable core in `common/ops/superadmin-reset.ts`.

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
- **Auth stack:** `@nestjs/jwt` with **custom guards (no passport)**; **access + refresh** tokens (separate secrets, env `JWT_*`); password hashing with **bcryptjs** (`password_hash` never selected/returned). **TTLs are ms-strings (not coerced):** `JWT_ACCESS_TTL` (`'15m'`) / `JWT_REFRESH_TTL` (`'7d'`) are passed **verbatim** to `signAsync({ expiresIn })` — jsonwebtoken parses the string natively. Do **not** wrap them in `parseInt`/`Number` (that yields `15`/`NaN` ms → tokens expire instantly, the classic "logged out within a minute"). `token.service.spec.ts` locks the access call to `expiresIn: '15m'` (string). The premature-logout bug was **not** here — it was the frontend refresh clearing the session on transient failures; see the "Auth / session" entry in `docs/build-log.md`.
- **HR-field profile edits** (name/phone/avatar) go through `ProfileChangeRequest` review (`account` module) — never a direct write; **theme applies instantly**. (SRS §4.4)
- **RBAC catalogue:** **20 module keys** + 6 actions seeded as the standard grid (`billing_rates` — its full 6-action set gates the client billing rate cards, **granted to Super Admin only** by default so partner financials aren't visible to every `clients:view` holder; a custom Business-Partner role can be granted `billing_rates:view`; **`audit`** — `audit:view`/`audit:export` gate the SA audit log + per-record History, **Super Admin only** by default — see "Security hardening" in `docs/build-log.md`; **and the two config surfaces `km_rates` + `product_types`** — their own module rows [previously piggybacked on `expenses:*`/`commission:edit`] so a role can be granted km-rate / product-type management independently; `km_rates:view`/`edit` gate `/v1/km-rates` and `product_types:edit` gates the product-type catalogue writes [the `GET /v1/product-types` reference read stays permission-free], both granted to Admin + Super Admin by default), **plus two off-grid permissions `notifications:broadcast` + `reports:business`** (each kept off the module×action grid so the action doesn't cross-product onto every module: `broadcast` gates the manual broadcast, `business` gates the business/executive dashboard + cross-period trends); 4 built-in (`is_system`) roles (`prisma/seed.ts`, idempotent). `broadcast` and `business` are added to the `PermissionAction` Prisma enum (migrations) and granted to **Super Admin only** (already in the SA's all-perms grant); each is seeded by an explicit `permission.upsert` after the grid. Built-in roles can't be deleted/renamed (RBAC keys off names like `Super Admin`). Module keys live in `common/rbac/rbac.constants.ts`. The `permissions` table carries `@@unique([module_id, action])`. **The catalogue is unchanged by the global-search endpoint** — `/v1/search` adds **no new permission**; it reuses the per-entity reads (`hrm:view`/`clients:view`/sales scope) to gate each result group.
- **API surface:** all routes under **`/v1`** (URI versioning; `/health` is version-neutral); Swagger UI at **`/docs`** (dev only — in production it is DISABLED unless `ENABLE_SWAGGER=true`, then gated behind HTTP Basic; never public — see "Security hardening" in `docs/build-log.md`); `npm run contract:export` writes the spec to `contract/openapi.yaml`.
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
- **Both incentive modes applied** (threshold-relative, period-level pass): `per_activation` (bonus beyond `target_count`; null/0 = all) + `one_time` (one bonus at `target_count`, frozen onto the crossing activation).
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
- **Finishing a batch writes to TWO places, and the split is what keeps this file usable.** The
  **narrative** — what you built, why, the bug and its cause, the migration, how you verified,
  what you deferred — is a **new entry appended to `docs/build-log.md`**. Only the **rule a future
  session must follow** comes back here (§13 for frontend, §14 for backend domain rules), in a
  sentence or two. This file grew to 1,800 lines once by recording both; don't do it again.
- Keep it **lean**: record the rule, not the discussion. Point to `docs/*.md` for detail rather than pasting it in.
- A **stale** CLAUDE.md is worse than none — it misleads. If something here is no longer true, fix it immediately.
- When the three flagged items in **SRS §17** (holdback release timing, greenfield-at-close, current-cycle cancellation) are confirmed by Redwave, record the confirmed rule here and remove the "proposed" caveat.

---

## 12. Deferred items (to revisit)

- **`roles.status` for soft-deactivation of roles.** AUTH-003 says the Super Admin can *deactivate* custom roles, but the data model has no status column on `roles`, so role removal is currently implemented as **delete-of-custom-only** (built-in roles blocked with `409`). Add a `roles.status` (active/inactive) field in a future migration and switch the "deactivate" path to a soft status change rather than a hard delete.
- **Dual-mode incentives in the Commission Engine (DONE — CONFIRMED).** Both modes are applied by the engine, threshold-relative: **`per_activation`** pays the bonus on each matching activation BEYOND `target_count` (null/0 = every activation — back-compatible) and **`one_time`** pays a single bonus once the rep reaches `target_count` matching activations (frozen onto the threshold-crossing activation). The enum value `target_based` was **renamed `one_time`** (Prisma `ALTER TYPE … RENAME VALUE` migration). Incentives apply in a period-level pass in `CommissionEngineService`, stay separate from the 70/30 base (#1), and freeze into the snapshot (#2). Fixtures cover both modes + the threshold boundary.
- **Holdback-release timing (SRS §17.1, DONE — CONFIRMED).** The Super Admin sets a sticky **structured** rule via Commission Config: `release_rule` is `cycles:N` (release in the Nth pay period after the origin) or `days:N` (first period whose payday ≥ origin payday + N days); `next_cycle_after_30_days` is the `days:30` alias. A later change affects only future holds.
- **Back-dated / historical billing-rate loading (DONE — Import).** Clients & Products rejects a past `effective_from` (422) to protect closed periods; historical rates load through the **Import** module's `master_migration`+`clients` path (`billing-rate.handler.ts`, reconcile-gated, writes `client_billing_rate` directly, #10). The live POST still rejects back-dating.
- **`rate_kind ↔ product_id` pairing rules.** Only `rate_kind='product'` is required to carry a `product_id`; add-on kinds (tv_addon/hp_addon/spiff) may be client-wide (null product). **`bundle_bonus` is client-wide (never a `product_id`, 422 if given) and instead carries a `bundle_product_types` trigger set** (see the bundle-pricing entry below). Confirm with Redwave whether any add-on kind must (or must not) target a product.
- **Object-storage upload wiring (DONE — HRM rep documents; equipment has no file column).** Rep documents upload for real: `POST /v1/reps/{id}/documents` is multipart (PDF/image → `StorageService.upload('rep-docs', …)`, storing the object **path**; the `hrm:edit` redaction of `file_url` is preserved) + `GET /v1/reps/{id}/documents/{docId}/file-url` (`hrm:edit`, short-TTL signed URL). `RepEquipment` has **no file column** — if Redwave wants an equipment agreement/photo, add a column via migration then wire it the same way.
- **Dedicated `reps.contact` column.** Rep contact is currently sourced from the optional linked user (`rep.user_id → users.email/phone`); reps without a login have no separate contact. If Redwave needs contact on login-less reps, add a `reps` contact (phone/email) column via migration.
- **Greenfield two-step at close (SALE-006/§17.2, PROPOSED).** Sales captures the confirmed flag as `sale.is_greenfield` + per-item `sale_item.counts_toward_tally` (`= internet && !is_greenfield`), set at entry and at validation. **Pay Run** must, at period close, map a greenfield internet activation to the flat **$100** rate (engine `productType=greenfield_internet`) when building engine inputs — Sales never runs the engine. Confirm the rule with Redwave.
- **Bulk-validation ↔ Import boundary (DONE — Import).** Sales implements **queue bulk-select** validation (`POST /v1/sales/bulk-validate`) and now exposes the tx-aware `SalesService.validateWithinTx`. The **client-report ingestion** (MPU matching, manual reconciliation, atomic commit) lives in the **Import** module (`client_report`+`sales`), which drives `validateWithinTx` inside its commit transaction. Real Excel/CSV parsing is still stubbed (rows fed).
- **Holdback-release timing in Pay Run (SRS §17.1, DONE — CONFIRMED).** Finalize schedules each 30% hold via the pure `modules/payrun/holdback-release.logic.ts#resolveScheduledReleasePeriod`, which parses the sticky `cycles:N` / `days:N` rule (both modes, spec'd). At finalize a rep's pending **clawback sets off against the due release first** (records `holdback_ledger.clawback_applied`, lowers `amount_released`); only the remainder hits net — the clawback is recovered exactly once, net unchanged, books show the source. Same atomic/idempotent `$transaction` (#8).
- **Expense ↔ Pay Run seam (built, rebound; ITEM-FIRST).** `EXPENSE_TOTAL_PROVIDER` is bound to `ExpensePayrunProvider` (`modules/expenses/`); **read-only** (no finalize hook — unlike Clawback). It sums approved expense **ITEMS** directly by `{rep_id, pay_period_id, status:'approved'}` — each item's `pay_period_id` is derived from its **own `expense_date`** at create (EXP-009), so an approved item pays in the cycle of its date and Pay Run's finalize idempotency pays it **exactly once**. Pay Run finalize is **unchanged** (`expense-payrun.provider.spec` asserts the item-level where + no report join). Edge: an item **approved after** its period was already finalized is never auto-paid — needs manual re-assignment to an open period (no `paid_in_pay_run_id` column).
- **Clawback ↔ Pay Run seam (built, rebound).** `CLAWBACK_TOTAL_PROVIDER` is now bound to `ClawbackPayrunProvider` (`modules/clawback/`); finalize gained one hooked line `markApplied(rep, period, run, tx)` inside its transaction (atomic pending→applied + link). Two known edges: (a) a clawback entered *during* a finalize (admin-gated, rare) could be marked-but-not-deducted or vice-versa — acceptable now, revisit if concurrent entry becomes real; (b) a clawback for a rep with **no validated sales** in the period being run is not applied until their **next run that has a line** (it stays pending) — fine for active reps, but a terminated rep with a trailing clawback would never have it applied.
- **`pay_run_exports` table (PAY-010).** The data model has no pay-run export table, so the ADP export is currently generated, the run marked `exported`, and the **audit row is the stored record**. Add a `pay_run_exports` table (file_url/format/generated_by, like `expense_exports`) if the artifact must be persisted.
- **Expenses built (ITEM-FIRST; per-item approval).** `modules/expenses/` — the **expense item is the atomic unit**: `expense_items` gained `submitted_by`/`status`/`approved_by`/`approved_at`/`rep_id`/`pay_period_id` (derived from `expense_date`, EXP-009) and `expense_report_id` is **nullable** (the `expense_reports` table is kept for history/optional grouping; new items are report-less — migration `expense_items_item_first` backfills + applies with `migrate deploy`). Endpoints at **`/v1/expense-items`** (`ExpenseItemsController`): create one/**several** in a tx, paginated+scoped list (filters status/category/rep/client/period/date/search), per-item edit, **per-item + bulk review** (`/bulk-review`), delete. The **km log is pure** (`km.logic.ts`: single −30 / round −60, floor 0, `$0.45/km`); the km amount is **server-authoritative**. Approval is **per item** (submitted→approved/rejected/sent_back); **edit-gating** (EXP-007): pre-approval needs `expenses:edit` (Manager/Admin), **after approval only Super Admin**; delete (not-yet-approved) needs `expenses:delete` (Admin/SA). KM dedup is **one per (rep, expense_date)**. Receipt is **config-driven** (`expense_field_configs.requires_receipt`). Meal eligibility = approver judgement. Scoping reuses `ScopeService` (own = `submitted_by`, roster = `rep_id ∈ roster`, all). Seed grants: Admin gained `expenses:delete`.
- **Expense KM Maps + receipt storage (WIRED, env-gated, graceful).** **Distance:** `MapsService` (`GOOGLE_MAPS_API_KEY`) re-derives the authoritative route distance from the stops via the Directions API; falls back to the client `total_km` when no key / stub coords / error. **ROUND trips measure the CLOSED LOOP** (confirmed, SRS EXP-004): the first stop is appended as the final destination so the return drive is included — the rep enters only the outbound stops; an already-re-entered identical first/last stop is NOT double-appended (Decimal-equal coords). The FE map + auto-distance mirror the same rule (`km.ts#routeCoords`); the manual no-Maps fallback is unchanged (rep types the full driven distance); the −30/−60 deduction (`km.logic.ts`) is untouched — this is distance DERIVATION only. FE (`VITE_GOOGLE_MAPS_API_KEY`, `@react-google-maps/api`) does Places autocomplete + a route map + auto-distance, else manual entry. **Receipts (UNIFIED PIPELINE — see the §12 "Real file storage" entry):** receipts upload via `POST /v1/files` (purpose=receipt; in-browser image compression), the item stores the SERVER-GENERATED PATH (claim-validated), and viewing mints a 60s signed URL via `GET /v1/expense-items/{id}/receipt-url` — the legacy `/v1/expense-receipts` (long-lived URL on the row) is GONE. Maps never blocks the build/tests without keys; file endpoints 503 without the Supabase env.
- **Real file storage (DONE — unified pipeline; ORPHAN CLEANUP + export storage deferred).** **`POST /v1/files`** (`modules/files/`) is THE upload path for user files (receipts purpose=receipt, document originals purpose=document): JPEG/PNG/PDF ≤10 MB (422), **SERVER-generated path** `{purpose}s/yyyy/mm/uuid.ext` (pure `stored-files.logic.ts` — never client-supplied), bytes → the **PRIVATE** Supabase bucket via `StorageService.uploadObject`, metadata → **`stored_files`** (who/what/when + sha256; migration `20260613090000`), upload audited. **Claim validation** (`FilesService.claim`): a consumer may attach ONLY a path that exists + matches the purpose prefix + was uploaded by the caller (Admin/SA exempt; unknown/foreign → the SAME 422, no existence leak; document claims must be PDF). **Fail-safe:** Supabase env unset → `assertConfigured()` **503 "file storage not configured"** (envelope code `SERVICE_UNAVAILABLE`) — this pipeline never mints `local://` stubs (legacy flows — rep docs, e-sign copies, imports — keep their graceful fallback). **Downloads are per-domain** (no generic any-file endpoint): `GET /v1/expense-items/{id}/receipt-url` (item visibility → 60s signed URL; legacy stored http URLs pass through) + the existing documents/signature `…/file-url` endpoints; **issuance is audited** (`action:'download'`). **No new permission** (upload = authenticated; gates live at claim + download). FE: `lib/files/compressImage` (createImageBitmap → ≤2000px long edge → JPEG 0.8; PDFs pass through; HEIC decodes on iOS) + `lib/files/uploadStoredFile` (XHR progress, bearer+CSRF) + `FileUpload` per-file progress/error/retry/thumbnail (§6.3) + camera capture. **Deferred:** orphan-file cleanup job (an uploaded-but-never-claimed `stored_files` row + object lingers); server-side EXPORT artifacts (billing/expense exports) stay stubbed; Word→PDF conversion unchanged.
- **Expense km-rate config.** The km rate is the **constant `0.45 $/km`** (`km.logic.ts#DEFAULT_RATE_PER_KM`) — there is no rate-config table. If Redwave changes the rate or wants it effective-dated, add a config row + read it at submit (reuse the effective-dating pattern).
- **Configurable per-type FIELD schema (DONE — see the "Per-type expense fields + Alert/Warning" entry in `docs/build-log.md`); new CATEGORIES beyond the 7 enum values still deferred.** `expense_field_configs` now carries a config-driven **`fields[]`** per-type field schema + **`amount_soft_cap`** (SA-editable via `PATCH /v1/expense-field-configs/:key`); `expense_items.field_values` (jsonb) stores the captured values (metadata only, #1). But `expense_items.category` is still bound to the **`ExpenseCategory` enum** (km/meals/hotel/flight/rental/gas/other) — a **new category_key** (e.g. `parking`) is catalogue-only until an **enum migration** adds the value (the FIELD schema is fully dynamic; the CATEGORY set is not).
- **Expense export (FE file = real; server record = stub).** The FE generates the actual **CSV/Excel/PDF** client-side via the Batch-1 `ExportMenu`/`exportRows` (per-item rows or grouped daily/weekly/monthly buckets). The **server-recorded** `POST /v1/expense-exports` still writes an `expense_exports` row with a **stubbed `file_url`** (`s3://…`) — the server-side render + object-storage upload is still deferred (reuse `common/storage`).
- **2026 pay-period anchor/payday offset.** The seed generates a standard bi-weekly schedule (anchor Sunday `2026-01-04`, payday = close + 13d). Confirm the exact Redwave 2026 schedule + payday offset; adjust `pay-periods.seed-data.ts` if needed.
- **Billing built (read-only over sales × `client_billing_rates`; computes no commission).** `modules/billing/` — per client+period: **client statement** (one line per **sale** = customer/household, `products_summary` + `line_total`) and one-line **commission invoice**. **#3 is the law here**: priced **solely** from `client_billing_rates` (only `rate_kind='product'`, effective on each **sale_date** via the shared `selectEffectiveRate`, #7/#10) — **zero** path reads `commission_*`/engine; the pure `statement.logic.ts#buildStatement` is reused by the invoice so `total_commission` == statement `total_amount` (billing stream only). Asserted by `billing.no-commission.spec` (structural source scan + behavioral throw-on-touch Prisma mock + total equivalence). Confirmed rules: **invoice total = billing-stream statement total** (NOT rep payout); **missing rate → 422** (never silently under-bill); confirmed sales only (`validated|in_pay_run|paid`), excluding clawed-back sales **and** clawed-back items; **NO GST** (no tax field); **replace-in-place** regeneration per (client, period) in a txn (no `@@unique`, no silent dup). **No `ScopeService`** (per-client partner data, RBAC `billing:{view,create,export}`, Admin/Super Admin only). No seam, no migration, no Pay Run change.
- **Billing `bundle_bonus` pricing (DONE — Bundle-pricing track, migration `20260616000000`).** Add-on **products** (HP/TV/Protection Plan/Mesh/Speed-attach, entered as Products with per-product `rate_kind='product'` rates) are already billed. **`bundle_bonus` is now APPLIED to statement/invoice line totals** via a configurable trigger: `client_billing_rates.bundle_product_types String[]` (sorted; the product-type catalogue keys that must ALL be present on a sale). `billing-rates.service#create` validates a bundle carries **≥2 distinct active catalogue types + no `product_id`** (422 otherwise; non-bundle kinds must carry an empty set), and **keys the effective-dating scope by the trigger set** (`create`/`update`/`remove`/`groupByScope`) so DISTINCT bundles don't supersede each other. `StatementService.priceClientPeriod` loads the client's bundle rates, and for each sale whose `sale_item.product_type`s cover a bundle's trigger, appends a **synthetic `PricedItem`** `{product_id:null, name:"<A + B> bundle", rate}` (effective on `sale_date`, once per sale per bundle) → `buildStatement` sums it into the line/total in the **client's currency**, inside the frozen-FX `amount_cad` at issue (#12, automatic — no FX change). Reconciliation re-prices via the same path (consistent by construction). Still **client-bill only** (#3 — `billing.no-commission.spec` green; commission engine untouched). **Still deferred:** the add-on **KINDS** `tv_addon`/`hp_addon`/`spiff` remain unused/uncombined (no pinned combine rule; not in the grid) — if Redwave needs them, extend `priceClientPeriod` the same way.
- **Real billing export generation (DONE — Billing batch).** Statements/invoices/QuickBooks-CSV now render for real ON DEMAND (exceljs / pdf-lib / hand-rolled CSV) and stream from the FROZEN record; a `billing_exports` table records each artifact (+ Supabase upload when configured). Statements/invoices are also gapless-numbered + immutable now. See the "Billing — gapless numbering" entry in `docs/build-log.md`.
- **Documents & E-Signature built — REAL storage + in-system stamping (no e-sign vendor).** `modules/documents/` — upload (PDF via the unified **`POST /v1/files`** pipeline; the JSON create **claims** the stored path — see the §12 "Real file storage" entry) → share + **place fields** → sign (server **stamps** a per-signer copy) / decline / sign-upload → final all-signatures copy, with the overall status **derived** by the pure `document-status.logic.ts` (`deriveRequestStatus`/`deriveDocumentStatus`) + recomputed in a `$transaction` after every action (`status.recompute.ts` — UNCHANGED). **Share == signature request** (no shares table; DOC-002); recipients become the **visibility** set — a user sees only documents they own or are a recipient of, **Admin/Super Admin see all** (user-based `OR` in the query, NOT `ScopeService`). **Decline is terminal**. **RBAC maps to the real 6 actions**: upload + request = `documents:create`; reads + the `…/file-url` endpoints = `documents:view`; **sign / sign-upload / cancel + `/v1/signatures/{id}/file-url` carry NO permission** — authenticated + row-level (recipient / requester-owner-admin), per arch §6.10. Re-acting → 409. **Storage model (the law):** files (original, per-signer copy, final copy, saved-signature images, rep docs) live in Supabase by **object PATH**; bytes are served only via short-TTL signed URLs minted by the visibility-gated `…/file-url` endpoints — never public; `Document.original_file_url` is **set once, never mutated** (DOC-001/004). **Stamping** = `pdf-lib` (`stamp.service.ts` + the pure `stamp.logic.ts`: top-left-fraction → pdf-lib points, unit-tested) — loads the original, draws each field (signature/initial → image, date → signing date, text → typed value), uploads a NEW object; graceful no-op when storage is off. **PDF-only** at upload (non-PDF → 422; Word→PDF conversion deferred, §12). **New entities** (migration `20260610130000_documents_esign_real`): `signature_fields` (per request/recipient: type signature|initial|date|text, page, normalized x/y/w/h, value_text/value_image_path) + `user_signatures` (per-user saved reusable signature, method, is_default) + `signature_requests.completed_file_path`. **Saved signatures** = own-scoped `/v1/account/signatures` CRUD (no module permission). Signature events (request/sign/complete) emit via the **`NOTIFICATION_EMITTER` seam** (rebound by `NotificationsModule`). decline/sign time+IP in the **audit_log** (DOC-007). Seed unchanged (`documents:create` already on Manager + Sales Rep; **no new permission** — saved signatures + field placement + file-url all ride existing gates).
- **Data Import & Integration — REAL upload + parse + 8 targets + historical sales (stage → reconcile → commit; atomic + idempotent #8).** `modules/import/`. **Real file upload**: `POST /v1/imports` is **multipart** (xlsx/xls/csv/tsv) → `ParserService` (**exceljs** + **papaparse**) → `applyMapping` → `cleanMappedRow` (pure `clean.logic`: trim, **date→'YYYY-MM-DD'** by the cell's own day [no DST drift], **money→exact decimal string**, **codes UPPER-cased** [kills VF/Vf], missing→null) → classify → stage; the source file is stored via `StorageService.upload('imports')`. **Mapping is auto-suggested** from headers (pure `suggest-mapping.logic`) when no `field_mapping_id`; the `target-fields` registry (per `${source}:${import_type}`: field+type+aliases+required+dict) is the single source of truth for cleaning + suggestion + templates. **Mapping CRUD** (`/v1/import-mappings`, IMP-002) + **`POST /:id/remap`** (re-apply a mapping to the stored `raw_data`, no re-upload). **8 targets**: `client_report`+`sales` (bulk validation → `SalesService.validateWithinTx`); **`sales_entry`+`sales` (LIVE sales, IMP-013 — see below)**; `master_migration`+`clients`/`products`(+inline rate)/`billing_rates`(back-dated #10)/`reps`/`sales`(**historical**); `balance_migration`+`holdback`. Code-based classifiers + handlers (`handlers/master.handlers` + the re-keyed billing-rate/holdback) resolve client_code/rep_code/product_name → ids within the tx. **Commit** = the pure `reconcile-gate.logic#evaluateGate` (block any unmatched/duplicate/error; `balance_migration` reconciles to the operator `reconcile_total`, IMP-007) then ONE `prisma.$transaction` (throw → whole batch rolls back, stays `staged`); re-commit is a **no-op** (state-based). **Error report** `GET /:id/error-report` (CSV). RBAC per arch §6.11: create/view/edit + **commit = `import:approve`** (Admin/SA) — **no new permission** (mapping CRUD + remap + error-report ride existing). ImportModule imports StorageModule + SalesModule (one-directional).
- **LIVE sales bulk entry (IMP-013 — the 8th target; migration `20260621000000_import_live_sales`).** New `ImportSourceType` value **`sales_entry`** → pair **`sales_entry:sales`** → Kind `bulk_sales`. A new *source* (not type) because the pair must be unique — `pairingKind` and the FE `kindOf` both reverse-resolve by it, and both sales pairs were taken. **Creates REAL sales that DO reach the engine** (tier / pay run / clawback) — the opposite of `historical`. **ONE ROW = ONE SALE**: `product_types` is a comma-separated list so a bundle (and the mandatory internet base) fits one row, keeping the 1-row = 1-entity = 1-gate-unit model. Address columns are optional (blank → `'—'`). A `status` column of `validated` also runs the entered→validated transition at commit. **Drives `SalesService`, never reimplements it**: the new **`SalesService.createWithinTx(tx, dto, user, {importBatchId})`** mirrors `validateWithinTx` (tx first, no audit, no own `$transaction`), and the entry RULES (rep active + in scope, client active, products belong to the client, **SALE-001a internet base**, `countsTowardTally`, Sale ID) live in ONE private `resolveSaleCreate(db, …)` shared with the public `create`. **sale_code caveat:** the suffix count runs on `tx` so same-batch siblings are visible; the public `create` keeps its P2002 retry, but a retry is impossible inside a Postgres tx (a failed statement aborts it) so a genuine collision rolls the batch back. **Unresolvable client/rep/product classifies as `error`** (never creates master data), and **SALE-001a is pre-checked in the classifier** so a bad row is blocked by the gate instead of throwing mid-commit. **No commission is written at import** (snapshots stay NULL — Pay Run freezes them, #2/#5; spec-locked). **No new RBAC permission** (rides `import:create` / `import:approve`); the commit tx, `evaluateGate` and re-commit idempotency are unchanged. FE: a `KINDS` entry + a `templates.ts` `TemplateDef` (group `Sales`) + `KIND_TO_TEMPLATE` → the Excel/CSV download and the MappingEditor field list appear automatically.
- **Historical sales (CONFIRMED rule, IMP-012).** `master_migration`+`sales` → `sale.status='historical'` + `sale_items` with `counts_toward_tally=false`, commission snapshots **NULL** (#2: not a commission record), `historical_billed_amount` set (the source-file BILLED amount — a **billing-stream reference**, never commission, never joined to commission_*, #3), `import_batch_id` set (IMP-008). **Reference-only**: every rep-facing query already filters `CONFIRMED=[validated,in_pay_run,paid]` (or `'validated'`), so `historical` is **auto-excluded** from pay run / commission / tier / leaderboard / billing / clawback with NO filter change (a `dashboards.service.spec` locks it). The **Business dashboard ALONE blends it**: `business()`+`businessTrends()` add a separate historical `sale_items` pass into revenue (+Σ`historical_billed_amount`) + total_activations + by-product/by-client mix (current + prev), never into internet tally / greenfield / tier / payout. `SaleStatus` += `historical` (terminal, `sale-status.logic` `historical:[]`); migration `20260610140000_import_real_historical` (+ `historical_billed_amount`, `ImportType.billing_rates`, `sales.import_batch_id`).
- **Import deferrals (remaining).** **`mixed` import_type** unsupported. **Auto-creating referenced master data is DONE but migration-only** — `create_missing` on `master_migration + sales` (§14 rule 7, migration `20260625000000`); extending it to any other target is deliberately refused, so if Redwave ever wants it elsewhere that is a new decision, not a bug. **`clients.supplies_mpu_id` is stored but unread** — no-MPU matching falls back on its own per row, so the flag drives nothing; wire it up only if the UI should pre-empt asking for a column a partner never sends. **Templates live on the import home, not inside the upload wizard** — an operator mid-upload has to go back for the format. **There is no rep create/edit form**, so a rep's `external_code` alias is set through the reps import (or the API), not the Reps screen. **Provenance is one-directional** for non-sales targets (clients/products/reps/rates/holdback) via `import_rows.matched_entity_id` (only **sales** carry `import_batch_id`). VF/RF/CTI templates are **sensible defaults** (`frontend/.../templates.ts`) — refine from a real file (import is mapping-driven, so any layout works). The **server-recorded** export render stays the only stub (FE templates are real, generated via `exportRows`). Excel parsing uses **exceljs** (not SheetJS `xlsx` — parse-side CVE avoidance, consistent with the export side).
- **Reporting & Dashboards built (read-layer; NO money recompute; leakage-scoped).** `modules/reporting/` — the final backend module: four role-scoped dashboards, a counts-only leaderboard, notifications, and a scoped read-only chatbot. **Every read is scoped server-side**: **rep** dashboard scopes to `user.repId` *directly* (null → 403 + audit — NOT `getRepScope`, which returns `roster` for a player-coach); **manager** uses `getRepScope` roster and **rejects a bare rep** (`scope.level==='self'` → 403); **business** is `@RequirePermission('reports','view')` + a service `if(!isSuperAdmin) 403+audit` (there is **no `business` action**); **admin** = `reports:view` + Admin/SA queues. **All money is READ** from `pay_run_lines`/`holdback_ledger`/`clawbacks`/`client_statements` (business net_margin = revenue − payout, a display subtraction — never recomputed, #1/#5); counts from `sales`/`sale_items`; tier-progress is a pure count→bracket lookup (`tier-progress.logic`, no rates). **Leaderboard** = company-wide ranked internet-activation **counts only** (no money field — asserted), visible to anyone with `reports:view` (Sales Rep seed gained `reports:view`). **Notifications** (`NotificationsModule`): `notify(event,user,…)` reads the global `NotificationEventSetting` (Super-Admin-set, **no per-user override**), creates in-app rows + stubbed `EMAIL_DISPATCHER`; best-effort (never breaks the triggering action); `GET /v1/notifications` is own-only; settings GET/PATCH gated `settings:{view,edit}` (Super Admin). **Chatbot** (`POST /v1/chatbot/query`, authenticated): the stubbed `LLM_PROVIDER` returns ONLY an allow-listed intent (no ids/SQL); tools take **only the AuthUser** + are entitlement-gated (`isToolAllowed`) → a rep can never retrieve another rep's/role's data regardless of prompt (proven by smoke). Seeded: 8 notification settings (`rate_change` in-app-only, RPT-010) + a `gemini` `ChatbotConfig` (`is_active=false`).
- **Reporting deferrals.** **Email/SMS dispatch stubbed** (`EMAIL_DISPATCHER` noop — real SMTP rebinds). **Gemini LLM stubbed** (`LLM_PROVIDER` `StubLlmProvider` keyword router — real provider rebinds; `ChatbotConfig` row exists). **Sales targets (RPT-008) deferred** — leaderboard is pure counts (no target/progress column); no `SalesTarget` endpoints. **Materialized views deferred** — dashboards use Prisma `groupBy`/`count`/`aggregate`; the leaderboard counts a bounded period set in-app (raw GROUP BY / MV is the scale optimization). Other modules (Sales/Expenses/Pay Run) can call `NotificationsService.notify()` later for their events; only Documents signature events are wired now.
- **User-facing notification-preferences READ endpoint (deferred — surfaced by the Account UI).** AUTH-013 says every user can see (read-only) which notifications they receive, but the only channel-config endpoint is `GET /v1/notification-settings`, gated **`settings:view` (Super Admin)**. So the My Account → Notifications tab can only show the real list to a Super Admin; a non-SA gets a graceful "your administrator controls these" banner. Add a small authenticated, **own-scoped read** of the global event×channel settings (no per-user override — still SA-configured) so non-SA users can see their channels. No per-user override is intended (AUTH-013), just visibility.
- **Trend/period-aggregation dashboard endpoint (DONE — Dashboards overhaul + Reports hub).** `GET /v1/dashboards/business/trends?periods=N` (≤24, `reports:business`) powers the `BusinessTrends` charts on the Business dashboard AND the dedicated **`/reports/trends`** page (the hub card links it; the component gained an optional `periods` prop with a 6/12/24 depth selector).
- **On-demand report exports (DONE — RPT-015; SCHEDULING deferred).** `/reports/exports` + `features/reports/`: pick a type → scope → CSV/Excel/PDF → the data comes from EXISTING scope-enforced reads, the record is written FIRST (`POST /v1/report-exports`, no record → no file), then the shared `exportRows` generates the file client-side. Four types, each riding its EXISTING permission (**no new permission**), enforced PER TYPE in `modules/reporting/report-exports.service.ts` (a controller decorator can't vary by body; denial → 403 + audit): `business_summary`→`reports:business`, `leaderboard`→`reports:view` (counts only), `payrun_summary`→`payrun:export` (period's run lines), `expense_summary`→`expenses:export` (date range). The **`report_exports`** table (migration `20260611150000`) mirrors expense_exports (who/what/when + recorded `rep_scope` for the rep-scoped types) but stores the real client `filename` (no stub URL) and `report_type`/`format` as **validated Strings** (no enum migration per new type). `GET /v1/report-exports` = latest 50, own for non-admin / all for Admin+SA. **Scheduled/recurring exports are NOT built** — the hub card copy says "Generate and download reports" only.
- **User invite / password-reset flow (AUTH-002, DONE — Resend wired).** Real email via **Resend** (`common/email` `MailerService`, env-gated graceful; the notification `EMAIL_DISPATCHER` is rebound to it too). **Invite**: `CreateUserDto.password` is now optional — omitting it creates the user with `must_change_password` + emails a **set-password link** (`PasswordResetToken`, single-use, HASH-only, expiring). **Forgot** (`@Public POST /v1/auth/forgot-password`, non-enumerating) + **reset** (`@Public POST /v1/auth/reset-password`). **Admin-assisted** (`POST /v1/users/:id/reset-password`, `users:edit`): emails a reset link OR a forced-change temp password — the admin **never sees** the password. **Strength policy** (`auth/password-policy.ts`, ≥8 + upper+lower+digit) + **brute-force lockout** (`failed_login_attempts`/`locked_until`, default 5 attempts / 15 min). `must_change_password` rides login + `/me`; the FE forces a change. **No new permission** (invite/reset ride `users:create`/`users:edit`). DNS for `app.redwavemarketing.ca` is operator-set in Namecheap (records in `docs/external-services.md`). *Still open: a server-side actor self-check (block self-deactivate / self-role-removal) — the UI guards it but the server doesn't.*
- **KM map / geocoder (DONE — env-gated).** Wired: with `VITE_GOOGLE_MAPS_API_KEY` the FE captures real `lat`/`lng` via Places autocomplete + shows the route map + auto-derives the distance; with `GOOGLE_MAPS_API_KEY` the server re-derives the authoritative route distance via the Directions API. Graceful fallback (no key) = manual address + `total_km` (stops carry `lat`/`lng`=`'0'`, the server falls back to the typed total). The amount is always server-computed.
- **Expense item DELETE (DONE — per item).** `DELETE /v1/expense-items/{id}` (`expenses:delete`, scoped) removes a **not-yet-approved** item (approved items are preserved). The legacy `expense_reports`/`expense_exports` tables still have no delete endpoint. Real **server-side** export-file generation remains stubbed (the FE file export is real — see above).
- **Meeting-3 reconciliation + Wave 1 (DONE — docs commit `2f6bbd2`; see `docs/meeting-3-deltas.md`).** The 3rd-meeting deltas are reconciled into BRD/SRS/data-model/CLAUDE §3 (source of truth). **Wave 1 shipped** (additive, invariant-safe, no currency): (1) **internet-base rule (SALE-001a)** — a sale must include a tiered/greenfield product; standalone add-ons → 422 (`sales.service` + `SaleForm`); add-on flat rate may be **$0 (bill-only)** — already allowed. (2) **Clawback finder (CLAW-009)** — search Sale ID / customer / **address / rep name** + Rep/Address columns (`PaidSaleFinder`, client-side over the loaded clawable set; `/v1/search` also matches rep name). (3) **Personal / do-not-reimburse toggle (EXP-012)** — `expense_items.is_personal`; **excluded from the pay-run seam** (`ExpensePayrunProvider` `is_personal:false`) + the reimbursable grouped total; a "Personal" badge/column. (4) **Custom tags (EXP-002a)** — `expense_items.tags` jsonb `string[]` (client + channel); the grouped/searchable expense-TYPE picker is **deferred to the report-folder rework** (needs the expanded category model). (5) **Per-client, effective-dated km rate — REP stream (EXP-004)** — new `km_rate_config` table (two-stream #3: `rep` wired, `client_bill` stored for Wave 2); the km amount resolves the rep rate in force for the client on the item date (client-specific → global → **$0.45 default**), via pure `km-rate.logic#selectKmRate` + `KmRateService` (CRUD reuses `common/effective-dating`, back-date 422); admin at **`/admin/km-rates`** (**`km_rates:view`/`edit`** — its own RBAC module; originally `expenses:view`/`edit`, re-pointed in the RBAC-governance batch so km-rate management is grantable independently of Expenses). **3 additive migrations** (`20260614000000` is_personal, `20260614010000` tags, `20260614020000` km_rate_config) — operator runs `migrate deploy`. Verified LOCAL: 602 backend tests + build + contract regen green; FE build+lint+stylelint+tsc green. **Wave 2 (gated, NOT started):** per-client **currency + stored-FX** migration (§3 #12 blast-radius) with mandatory money-path tests; the **rate-grid data** for the 4 clients (VF/RF/CTI/VF Business — client-BILL, engine untouched #3) + `standard_addon` types (Wireless/Protection Plan/Mesh/Speed-attach) + configurable bundles; ~~split billing + the client expense billing document~~ (**DONE** — see the "Client expense billing document" entry in `docs/build-log.md`); ~~per-type field sets + Alert/Warning validation~~ (**DONE** — see the "Per-type expense fields + Alert/Warning" entry in `docs/build-log.md`). ~~The **expenses report-as-folder rework**~~ (**DONE** — see the "Report-as-folder expense rework" entry in `docs/build-log.md`; business week = **Mon–Sun**, migration `20260619000000`).
- **Currency / stored-FX money model (DONE — Wave-2 track 1, BACKEND-ONLY; migration `20260615000000`).** The money-model foundation for #12. New `currencies` catalogue (CAD/USD, admin-extensible, seeded in bootstrap) + `clients.currency` (FK, default CAD). The frozen stored-FX fieldset `{original_currency, fx_rate Decimal(18,8), fx_rate_date, amount_cad}` is on **`expense_items`** (frozen at APPROVAL) and **`client_statements` + `client_invoices`** (frozen at ISSUE); `amount`/`total_amount`/`total_commission` now hold the value in the record's currency. **FX source = shared `common/fx`** (`FxRateService` env-gated on `FX_RATE_SOURCE=bank_of_canada`, Bank of Canada Valet, no key, graceful null → manual; `FxModule` @Global; pure `convertToCad` = half-up via `common/money`). **Resolution at each capture = override → API → 422** (never guess; CAD → rate 1, no fetch): expense approval reads `ReviewDto.fx_rate`; billing issue reads `GenerateBillingDto.fx_rate`. **Roll-ups read `amount_cad`:** the pay-run seam (`ExpensePayrunProvider`) + **every consolidated-revenue/expense read on the business + trends dashboards** (`dashboards.service`) — a foreign expense reaches the pay run already CAD; rep pay stays **CAD-only** (commission_*/pay_run_lines/holdback/clawbacks unchanged). Billing renderers label the doc's currency + a CAD-equivalent line. Reconciliation unchanged (compares like-for-like in the client currency). **Backfill:** existing rows → `{CAD, 1, self}` (identity — provably unchanged). **INERT until a USD client exists** (rate-grid track). Verified LOCAL: **623 backend tests** (incl. the mandatory half-up `.xx5` boundary on BOTH approval + issue) + tsc + lint + contract regen green. Operator: `migrate deploy` (stacks on the 3 Wave-1 migrations) + re-seed bootstrap (adds currencies); optional `FX_RATE_SOURCE`. **FE deferred** to the rate-grid track (currency picker + FX-override UI, when there's a USD client to exercise). **Next tracks:** ~~rate-grid data (sets `CTI=USD`)~~ (done) → ~~split billing + `client_expense_documents`~~ (done) → ~~per-type fields + Alert/Warning~~ (done) → ~~report-folder rework~~ (done, §13). **Expense module = fully built.**
- **Rate-grid track — currency wiring + deferred currency FE (DONE — BE+FE; NO migration).** Brings the stored-FX model to life so a **USD client (CTI)** exercises the first real conversion. **Backend:** new tiny **`modules/currencies/`** — `GET /v1/currencies` (authenticated reference read, no permission, like `/v1/product-types`) + `CurrenciesService.assertSupported`. **`clients.currency` is now settable end-to-end** — `Create/UpdateClientDto` + service persist + `ClientResponse` carry it; a non-CAD code is validated (422 on unknown); **a currency CHANGE is BLOCKED once the client has an issued statement/invoice** (frozen billing history stays coherent, #12) — freely editable before. **Frontend** (`gen:api` regen first — the currency-track DTOs were stale in `schema.d.ts`): new shared **`features/currencies/useCurrencies`**; `ClientFormModal` billing-currency picker + `ClientDetailPage` display; **rate cards + `BillingRateFormModal` label the client's currency** (`money(amount, currency)` — a `USD 250.00` prefix for non-CAD, `$` default unchanged); **expense-form per-item currency picker** (`ExpenseItemRow` common-fields, **locked to CAD for km**); **approval FX-override** — `ReviewActions` opens an FX dialog for a FOREIGN item (`original_currency≠CAD` & `amount_cad==null`) collecting the rate + an approximate `amount_cad` preview, sent as `ReviewDto.fx_rate` (the server re-freezes authoritatively). **Bulk approve can't carry an override** → a foreign item relies on the FX source or is skipped (single-item path takes the manual rate). **Tests:** client-currency CRUD + the no-issued-statement guard; `GET /v1/currencies`; the first **source-driven** USD statement issue (`FxRateService→1.365` ⇒ `amount_cad 341.25`); business-dashboard CAD consolidation reads `amount_cad`. **632 backend tests** + FE build/lint/stylelint/tsc + contract regen green. **DATA-ENTRY is the operator's browser pass** (see `docs/rate-grid.md`): the 4 clients (CTI=USD) + products + billing rates + the new `standard_addon` types + the RF **$35 HP+TV `bundle_bonus`** row — all via existing admin UI, **no seed**. **Bundle APPLICATION to statement totals is now DONE** (see the "Billing `bundle_bonus` pricing" entry above — the RF $35 HP+TV row is priced into the line total once a sale has both). Get a client sign-off on the grid VALUES before entry.

### Open after the UAT batches (this session)
- **`prisma/seed/demo.ts` calls `documents.upload(dto, stubPdf, sa)` against a TWO-argument method.** Pre-existing (unchanged at HEAD), hidden because the seed runs `--transpile-only`, so `SEED_DEMO=yes` throws at the documents step before finishing. The seed is NOT typechecked by `tsconfig.json` (`include: ["src/**/*"]`) — worth widening, or the next drift lands the same way.
- **`mfa.service.spec.ts` is a flake.** Failed once in a full-suite run and passed alone + on re-run (817/817). TOTP window + bcrypt rounds under parallel load; it will bite CI eventually. Fix by freezing the clock / lowering the test bcrypt cost, not by retrying.
- **The sales export carries no Rep column.** `SaleResponse` exposes only `rep_id` (no code/name) and the sales table has no rep column either, so the client-bill-shaped export omits the Agent ID / Agent Name pair the STATEMENT has. Add the rep to `SALE_INCLUDE` + the response DTO if the export needs to line up completely.
- **The office origin (`expense_settings`) is typed, not geocoded.** The admin card takes a plain address, so the defaulted km stop carries no lat/lng and the server falls back to the rep's typed total (exactly like any manual stop). The `office_lat`/`office_lng` columns exist — wire the Places autocomplete into `OfficeOriginCard` to let the office contribute to route derivation.
- **Expense CATEGORIES are still enum-bound.** `expense_items.category` remains the `ExpenseCategory` enum (km/meals/hotel/flight/rental/gas/other); the per-type FIELD schema is fully dynamic but a new category key (e.g. `parking`) needs an enum migration. The new category GROUPING dimension inherits that ceiling.
- **The client expense document is outside the reconciliation tie-out.** `/v1/reconciliation/*` covers statements + pay runs only; a `CEXP-` document has no tie-out check.
- **Billing add-on kinds are now applied — except the ones with no rule.** `tv_addon` / `hp_addon` / `spiff` are live (add-on wins, product rate is the fallback). No combine rule was ever pinned for stacking several add-on kinds on one component, so only ONE rate fills each column; revisit if Redwave needs them to sum.
- **One folder per rep+week is enforced in the SERVICE, not the DB.** `create` resolves to the existing folder; there is no unique constraint (a null-rep folder and an admin creating on behalf both need to stay legal). A partial unique index on `(submitted_by, rep_id, week_start) WHERE rep_id IS NOT NULL` would harden it.

---

## 13. Frontend conventions (`frontend/`)

The design system and every shared primitive are **built**. Build screens on them; do **not**
reinvent them. Authoritative visual spec: `docs/design-system.md`. `npm run dev:frontend` → the
`/showcase` route renders every component in light + dark.

> **This section is the RULES. The per-batch history is `docs/build-log.md`** — 37 entries in
> build order recording what each batch established, why, which migration it needed, and how it
> was verified. Read the relevant entry there before reworking an area; it usually explains why
> the obvious simpler approach was already tried and rejected. Rules here win over anything
> there.

### 13.1 The foundation (never reinvent)

- **Tokens are the single source of truth.** `src/styles/theme.css` is the ONLY file with raw hex.
  Every component styles via `var(--token)` — never a hard-coded hex/px/font/radius/z-index.
  **stylelint enforces this** (`npm -w frontend run stylelint`). Theme switch = swap token values,
  zero component changes. If a design decision isn't covered by a token, **stop and ask** (§7).
- **Theme = `[data-theme]` on `<html>`.** `:root` (theme-independent) + `:root,[data-theme='light']`
  + `[data-theme='dark']`. Attribute selectors let a nested `<div data-theme>` re-root the cascade.
  `public/theme-boot.js` sets the attribute before first paint (no flash) — its storage key
  `redwave-theme` MUST match `ThemeProvider`, which owns Light/Dark/System and PATCHes
  `/v1/account/theme` when authenticated. The boot script is external because the SPA CSP is
  `script-src 'self'`.
- **Styling = CSS Modules** (`*.module.css`) per component. No Tailwind, no CSS-in-JS runtime.
- **a11y-heavy components use Radix unstyled primitives** (Dialog/Tabs/Toast/Select/Checkbox/Radio/
  Switch/Tooltip/Popover/DropdownMenu), styled 100% with tokens — focus-trap/ARIA/keyboard for
  free, no generic look. Simple components are hand-rolled. Icons: `lucide-react` only. Import
  from `@/components/ui` (barrel); layout from `components/layout/`.
- **Fonts: Figtree (UI) + JetBrains Mono (money/codes)** via `@fontsource` → `--font-sans` /
  `--font-mono`. Money and numerics use the `mono` class (`tabular-nums`) and are **right-aligned**.
- **Typed API client:** `openapi-fetch` over `npm -w frontend run gen:api` output
  (`src/api/generated/schema.d.ts` — never hand-edit; gitignored, see §2.5). **NO `baseUrl`** —
  generated path keys already include `/v1`, so a `/v1` baseUrl would double it. Bearer + CSRF are
  injected by the `onRequest` middleware.
- **Brand assets:** `Logo` (`variant full|mark`) and `LoadingSpinner` inline their SVG via `svgr`
  (`?react`). The logo "ink" is **`currentColor`** so it inherits each placement's text token; the
  orange is the constant token `--brand-orange`. **`src/assets/brand/`** = themeable in-app assets;
  **`public/`** = fixed-colour browser artifacts (favicon set, regenerate with
  `npm -w frontend run gen:icons`). `LoadingSpinner` is for **full-area waits only** — the route
  `Suspense` fallback and session boot. Everywhere else use `Skeleton`/`TableSkeleton`, the
  `Button` inline spinner, or the chatbot dots.

### 13.2 The screen playbook — copy this shape for every feature

The Sales cluster (`features/sales/`) is the reference implementation. Do not invent a second
pattern.

- **Feature folder shape:** `features/<name>/` = `<name>.types.ts` · `api/keys.ts` (query-key
  factory) · `api/use*.ts` · `components/` · `pages/` (one default export per route). Keep a
  module's code under its folder; cross-feature reads go through the typed client, never through
  another feature's internals. Shared-by-two-features UI gets **promoted to `components/ui/`**
  (that is how `EffectiveDatedTable` + `RateStatusBadge` moved out of `features/clients/` — so
  Commission has no code dependency on Clients and invariant #3 reads cleanly in the source).
- **Types ALIAS the generated schema** — `export type Sale = components['schemas']['SaleResponse']`.
  Never hand-write a response shape; derive enums from the contract too.
- **Server state = TanStack Query** over `unwrap<T>(api.GET(...))` (`lib/query/unwrap.ts`), which
  ok-checks and throws **`ApiError`** (carrying `details` from the error envelope). Query keys come
  from the factory; mutations `invalidateQueries` on success. Client config: `staleTime` 30s,
  `retry` 1, no refetch-on-focus.
- **Loading / empty / error = `<DataState>`**, which renders `TableSkeleton` / `TableError` (with
  retry) / `TableEmpty`. Errors → toast via `useApiErrorToast()`; success → an explicit
  `useToast()` by the caller. **Nothing fails silently** (§7).
- **Forms = react-hook-form + zod** (`zodResolver`) wired to `FormField`. Plain inputs use
  `register`; Radix controls use a `Controller`. Radix `Select` forbids an empty value — use a
  sentinel (`'__all__'`) mapped to `undefined`. Register optional fields with `defaultValue=""`:
  a control that mounts holding `undefined` will fail a `z.record(z.string(), z.string())` and
  surface as a bogus "Invalid input" on an untouched field.
- **Lists** use the server-side contract (13.4) via `useServerTable`; **filter state lives in the
  URL search params** so `/sales?status=entered` is a shareable link (sidebar presets are exactly
  that). Reset to page 1 on any filter/sort change.
- **Detail = a deep-linkable route** (`/sales/:id`), never a drawer. It fetches its own data and
  handles loading/error/not-found through `DataState`.
- **Breadcrumbs are global and route-driven. A NEW ROUTE MUST DECLARE CRUMB METADATA** in
  `routes/crumbs.ts` (label / entity kind / logical `parent` / optional permission). The router is
  flat, so hierarchy comes from `parent` pointers. Ad-hoc per-page breadcrumbs are **forbidden**;
  dev warns for a route with no entry.
- **Permission gating is CONVENIENCE ONLY — the server is the real gate (§5).** `useCan(perm)` /
  `<Can>` only hide UI. Call `useCan` **unconditionally** (rules of hooks), then combine with
  status: `const canValidate = status === 'entered' && canApprove`. Reads degrade gracefully when
  a permission is absent. A **403 renders `AccessDenied`**, a **404 a graceful not-found** — never
  a generic "failed to load".
- Feature routes are code-split via `React.lazy`.

### 13.3 Shared primitives — use these, don't rebuild them

`DataTable` (columns, server sort + pager, controlled selection, row/bulk actions, and a dedicated
**forbidden** state) · `RowActions` (inline buttons or kebab — see below) · `ConfirmDialog` (with **`requireTyped`** for irreversible/financial actions)
· `ExportMenu` + `exportRows` · `DatePicker` (value is always `'YYYY-MM-DD'`; **never** a native
`<input type=date>` — OS-locale bug) · `PayPeriodSelect` · `SelectWithOther` · `EffectiveDatedTable`
+ `RateStatusBadge` · `StatCard` (the KPI tile) · `Avatar` · `FileUpload` · `HistoryTab` (per-record
audit trail) · `SegmentedControl` · `MultiSelect` · `MoneyInput` · `SignaturePad`.

- **Row actions go through `RowActions`, never a hand-rolled kebab.** It takes the same `MenuEntry[]` as
  `DropdownMenu` and decides at RUNTIME: **≤2 actions on a desktop-width viewport render as real buttons**;
  more than that, or any narrower viewport, falls back to the kebab. Deciding from the actual item count
  (not per table) means a menu that grows past the threshold collapses back on its own instead of quietly
  overflowing the column. A table with a genuinely empty actions column may pass `maxInline={3}`; never
  more — past that the column starts driving the table's layout, which is what the kebab exists to prevent.
- **Status badges are per-domain and not interchangeable.** `StatusPill` is **sale-only**; pay
  runs, periods, clawbacks, documents, expenses and rates each have their own badge component.
- **z-index ladder:** floating menus (dropdown/select/popover = 1300) sit **above** modal/drawer
  content (1200). Both portal to `<body>`, so z-index is what decides — a Select opened in a Modal
  rendered behind it before this was fixed.
- **Responsive shell** on the design-system breakpoints (`lib/useMediaQuery`): <640px off-canvas
  sidebar, 640–1024 icon rail, >1024 full. Verify new screens at 360px.
- **Long lists scroll inside their own pane.** `Table` takes `maxHeight` (threaded through
  `DataTable`, default `72vh`) so the page keeps a single scroller and the footer is never
  overlapped. Short lists stay under the cap and are unaffected; modal/embedded tables pass no
  `maxHeight`.

### 13.4 The server-side list contract (arch §5.1)

List endpoints accept `?page=&limit=&sort=field:dir&search=` plus their filters and return
**`{ data, meta: { total, page, limit, pageCount } }`**. `page` is **1-based**; `limit` defaults to
20, **max 100**.

- Backend primitives live in `common/pagination/`: `PaginationQuery` (feature query DTOs extend
  it), `paginate.ts` (`toSkipTake` / `buildPage` / `resolveOrderBy`) and `PageMetaResponse`. A
  service builds `where` (preserving `ScopeService` scoping + filters + the `search` OR-filter),
  then `Promise.all([findMany, count])` → `buildPage`. **`resolveOrderBy`'s sort allowlist is the
  orderBy-injection guard** — always pass one.
- Each list gets a `*PageResponse` DTO and an index covering its filter/sort columns.
- **Ripple rule:** moving an endpoint to `{data,meta}` breaks every dropdown or finder that
  unwrapped it as an array. The fix is always the same — keep the array-returning hook but unwrap
  `.data` with a capped `limit` (100), and add a **separate** paginated hook for the management
  table.

### 13.5 Typed responses & the error envelope

- **Backend: one `*.response.ts` per module**, every field an explicit `@ApiProperty`.
  **Money/Decimal → `string` ALWAYS** (`@ApiProperty({ type: String })`, #1), including non-money
  decimals (pct, km). Nullable/enum/nested fields need an explicit `type`/`enum`/`type: () => Child`
  or swagger reflection degrades them to `Record<string, never>`. Free-form JSON uses
  `{ type: 'object', additionalProperties: true }`; a **known** shape is modelled as a real nested
  DTO, not a blob. Name them `<Entity>Response`.
- **`@ApiErrorResponses()` goes on the controller CLASS** (one line, cascades to every route) and
  attaches `ErrorEnvelopeDto` to 400/401/403/404/409/422. Success responses stay per-method.
- **Every error is normalized to `{ error: { code, message, details } }`** by the global
  `AllExceptionsFilter`. `DomainError` (framework-free, `common/errors`) → **422**; anything
  unrecognized → a **masked 500** with a correlation id. **Map a client-fault domain error at the
  service boundary**, never inside pure or mirrored logic — the engine's internal-invariant throws
  stay bare so they remain 500s.
- **Structured error payloads are a feature, not noise.** Billing's `unpriced[]`, expenses'
  `missing_km_rate[]` and the import gate survive into `details` — read them off `ApiError.details`
  and render an actionable banner that links to the fix (`UnpricedBanner`, `MissingKmRateBanner`),
  rather than burying a 422 in a toast.

### 13.6 Money on screen

- **The UI computes NO money.** Every amount is server-sourced. `lib/format/money.ts#money()` is
  pure string formatting; `sumMoney` totals in integer cents. Never `Number()` a money value except
  to plot a chart point (#1).
- Pay Run's waterfall, the statement's component columns and the clawback's snapshot fields are
  **presentation of server numbers** — the `+`/`−`/`=` glyphs do no arithmetic.
- **A negative net is shown** (danger colour, with its sign) — never hidden or floored to zero.
- **The leaderboard shows counts only, never money** (§5) — asserted at the source.

### 13.7 Charting

Recharts, **pinned to v3**, themed entirely through tokens. Series colours come from
`--chart-1..5` via `charts/chartTheme.ts` — never a hard-coded hex, so charts adapt to light/dark
for free. `ChartContainer` is the chrome; `ThemedBarChart` / `ThemedLineChart` /
`ThemedStackedAreaChart` + `ChartTooltip` / `SeriesTooltip` are the reusable marks. **Series are
labelled directly — no legend box.** Recharts v3's `dataKey` is a strict `TypedDataKey`, so chart
data is typed as an open `Record<string, string|number>` rather than a generic. Charts are
**lazy-loaded** with their page so the ~350 kB chunk never loads elsewhere.

### 13.8 Exports & generated files

- **`lib/export/exportFilename.ts` is THE naming convention** —
  `redwave-<source>[-<period>]-<generated>`. Pure and deterministic (the caller passes
  `generatedOn`, so it never reads a clock). **Every** client-generated file goes through it.
- `exportRows` / `ExportMenu` produce CSV (hand-rolled), Excel (**`write-excel-file`**) and PDF
  (`jspdf` + `jspdf-autotable`), **dynamically imported** so they load only on export. Print = the
  browser dialog plus a print stylesheet. `write-excel-file` v4 downloads **only** via
  **`.toFile(name)`** — the removed `{ fileName }` option fails silently, so never cast away its
  return type.
- **Server-rendered downloads need `exposedHeaders: ['Content-Disposition']` on CORS.** Without it
  the browser hides the header cross-origin and every file saves as `download (n)`. It only
  manifests in production, never through the dev proxy — keep the header when touching CORS.
  `lib/api/downloadFile` does the raw fetch + bearer + CSRF → blob.
- Excel/PDF chosen over SheetJS `xlsx` (parse-side CVEs) on both the render and the parse side
  (the backend parses with `exceljs`).

### 13.9 Auth, session and security (client side)

- **Access token in memory; the refresh token is an httpOnly, rotating, DB-backed cookie** with
  double-submit CSRF (`X-CSRF-Token` must match the readable `rw_csrf` cookie). It is never in
  `localStorage` and never in a JSON body. Replaying an old refresh secret is treated as **reuse →
  the session is revoked**.
- **Refresh is SILENT; only a DEFINITIVE 401/403 logs you out.** `doRefresh()` returns a
  discriminated result: 200 → new token; 401/403 → clear session + `expired`; **5xx/408/429/network
  throw → transient, session KEPT**. The 401 interceptor runs a single-flight refresh and retries
  the original request once. On boot a transient failure is retried (~4×2s) to ride a cold start.
  Clearing the session on any non-OK response is what caused the old "logged out within a minute"
  report — the JWT TTLs were never the problem. Multi-tab logout syncs via a `storage` event.
- Login is two-step when MFA is enrolled; `must_change_password` and `mfa_enrollment_required` ride
  `/me` and route the user to a forced-change / enrollment screen.

### 13.10 Domain laws the UI must not break

Each of these is enforced server-side too; the UI must not quietly reintroduce the thing the rule
forbids.

- **Billing prices nothing.** The billing feature reads only `/v1/statements`, `/v1/invoices`,
  `/v1/clients`, `/v1/billing-periods` — **zero** path touches `commission_*` or the engine (#3),
  and no commission amount ever appears on a statement. Totals are the server's. **NO GST.**
- **Clawback amounts are server-computed.** The entry form's amount is **blank by default** so the
  POST omits it and the backend derives it from the frozen snapshot; the snapshot components are
  shown read-only but **never summed** by the UI. `reported_date` is captured and labelled
  informational — **no window is computed anywhere** (#4).
- **Pay Run displays, never recomputes** (#5/#8). Finalize is a deliberate, explained confirm,
  disabled while in flight; once finalized the run is read-only.
- **Documents: signing is ROW-LEVEL, not a permission.** There is no `documents:sign`. Offer
  Sign/Decline only when the current user has a pending signature in a pending request; the server
  is the gate (403 / 409). The overall status is **server-derived** — display it, never recompute
  it. Decline is terminal.
- **The chatbot is a thin surface.** Its only network call is `POST /v1/chatbot/query`. It performs
  **no data access of its own** and enforces no scope — the backend's intent-only, entitlement-gated
  tools are the guarantee. Refusals arrive as normal 200s and render as ordinary bubbles.
- **Expenses are folder-first, ONE folder per stakeholder per week.** An item is created inside a
  report (folder) and the folder is submitted and reviewed as a unit; folder status is **derived**,
  never stored. A week is a single container: the key is **whose expenses these are** (the `rep_id`,
  or the `submitted_by` when there is no rep) — **never who created it**, or a rep's own folder and
  an admin's on-behalf folder for that same week coexist. Two partial unique indexes enforce it in
  the DB; a second create RESOLVES to the existing folder and returns `reused: true`, which the UI
  must report honestly rather than claiming it created one. The km amount is
  **server-authoritative** (client-side preview is indicative only). Validation **Alerts block
  save; Warnings never do**. Approval is approver judgement — validation does not gate it.
  **Whether an item needs a receipt or a description is per-category CONFIG**
  (`requires_receipt` / `requires_description`), never a category key hard-coded in the app — Meals
  ships with both relaxed. **Absent config means REQUIRED**, so a new category never silently stops
  asking, and relaxing either one never relaxes the **money**: a missing amount is still a blocking
  Alert and the soft cap still warns. A blank description displays as the category label.
- **Effective-dated config is APPEND-A-NEW-FUTURE-ROW** (#10). The UI shows a read-only
  current/pending/past table plus an "add rate" form; a future row supersedes the scope's pending
  row and bounds the current one **server-side**. Only **pending** rows may be edited or deleted.
  **The `status` comes from the server** — no client-side date math beyond a `todayIso()` default
  and a back-date guard the server re-enforces with 422.
- **The sales export shows the frozen commission snapshot and reads no billing rate** (#3) — it is
  deliberately **blank on an unpaid sale**, because a zero would read as "earned nothing".

### 13.11 Where to read the history

`docs/build-log.md`, in build order. Jump by topic:

| Doing this | Build-log entry |
| --- | --- |
| Any new screen | *Screen patterns* · *Shared data primitives + the SERVER-SIDE list contract* |
| Typing a new endpoint | *Typed responses & the error envelope* |
| Effective-dated config UI | *Clients & Products* · *Commission Config* · *Per-client commission rates* |
| Anything money-facing | *Pay Run UI* · *Clawback UI* · *Billing & Statements UI* · *Billing — gapless numbering* · *Weekly client billing* · *Bundle-bonus pricing* · *Client expense billing document* |
| Expenses | *Expenses (ITEM-FIRST)* → *Per-type expense fields* → *Report-as-folder* → *Expense UAT batch* |
| Charts / dashboards | *Dashboards, charting & notifications* → *Dashboards & Reporting overhaul* |
| Notifications / broadcast | *Notifications overhaul + SA event management/broadcast* |
| Exports & generated files | *Export naming, the sales export shape* |
| Upload / preview / e-signature | *Documents & E-Signature UI* |
| Auth, sessions, MFA, CSRF | *Auth / session* → *Security hardening* |
| Admin surfaces & permission gating | *Account & Settings* · *Administration admin CRUD* · *RBAC governance* |
| Import wizard / templates | *Data Import & Integration UI* |
| Logo, favicon, loading states | *Brand assets & the `Logo` component* · *`LoadingSpinner`* |

### 13.12 Still deferred

**Combobox/autocomplete** and a full **date-range picker** (placeholders shipped; finder and
dropdown reads cap at 100 until a typeahead lands). Scheduled/recurring report exports. A
server-side field-schema editor for expense categories. Materialized views for dashboard
aggregation (bounded in-app `groupBy` today). See §12 for the backend deferrals.

---

## 14. Backend domain rules that aren't obvious from the code

Established across the build batches (the reasoning is in `docs/build-log.md`). Each of these, if
broken, produces a wrong document or wrong money, and none of them is apparent from reading the
surrounding code.

1. **Two calendars — never substitute one for the other.** `pay_periods` are **Sun–Sat,
   biweekly** and govern **rep pay** (a sale's period is derived from its `sale_date`, #7).
   `billing_periods` are **Mon–Sun, weekly**, sequentially numbered ("Bill 17"), and govern
   **client billing**. A bill therefore straddles two pay periods: a sale entered the Monday after
   a bill closes falls into the NEXT bill even though the pay period has not rolled. The expense
   **report folder** week is also Mon–Sun, but it is a *label only* — it never overrides an item's
   `pay_period_id`, which is derived from that item's own `expense_date`.

2. **Document numbers are gapless and minted exactly once, inside the issuing transaction.**
   `SequenceService.next(tx, key)` row-locks the `document_sequences` counter, so numbering is
   concurrency-safe and gapless. **Numbers are minted on ISSUE only — never on preview.**
   Statements, invoices and client expense documents are **append-only versions**: a correction
   issues a NEW numbered document and marks the prior one `superseded`; a number, total, line set
   or rendered file is **never** mutated. Replace-in-place is forbidden.

3. **Statement pricing composes, and never silently under-bills.** `line_total` is the exact sum
   of its components (internet · tv · hp · bundle · spiff · other) — spec-locked across many
   compositions. Every rate kind is applied: the client-wide add-on kinds (`tv_addon` / `hp_addon`)
   **win over** the product rate and never stack with it; `spiff` is bounded by its own effective
   window, which is **frozen onto the statement** so a re-render reproduces the same column header.
   A product priced by **no** kind at all is a **422 carrying `unpriced[]`** — never a zero and
   never a dropped line. Bundles are additive and optional: a missing bundle rate is simply not
   applied, not an error.

4. **`customer_name` is DERIVED** from `customer_first_name` + `customer_last_name` in one helper,
   so the stored pair and the display name cannot drift. Sales entered before the split are split
   at generation time.

5. **Import resolves CELL VALUES through a vocabulary, not string equality.** Mapping normalises column
   names and cleaning normalises formats (dates/money/codes); `value-vocabulary.logic.ts` is the third
   layer that turns a human-written cell into a canonical key — `"Internet, TV"` → `internet,tv`,
   `"Home Phone"` → `home_phone`. It is **catalogue-driven**, so an SA-added product type resolves with no
   code change, and it **reports an unresolvable value rather than guessing** (`Fibre Optic` stays
   unknown). Resolution happens at CLASSIFY time and the canonical keys are written back into the staged
   row, so commit handlers never re-resolve. Never compare an imported cell to a catalogue key with `===`.

6. **A historical sale row is one HOUSEHOLD, and its billed amount is recorded once.**
   `master_migration:sales` takes `product_types` (possibly several) → one sale with N `sale_items`. The
   row's `billed_amount` goes on the **base item only** (catalogue behaviour `tiered`/`greenfield`, else
   the first); the rest are NULL. It is **never divided** — splitting invents an attribution the source
   never stated and cannot round cleanly. This keeps `Σ historical_billed_amount` equal to the source
   file's own total, which is exactly what the Business dashboard sums (#1/#3).

7. **An import may create referenced master data only on the MIGRATION target, only by opt-in.**
   `create_missing` (persisted on the batch, because remap and a reconcile edit re-classify) turns a
   missing client / rep / product into a created placeholder on `master_migration + sales`. It is **422 on
   every other target** — above all live sales, where an invented rep or product would reach the tier tally
   and the pay run (#5). Three lines never move: an unresolvable **product TYPE** is still an error (the
   catalogue is SA-governed config, #10); a created product gets **no billing rate** (#3) and no money
   field; and the **preview lists exactly what will be created** before anything is staged.

8. **MPU ID is the PARTNER's identifier, and is optional everywhere.** It is a per-house id printed on the
   remittance file a program partner sends (CTI and VF supply it; **RF Now does not**, and neither do
   Redwave's own spreadsheets). Redwave never invents one. `sales.mpu_id` is nullable, the Sale ID uses it
   only "if provided", and a client report matches on it **where available** — a row without one falls back
   to customer name + address + date. That fallback **never auto-validates on a guess**: only an
   unambiguous strong candidate matches, and everything else is surfaced with its candidates for the
   operator, because validating the wrong sale pays the wrong rep.

9. **An import reads the file's shape; it does not demand one.** Product types may arrive as a list in one
   cell (`"Internet, TV"`) **or as one true/false column per type** — the layout Redwave's own files use.
   Detection of those columns is EXACT, so `"Internet Rate"` is never read as the internet flag, and an
   explicit list cell always wins over the flags. Reps resolve by `rep_code` **or** the optional
   `external_code` alias (`Redwave20`), so existing spreadsheets need no rewriting; `rep_code` remains the
   immutable, never-reused business key (#11).

10. **The structural guard specs ARE the enforcement — never delete one to make a refactor pass.**
   `engine.purity.spec.ts` holds §6 (a source scan bans Prisma/DB/sibling imports and any clock or
   randomness; behavioural tests assert zero constructor deps and that neither the config nor the
   activation list is mutated). `billing.no-commission.spec.ts` holds #3 (source scan **plus** a
   throw-on-touch Prisma mock **plus** total equivalence). `folder-agnostic.spec.ts` holds the
   expense folder layer as pure grouping — no money read may reference `expense_report_id`. If one
   of these fails, an invariant broke: fix the code, not the spec.
