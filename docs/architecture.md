# Redwave ERP / HRM — Architecture & API Contract (v1.0)

> Repo reference copy generated from the approved Architecture & API Contract v1.0 .docx. The Word version is the client-facing deliverable; this markdown is for in-repo use by the dev tooling. The architecture diagram lives in **Redwave_Architecture.drawio**. API endpoint paths, verbs, and permissions are preserved exactly.

**Prepared by:** Fathom (Development Partner)

**Client:** Redwave Marketing Inc.

**Version:** 1.0 — aligned to BRD v1.2, Data Model v1.0, SRS v1.0

**Phase:** Architecture & Design (final pre-build artifact)

**Companion diagram:** Redwave_Architecture.drawio (open in diagrams.net)

> **What this document is for**
> This is the structural blueprint. It fixes the **API contract** — the stable seam between backend, web frontend, and the future mobile app — so the three can be built in parallel. It also sets the module boundaries, the RBAC enforcement model, and the rules that protect financial correctness. Recommendations on stack are marked as such; the architectural principles are firm.

## 1. Architectural Goals

The architecture serves five goals, in priority order, drawn directly from the BRD and SRS:

- **Financial correctness.** Every dollar is reconstructable and exact. The architecture makes incorrect money structurally hard: isolated commission logic, immutable snapshots, transactional pay runs, exact-decimal arithmetic.

- **Configurability without deploys.** Business values live in effective-dated configuration, read at runtime. Admins change rules; developers do not redeploy.

- **Modularity.** Independent modules behind a stable contract; one module can be upgraded or replaced without disturbing the others.

- **Scalability & mobile-readiness.** A stateless API scales horizontally and is the single seam a future mobile app consumes — no second backend.

- **Auditability & security.** Server-side RBAC on every call; an append-only audit trail; sensitive data access-gated.

## 2. Architecture Overview

The system is a single-stack, API-first modular monolith in four layers (TypeScript end to end on PostgreSQL), shown on page 1 of the companion diagram. The build sequence is schema-first, then contract-first, then parallel implementation.

| **Layer**                   | **Responsibility**                                                                                                                                                                                                               |
|-----------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Client layer                | The web app and (later) a mobile app, plus the admin console. Clients hold no business logic that affects money; they render data and call the API.                                                                              |
| API layer                   | A single versioned REST API, described by an OpenAPI contract. Cross-cutting concerns live here: authentication (JWT), the RBAC guard (module × action), request validation, and audit logging. This layer is the contract seam. |
| Application / service layer | The twelve modules, each owning its domain logic and data access, all within one TypeScript deployable. The Commission Engine is deliberately isolated (see §8).                                                                 |
| Data layer                  | PostgreSQL for relational data (exact-decimal money, effective-dated config, immutable snapshots) and object storage for files (receipts, signed documents, exports, import files).                                              |

> **Why API-first (contract-first), not frontend-first or backend-first**
> Fixing the API contract early turns it into a stable interface both sides build against at once: the frontend works to mocked responses while the backend implements the real ones, and they meet in the middle. It also means the future mobile app is just another consumer of the same contract — no parallel backend. Building frontend-first would bake in UI assumptions the commission rules might later violate; building backend-first in isolation leaves nothing testable for weeks.

## 3. Technology Stack (Decided)

The stack below is a confirmed team decision, not a menu. The platform is built as a single-stack, true modular monolith: TypeScript end to end (NestJS backend, React frontend), on PostgreSQL, with a REST/OpenAPI contract and server-side RBAC. Every module — including Data Import & Integration — is implemented in this one stack; there is no second runtime or satellite service.

> **Decision: single-stack TypeScript, true modular monolith**
> The team evaluated mixing in a Python service for data import/preprocessing and **deliberately chose against it**. The import work (Excel/CSV parsing, fuzzy matching, dedup, reconciliation) is a defined, repeatable pipeline with a fixed staging-table output — well within TypeScript’s libraries — so a second language’s benefit was marginal while its cost (no longer a true monolith, a second runtime, cross-language seams, added hiring/maintenance burden) was real. One language end to end wins on cohesion, toolchain simplicity, long-term maintainability, and Claude Code leverage. A separate analytical/ML service in another language remains a possible Phase-3+ decision only if heavy analytics ever justify it.

