# `src/modules/` — domain modules

One module = one NestJS module that **owns its own tables and endpoints** and calls other modules
only through their **defined interface** — never reaching into their internals. Where a module
genuinely needs another's number (expenses → pay run, clawback → pay run), the seam is an
**injected provider token**, not a direct import of the other service.

See [`docs/architecture.md`](../../../docs/architecture.md) §4 and `CLAUDE.md` §4 (the module
table) / §5 (RBAC) / §6 (the engine).

## Built modules

| Module | Owns |
| --- | --- |
| `auth/` | login, JWT + refresh sessions, MFA, password reset, the two global guards |
| `account/` | own profile + theme + profile-change requests + saved e-signatures |
| `users/` | user CRUD, role assignment, admin-assisted password reset |
| `roles/` | role CRUD + the permission matrix (built-in roles are `is_system`) |
| `hrm/` | reps, rep documents, equipment |
| `clients/` | clients, products, client billing rates, custom fields |
| `commission/` | tier/flat/holdback config, incentives, the product-type catalogue |
| `engine/` | the Commission Engine — **pure, isolated, zero constructor deps** |
| `sales/` | sales, sale_items, validation, the composite Sale ID |
| `payrun/` | pay periods, runs, lines, holdback ledger, ADP export |
| `clawback/` | cancellation recoveries against frozen snapshots |
| `expenses/` | expense reports (folders), items, km logs, field configs, km rates |
| `billing/` | statements, invoices, client expense documents, billing periods, exports |
| `documents/` | documents, signature requests, in-system PDF stamping |
| `import/` | data import & integration (stage → reconcile → commit) |
| `reporting/` | dashboards, leaderboard, notifications, chatbot, report exports |
| `reconciliation/` | statement + pay-run tie-out — deliberately **outside** `billing/` so the "no commission in the billing stream" source scan stays clean |
| `files/` | the unified upload pipeline (`POST /v1/files`) + claim validation |
| `currencies/` | the currency catalogue reference read |
| `audit/` | the append-only audit-log read surface (Super Admin only) |
| `search/` | global search — reuses each entity's own permission, adds none |

## Rules that apply to every module here

- **Invariants live in `CLAUDE.md` §3.** Money is exact-decimal (`Prisma.Decimal`, decimal
  strings in DTOs) — never floats. Paid `sale_item` snapshots are immutable. The commission and
  client-billing rate streams never join.
- **RBAC is declared per endpoint** (`@RequirePermission(module, action)`) and **scoped in the
  query** via `ScopeService` — never by filtering a response.
- **Cite the rule's source** next to each business rule in code (`CLAUDE.md` §9), e.g.
  `// Gross tally; cancellations never re-tier the period. — BRD §4.1 / SRS COMM`.
- **Client-fault domain errors** throw `DomainError` from `common/errors` (→ 422 through the
  global filter). A bare `Error` is a server fault and correctly becomes a masked 500.
