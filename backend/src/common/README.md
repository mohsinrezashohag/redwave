# `src/common/` — cross-cutting building blocks

Shared pieces every domain module depends on (`CLAUDE.md` §4). **Reuse these — do not
reimplement.** Several are load-bearing for the invariants in `CLAUDE.md` §3; where that is the
case it is called out below.

## Request pipeline (registered globally in `AuthModule` / `app.module.ts`)

| Path | What it is |
| --- | --- |
| `guards/` | `JwtAuthGuard` (authenticates, loads roles→permissions fresh, rejects inactive users and revoked sessions) then `PermissionsGuard` (authorizes). Order matters. |
| `decorators/` | `@Public()`, `@RequirePermission(module, action)`, `@CurrentUser()`. A route with no `@RequirePermission` is authenticated-only. |
| `rbac/` | The module-key catalogue and `buildEffectivePermissions` — permission identity is the string `moduleKey:action`. |
| `scope/` | `ScopeService` — `all` / `roster` / `self` rep-id scoping. **Apply it in the `where`, never as a response filter** (§5). |
| `filters/` | `AllExceptionsFilter` — normalizes everything to `{ error: { code, message, details } }`. Unknown errors are masked as a 500 with a correlation id. |
| `errors/` | `DomainError` (framework-free marker → **422**), `ErrorEnvelopeDto`, `@ApiErrorResponses()`. Use `DomainError` for client-fault rules; a bare `Error` correctly becomes a 500. |
| `security/` | `CsrfGuard` + cookie helpers (double-submit CSRF; duplicate-cookie safe — see `CLAUDE.md` §13 Security). |
| `audit/` | `AuditService` (`@Global`). Auditing is **explicit at the service layer** so before/after is accurate — not a magic interceptor. |

## Money & correctness (invariant-critical)

| Path | What it is |
| --- | --- |
| `money/` | `roundMoneyHalfUp` / `formatMoney` / `sumMoney`. Exact decimal in storage; 2 dp **HALF_UP** at the presentation boundary only. The house rounding rule (#1). |
| `effective-dating.ts` | `planSupersession` / `selectEffectiveRate` / `deriveStatus` — the one supersession implementation, shared by billing rates, commission config and km rates (#10). Scope-agnostic: callers group by scope and pass the group. |
| `timezone.ts` | `todayInWinnipeg()` / `winnipegDateOnly()`. **Every** date-boundary decision goes through these — never a bare `new Date()` (#7). |
| `fx/` | `FxRateService` (Bank of Canada, env-gated, graceful) + the pure `convertToCad`. Captured rates are frozen, never re-converted (#12). |
| `sequence/` | `SequenceService.next(tx, key)` — gapless document numbers, incremented inside the issuing transaction. |

## Plumbing

| Path | What it is |
| --- | --- |
| `pagination/` | `PaginationQuery`, `paginate.ts` (`toSkipTake` / `buildPage` / `resolveOrderBy` — the sort **allowlist is the orderBy-injection guard**), `PageMetaResponse`. The `{ data, meta }` list contract. |
| `storage/` | S3-compatible (Supabase) object storage. Files are stored by **path**; bytes are served only via short-TTL signed URLs. |
| `email/` | `MailerService` (Resend, env-gated) + `app-link.ts` — **the single source for every user-facing link**; in production an unset `APP_BASE_URL` refuses to send rather than linking to localhost. |
| `notifications/` | The `NOTIFICATION_EMITTER` token/interface + `renderTemplate`. Inject the token; emits are post-commit and best-effort. |
| `crypto/` | `password-hash` — the canonical bcrypt wrapper. |
| `ops/` | `superadmin-reset` — the testable core of the guarded SA recovery script. |
| `dto/`, `util/` | `SuccessResponse`; `user-public` (the safe user projection — `password_hash` is never selected). |