| **Concern**        | **Decision**                           | **Rationale**                                                                                                                                                                        |
|--------------------|----------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Database           | PostgreSQL                             | Exact NUMERIC/decimal money, JSONB (used by the model), strong transactions for atomic pay runs, mature, scales. Fixed.                                                              |
| Architecture       | Modular monolith (single deployable)   | Clean module boundaries inside one deployable; no microservice/distributed-transaction overhead at Redwave’s scale; a module can be split out later if ever needed.                  |
| Backend            | TypeScript + NestJS                    | Module-per-domain maps 1:1 to our decomposition; dependency injection and guard decorators fit the RBAC model; strong typing protects financial code; excellent Claude Code support. |
| API style          | REST, described by OpenAPI 3           | Universal for web + mobile; OpenAPI is a machine-readable contract that generates client types and mocks — the literal seam artifact. Fixed.                                         |
| Web frontend       | React (TypeScript)                     | Same language as the backend; shares a typed API client generated from the contract; one toolchain and mental model across the stack.                                                |
| Data import module | In-stack (TypeScript)                  | Implemented as a normal module using TS Excel/CSV and matching libraries, writing into the staging tables (import_batches/import_rows). Isolated by boundary, not by language.       |
| Mobile (later)     | Consumes the same API                  | React Native or native; no backend changes required.                                                                                                                                 |
| Auth               | JWT bearer tokens                      | Stateless, scales horizontally, works identically for web and mobile. Server-side RBAC. Fixed.                                                                                       |
| Money              | Exact decimal (or integer minor units) | Never floating point; a decimal library enforced as a system-wide rule (NFR).                                                                                                        |
| File storage       | S3-compatible object storage           | Receipts, signed docs, exports, import files; references stored in Postgres.                                                                                                         |
| Background jobs    | A job queue (in-stack)                 | For exports, email dispatch, and heavy report aggregation off the request path.                                                                                                      |
| Analytics          | SQL / materialized views first         | Dashboard aggregations done in Postgres; a separate analytics service is added only if volume ever demands it (not now).                                                             |

## 4. Module Decomposition & Boundaries

Twelve modules, each owning its tables and exposing its behavior through the API. Dependencies are explicit (page 2 of the diagram). A module never reaches into another's internal logic; it calls the other's defined interface.

| **Module**                | **Owns / responsibility**                                         | **Depends on**                                                  |
|---------------------------|-------------------------------------------------------------------|-----------------------------------------------------------------|
| Auth & RBAC               | Identity, roles, permissions, enforcement, audit.                 | —                                                               |
| HRM / Reps                | Rep profiles, documents, equipment.                               | Auth                                                            |
| Clients & Products        | Clients, per-client products, client billing rates.               | Auth                                                            |
| Commission Config         | Tiers, flat rates, holdback config & release setting, incentives. | Auth                                                            |
| Commission Engine         | Pure tier/commission calculation. Isolated.                       | Commission Config, Sales (read)                                 |
| Sales & Validation        | Sales, sale items, Sale ID, validation, greenfield.               | Clients, HRM                                                    |
| Pay Run & Holdback        | Pay periods, runs, lines, holdback ledger, ADP export.            | Commission Engine, Sales, Expenses, Clawback, Commission Config |
| Clawback                  | Cancellation recoveries (flat deduction).                         | Sales (snapshot)                                                |
| Expenses                  | Reports, items, KM logs, configs, exports.                        | Clients, Pay periods                                            |
| Billing & Statements      | Client statements (one line/customer), invoices.                  | Sales, Clients                                                  |
| Documents & E-Sign        | Documents, signature requests, signatures.                        | Auth, Notifications                                             |
| Data Import & Integration | Staging, mapping, migration, reconciliation.                      | Sales, HRM, Clients, Pay Run                                    |
| Reporting & Dashboards    | Role-scoped dashboards, leaderboard, analytics.                   | (reads many, writes none)                                       |
| Notifications             | In-app + configurable email per event.                            | Auth                                                            |
| Chatbot                   | Integrated Gemini assistant, role-gated.                          | Auth                                                            |

## 5. The API Contract

One versioned REST API, described by an OpenAPI 3 specification that is the authoritative, machine-readable contract. The conventions below apply to every endpoint.

### 5.1 Conventions

- **Versioning.** All paths are prefixed /v1; breaking changes introduce /v2 without disturbing existing clients.

- **Resources & verbs.** Nouns for resources; GET (read), POST (create / action), PATCH (partial update), DELETE. State transitions are explicit action sub-resources (e.g. POST /sales/{id}/validate).

- **Auth.** Every request carries Authorization: Bearer \<jwt\>; unauthenticated requests get 401.

- **Errors.** A consistent envelope: { error: { code, message, details } }, with appropriate HTTP status (400/401/403/404/409/422).

- **Lists.** Paginated: ?page=&limit= (or cursor), returning { data: [...], meta: { total, page } }. Filters are query params (e.g. ?status=&rep_id=&client_id=&date_from=).

- **Idempotency.** Money-moving actions (finalize pay run, commit import) accept an Idempotency-Key so a retry never double-pays or double-commits.

- **Money in transit.** Monetary values are transmitted as exact decimal strings (or integer minor units), never floats.

> **The contract is the seam**
> The OpenAPI spec is generated/maintained alongside the backend and published to the frontend and mobile teams. From it they generate typed clients and mock servers, so all three streams build against one source of truth. Changing the contract is a deliberate, reviewed act — not a side effect of a code change.

## 6. API Reference by Module

Representative endpoints per module (not exhaustive; the OpenAPI spec is authoritative). Permissions show the (module, action) the RBAC guard requires.

### 6.1 Auth & RBAC

| **Verb**  | **Path**                   | **Purpose**                      | **Permission** |
|-----------|----------------------------|----------------------------------|----------------|
| **POST**  | /v1/auth/login             | Authenticate, return JWT.        | public         |
| **POST**  | /v1/auth/logout            | Invalidate session.              | any            |
| **GET**   | /v1/users                  | List users.                      | users:view     |
| **POST**  | /v1/users                  | Create user, assign roles.       | users:create   |
| **PATCH** | /v1/users/{id}             | Edit / deactivate user.          | users:edit     |
| **GET**   | /v1/roles                  | List roles.                      | roles:view     |
| **POST**  | /v1/roles                  | Create custom role.              | roles:create   |
| **PATCH** | /v1/roles/{id}/permissions | Set role's module×action grants. | roles:edit     |

### 6.2 HRM / Reps

| **Verb**  | **Path**                | **Purpose**                               | **Permission** |
|-----------|-------------------------|-------------------------------------------|----------------|
| **GET**   | /v1/reps                | List/filter reps.                         | hrm:view       |
| **POST**  | /v1/reps                | Create rep (code validated unused).       | hrm:create     |
| **PATCH** | /v1/reps/{id}           | Edit rep / set field manager / terminate. | hrm:edit       |
| **POST**  | /v1/reps/{id}/documents | Upload rep document.                      | hrm:edit       |
| **POST**  | /v1/reps/{id}/equipment | Assign equipment + deposit.               | hrm:edit       |

### 6.3 Clients & Products

| **Verb** | **Path**                       | **Purpose**                         | **Permission** |
|----------|--------------------------------|-------------------------------------|----------------|
| **GET**  | /v1/clients                    | List clients.                       | clients:view   |
| **POST** | /v1/clients                    | Create client.                      | clients:create |
| **POST** | /v1/clients/{id}/products      | Create per-client product.          | clients:edit   |
| **GET**  | /v1/clients/{id}/billing-rates | List effective-dated billing rates. | clients:view   |
| **POST** | /v1/clients/{id}/billing-rates | Add billing rate (effective-dated). | clients:edit   |

### 6.4 Commission Configuration

| **Verb**  | **Path**                                | **Purpose**                        | **Permission**  |
|-----------|-----------------------------------------|------------------------------------|-----------------|
| **GET**   | /v1/commission/tiers                    | Current + pending tier schedule.   | commission:view |
| **POST**  | /v1/commission/tiers                    | New effective-dated tier schedule. | commission:edit |
| **POST**  | /v1/commission/flat-rates               | Set greenfield/TV/HP flat rates.   | commission:edit |
| **PATCH** | /v1/commission/holdback-config          | Set advance/holdback split.        | commission:edit |
| **PATCH** | /v1/commission/holdback-release-setting | Set bulk/sticky release cycle.     | commission:edit |
| **POST**  | /v1/incentives                          | Create time-boxed spiff.           | commission:edit |

### 6.5 Sales & Validation

| **Verb**   | **Path**                  | **Purpose**                              | **Permission** |
|------------|---------------------------|------------------------------------------|----------------|
| **POST**   | /v1/sales                 | Enter sale; server generates Sale ID.    | sales:create   |
| **GET**    | /v1/sales                 | List/filter (status, rep, client, date). | sales:view     |
| **PATCH**  | /v1/sales/{id}            | Edit sale (pre-validation).              | sales:edit     |
| **POST**   | /v1/sales/{id}/validate   | Validate sale.                           | sales:approve  |
| **POST**   | /v1/sales/{id}/greenfield | Confirm/clear greenfield flag.           | sales:approve  |
| **DELETE** | /v1/sales/{id}            | Delete pre-payout invalid sale.          | sales:delete   |
| **POST**   | /v1/sales/bulk-validate   | Validate via import pipeline.            | sales:approve  |

### 6.6 Pay Run & Holdback

| **Verb** | **Path**                   | **Purpose**                               | **Permission** |
|----------|----------------------------|-------------------------------------------|----------------|
| **GET**  | /v1/pay-periods            | List pre-loaded periods.                  | payrun:view    |
| **POST** | /v1/pay-runs               | Create a draft run for a period.          | payrun:create  |
| **GET**  | /v1/pay-runs/{id}/lines    | Per-rep computed lines.                   | payrun:view    |
| **POST** | /v1/pay-runs/{id}/finalize | Finalize (idempotent; freezes snapshots). | payrun:approve |
| **POST** | /v1/pay-runs/{id}/export   | Generate ADP export (stored).             | payrun:export  |
| **GET**  | /v1/holdback-ledger        | Holds, schedule, release status.          | payrun:view    |

### 6.7 Clawback

| **Verb** | **Path**      | **Purpose**                            | **Permission**  |
|----------|---------------|----------------------------------------|-----------------|
| **GET**  | /v1/clawbacks | List clawbacks.                        | clawback:view   |
| **POST** | /v1/clawbacks | Enter clawback (amount from snapshot). | clawback:create |

### 6.8 Expenses

| **Verb**  | **Path**                         | **Purpose**                            | **Permission**   |
|-----------|----------------------------------|----------------------------------------|------------------|
| **POST**  | /v1/expense-reports              | Submit weekly expenses.                | expenses:create  |
| **GET**   | /v1/expense-reports              | List/filter (date, rep, client, type). | expenses:view    |
| **PATCH** | /v1/expense-reports/{id}         | Edit (pre-approval; SA after).         | expenses:edit    |
| **POST**  | /v1/expense-reports/{id}/approve | Approve / send back.                   | expenses:approve |
| **POST**  | /v1/expense-exports              | Generate export (stored).              | expenses:export  |

### 6.9 Billing & Statements

| **Verb** | **Path**                    | **Purpose**                             | **Permission** |
|----------|-----------------------------|-----------------------------------------|----------------|
| **POST** | /v1/clients/{id}/statements | Generate statement (one line/customer). | billing:create |
| **GET**  | /v1/statements              | List generated statements.              | billing:view   |
| **POST** | /v1/clients/{id}/invoices   | Generate one-line commission invoice.   | billing:create |

### 6.10 Documents & E-Signature

| **Verb** | **Path**                              | **Purpose**                             | **Permission**   |
|----------|---------------------------------------|-----------------------------------------|------------------|
| **POST** | /v1/documents                         | Upload a document.                      | documents:create |
| **POST** | /v1/documents/{id}/signature-requests | Request signature (1..many recipients). | documents:create |
| **POST** | /v1/signature-requests/{id}/sign      | Sign or decline; stores signed copy.    | any (recipient)  |
| **GET**  | /v1/documents/{id}                    | Status + per-signer audit.              | documents:view   |

### 6.11 Data Import & Integration

| **Verb** | **Path**                   | **Purpose**                                 | **Permission** |
|----------|----------------------------|---------------------------------------------|----------------|
| **POST** | /v1/imports                | Upload file + mapping; create staged batch. | import:create  |
| **GET**  | /v1/imports/{id}           | Preview staged rows + match status.         | import:view    |
| **POST** | /v1/imports/{id}/reconcile | Resolve unmatched rows.                     | import:edit    |
| **POST** | /v1/imports/{id}/commit    | Commit (idempotent; reconcile-gated).       | import:approve |
| **GET**  | /v1/imports                | Import/migration history.                   | import:view    |

### 6.12 Reporting & Platform

| **Verb**  | **Path**                  | **Purpose**                  | **Permission**        |
|-----------|---------------------------|------------------------------|-----------------------|
| **GET**   | /v1/dashboards/rep        | Rep's own dashboard data.    | self                  |
| **GET**   | /v1/dashboards/manager    | Roster-scoped manager data.  | reports:view (roster) |
| **GET**   | /v1/dashboards/business   | Company financials (period). | reports:business (SA) |
| **GET**   | /v1/dashboards/business/trends | Cross-period trend series. | reports:business (SA) |
| **GET**   | /v1/dashboards/admin      | Operational queue counts.    | reports:view (Admin/SA) |
| **GET**   | /v1/leaderboard           | Ranked counts (no earnings). | reports:view          |
| **GET/PUT** | /v1/sales-targets       | Rep activation targets (read scoped; set requires hrm:edit). | self/roster · hrm:edit (set) |
| **GET**   | /v1/notifications         | User's notifications.        | self                  |
| **PATCH** | /v1/notification-settings | Event×channel config.        | settings:edit (SA)    |

`reports:business` is an off-grid `PermissionAction` (Super Admin only) — the business/executive dashboard and
the trends endpoint. The trends endpoint is a **bounded in-app aggregation** (≤24 periods) over the Batch-1
`sales` indexes; materialized views remain a deferred performance option (§12), not a source of truth.

## 7. RBAC Enforcement Model

Authorization is enforced on the server for every request — never by hiding controls in the UI alone.

1.  Each endpoint declares the (module, action) permission it requires (shown in §6).

2.  On each request, after JWT authentication, an RBAC guard loads the caller's effective permissions (the union of their roles' grants).

3.  If the required permission is absent, the request is rejected with 403 and the attempt is written to the audit log.

4.  Data scope is additionally enforced: a rep can only read their own records; a manager only their roster; Super Admin sees all. Scope is applied in the query, not just the response filter.

> **Why server-side and scoped**
> Two reps must never see each other's earnings; a manager must not see reps outside their roster; partner financials are Super-Admin-only. Because these are money-and-privacy rules, they are enforced where the data is fetched, so a crafted request cannot bypass a hidden button.

## 8. The Commission Engine (Isolated)

The single most important architectural decision: commission calculation is an isolated, deterministic module that other modules call but never reach into. It is the part most likely to be wrong, and the part where wrong means underpaying a contractor.

- **Pure & deterministic.** Given a rep's activations for a period and the effective configuration, the engine returns the tier, per-item amounts, and totals with no side effects. Same inputs → same outputs, always.

- **Config-driven.** It reads tiers, flat rates, and incentives from Commission Config by effective date; nothing is hard-coded.

- **Gross-tally, never re-tiers.** It computes the tier from the gross internet tally and applies it to all internet activations in the period; cancellations are handled by Clawback as flat deductions and never feed back into tiering.

- **Heavily tested with the SRS worked examples as fixtures.** The acceptance examples are encoded as unit tests so the engine is provably correct before anything depends on it.

> **Mandatory test fixtures (from the SRS)**
> • 20 internet → Tier 2 ($145); +4 TV, +3 HP, +2 greenfield → gross $3,310; 70% = $2,317, 30% = $993.
> • 3 VF internet + 9 RF internet → tally 12 → Tier 3 → all 12 at $125 (cross-client aggregation).
> • Tier boundary: 16 internet → Tier 3 ($125); 17 internet → Tier 2 ($145).
> • Per-product clawback: TV cancels → −$30 flat; internet untouched; period not re-tiered.

## 9. Pay Run Processing

A pay run is the most sensitive transaction in the system and is built to be atomic and idempotent.

- **Transactional.** A finalize computes every rep's line and writes them in a single database transaction; partial pay runs cannot occur.

- **Idempotent.** Finalizing carries an Idempotency-Key; a retried or duplicated request never double-pays or double-releases a holdback.

- **Snapshot-freezing.** On finalize, each paid sale_item's tier, rate, commission, and incentive are frozen; these are the values Clawback later reads.

- **Composed, not coupled.** The run asks the Commission Engine for amounts, the Holdback ledger for releases (per the Super-Admin setting), Expenses for approved totals, and Clawback for flat deductions — then composes the net. Each is a defined call, not a reach-in.

- **Net formula.** net = 70% advance + released 30% + approved expenses + bonus − clawbacks.

## 10. Data Layer & Integrity

| **Concern**                | **Rule**                                                                                                                                                                |
|----------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Exact-decimal money**    | All monetary columns use exact decimal types; arithmetic never uses floats.                                                                                             |
| **Immutable snapshots**    | sale_items snapshot columns are write-once at payment; corrections are new records (clawback/adjustment).                                                               |
| **Effective-dated config** | Tier/rate/product/billing-rate rows carry effective_from/to; queries select the row effective on the sale/pay date.                                                     |
| **Separated rate streams** | client_billing_rates and commission_\* live in separate tables with no join path that mixes them.                                                                      |
| **Transactions**           | Pay-run finalize and import commit are single atomic transactions.                                                                                                      |
| **Staging before commit**  | Imports land in import_rows and are validated/reconciled before any write to live tables.                                                                               |
| **Indexing**               | Index the hot query paths: sales by (rep_id, sale_date), by (client_id, mpu_id) for clawback matching, holdback by (rep_id, status), audit by (entity_type, entity_id). |
| **Referential integrity**  | Foreign keys enforced; rep_code uniqueness enforced including against terminated reps (never reused).                                                                   |

## 11. Cross-Cutting Concerns

| **Concern**        | **Rule**                                                                                                                            |
|--------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| **Authentication** | JWT bearer tokens; short-lived access token with refresh; password hashing (bcrypt/argon2).                                         |
| **Authorization**  | Central RBAC guard (§7) on every endpoint; scope applied in queries.                                                                |
| **Audit logging**  | An interceptor writes create/update/delete/approve on financial & config entities to audit_log with actor, timestamp, before/after. |
| **File storage**   | Object storage for receipts, signed documents, exports, and import files; only references in Postgres; access-controlled URLs.      |
| **Notifications**  | In-app always; email dispatched via a background job only when the event's channel setting enables it (rate_change off by default). |
| **Validation**     | Request bodies validated against the contract schema at the boundary; business-rule validation in the service layer.                |
| **Error handling** | Uniform error envelope; no leaking of internals; 4xx for client faults, 5xx logged with correlation IDs.                            |
| **Configuration**  | All business values via config tables/admin UI; secrets via environment, never in code.                                             |

## 12. Scalability, Performance & Mobile Readiness

- **Stateless API.** No server-side session state (JWT), so API instances scale horizontally behind a load balancer.

- **Read models for dashboards.** Heavy aggregations (business dashboard, leaderboard) may use materialized views or a cached read model refreshed on a schedule — keeping live transactional tables fast. This is purely a performance layer; it adds no new source-of-truth entities.

- **Background jobs.** Exports, email, and report builds run off the request path so interactive screens stay responsive.

- **Pagination & indexing.** All list endpoints paginate; hot paths are indexed (§10).

- **Mobile readiness.** Because all behavior is behind the versioned API, the mobile app is a new client of the same contract — no backend fork. JWT auth and REST work identically on mobile.

## 13. Build Sequencing & Parallelization

With the schema and contract fixed, work parallelizes cleanly. Recommended order:

5.  Lock the data model migrations and seed the OpenAPI contract (this document) as the source of truth.

6.  Build Auth & RBAC first — everything depends on it.

7.  Build the Commission Engine in isolation against its test fixtures (§8) — prove correctness before anything consumes it.

8.  Build Sales, Commission Config, Clients/Products, HRM in parallel (each owns its tables and endpoints).

9.  Build Pay Run, Clawback, Expenses on top, then Billing, Documents, Import, Reporting.

10. Frontend builds against the OpenAPI contract (typed client + mocks) in parallel with the backend throughout.

> **Working with Claude Code**
> Use Plan Mode per module first (read-only exploration + a reviewed plan), then Code Mode to implement against the contract and tests. A repo CLAUDE.md should carry the invariants (immutable snapshots; rate streams never mix; no clawback date math; sale_date governs the period) and the comment standard (cite the BRD/SRS reference next to each business rule) so every session inherits them. The CLAUDE.md is the next artifact after this document.

## 14. Deployment, Environments & Cutover

- **Environments.** Separate development, staging, and production; configuration and secrets per environment.

- **Migrations.** Schema changes are versioned migrations applied in order; never hand-edited in production.

- **Data migration.** Go-live data (master + opening balances) loads through the Import module with the reconcile-before-commit gate (SRS §15).

- **Parallel run.** Run the system alongside the manual Excel process for 1–2 pay cycles and reconcile outputs before full cutover — payroll correctness is verified against reality before reliance.

- **Backups & recovery.** Automated database backups with a documented restore procedure; object storage versioning for documents.

*End of Architecture & API Contract v1.0 · companion to Redwave_Architecture.drawio*
