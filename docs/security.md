# Security Posture — Redwave ERP/HRM

> The consolidated security model for the platform. Read alongside `architecture.md` (§auth/RBAC) and
> `CLAUDE.md` §3/§5. Server-side RBAC is the real gate on every endpoint; the UI only guides. The audit
> trail is append-only and immutable.

## 1. Authentication & sessions

- **Access token** — a short-lived JWT (`JWT_ACCESS_TTL`, default 15m) carrying `sub` (user id) + `sid`
  (refresh-session id). Stored **in memory only** in the SPA. Verified on every request; the `JwtAuthGuard`
  re-loads the user (rejecting inactive accounts) and rejects any token whose `sid` session is revoked →
  **immediate** revocation, not just at refresh.
- **Refresh token** — an **opaque, rotating, DB-backed** secret (`refresh_sessions`), NOT a JWT. Delivered
  as an **httpOnly `rw_refresh` cookie** (`SameSite=Lax`; `Secure` + `Domain=COOKIE_DOMAIN` only in
  production). JS never reads it. Each `/v1/auth/refresh` **rotates** the secret on the same session row;
  presenting an old/rotated secret is treated as **token reuse → the session is revoked** (breach detection).
- **CSRF** — double-submit. Login/refresh/mfa-verify set a **readable `rw_csrf` cookie**; the SPA echoes it
  in the `X-CSRF-Token` header on every request. A global `CsrfGuard` enforces header == cookie on mutating
  methods for cookie-bearing sessions (safe methods, `@CsrfExempt` pre-auth routes, and Bearer/API requests
  with no `rw_csrf` cookie are skipped). SameSite=Lax + the in-memory access token already block CSRF on
  Bearer endpoints; this is defense-in-depth.
  **Duplicate-cookie safe:** a browser can hold several `rw_csrf` cookies (e.g. a stale **host-only** one
  from a deploy that ran before `COOKIE_DOMAIN`/`NODE_ENV` were configured, alongside the domain-scoped
  one); the stale one sorts first and cookie-parser keeps only it, which 403'd every production mutation.
  The guard therefore accepts a header matching **any** presented `rw_csrf` value (security-equivalent —
  the caller still proves it can read a site cookie), and cookie ISSUE (`cookie.util.ts`) first **expires
  the host-only variant** of both auth cookies when setting domain-scoped ones, so affected browsers heal
  on their next login/refresh.
- **Brute-force lockout** — `failed_login_attempts` / `locked_until` (default 5 attempts / 15 min,
  env-tunable). **Password policy** — ≥8 with upper+lower+digit.
- **Active sessions / revoke** — `GET/DELETE /v1/auth/sessions` (self); `POST /v1/users/:id/revoke-sessions`
  (SA force-logout, `users:edit`). Deactivating a user revokes all their sessions. Revocation is honoured on
  the next request (access) and at refresh.

## 2. MFA (TOTP)

- Authenticator-app TOTP (`otplib`) + **10 one-time recovery codes** (hashed, shown once). Enrollable by any
  user from **My Account → Security**. SA can clear a user's MFA (`POST /v1/users/:id/disable-mfa`) for
  lost-device recovery.
- **Policy-driven**: per-role `roles.mfa_required` (Super Admin seeded `true`) + a singleton
  `security_settings.mfa_enforced` master switch (**default OFF** so MFA rolls out per-user without locking
  testers out mid-cycle). When ON, a required-role member who isn't enrolled is routed to `/setup-mfa` before
  using the app (`/me` carries `mfa_enrollment_required`). Managed at `/admin/security` (`settings:edit`).
- Login is two-step only when the user is already enrolled: the password step returns an `mfa_token`
  challenge (no session issued) redeemed at `POST /v1/auth/mfa/verify` with a TOTP or recovery code.

## 3. Transport & headers

- **API (helmet, `backend/src/main.ts`)** — HSTS (prod), `frame-ancestors 'none'` + `X-Frame-Options`
  (clickjacking), `X-Content-Type-Options: nosniff`, a referrer policy, and a strict API CSP. CORS is
  **credentialed**; set `CORS_ORIGIN` to the frontend origin allowlist in production.
- **SPA (`frontend/vercel.json`)** — CSP (`default-src 'self'`; `script-src 'self'` — the theme boot is
  externalised to `/theme-boot.js` so no `unsafe-inline` is needed; `worker-src blob:` for pdf.js;
  `connect-src` includes the API origin + Maps + Supabase; `img-src data: blob:` for QR/avatars/tiles), HSTS,
  **Google Maps needs Google's documented allowlist, not just `maps.googleapis.com`** — `*.googleapis.com`
  / `*.gstatic.com` / `*.google.com` (+ `*.ggpht.com`, `*.googleusercontent.com`) across `script-src`,
  `img-src` and `connect-src`, `blob:`/`data:` on script/connect, and `frame-src https://*.google.com`. The
  narrower policy was the leading suspect when the KM map went missing in production (2026-11).
  `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, and a restrictive `Permissions-Policy`.
  - **Operator note:** `connect-src` lists `https://api.redwavemarketing.ca` — **change it to your real API
    origin** if different. If a screen fails to load, deploy the CSP as `Content-Security-Policy-Report-Only`
    first, watch the console, then enforce.

## 4. Swagger / API docs

`/docs` is **disabled in production** unless `ENABLE_SWAGGER=true`, and then it is gated behind HTTP Basic
(`SWAGGER_USER` / `SWAGGER_PASSWORD`). The contract is never exposed publicly. (`contract:export` is an
offline script and is unaffected.)

## 5. Audit trail (append-only)

- Every money/config mutation and access-denial writes to `audit_log` (actor, entity, action, before/after,
  **IP** via the request-context middleware, timestamp). **No update/delete path exists** — the trail is
  immutable; keep it so.
- **SA view**: `GET /v1/audit-logs` (`audit:view`, Super Admin only) — filter by actor/entity/action/date.
  The same endpoint filtered by `entity_type`+`entity_id` powers the per-record **History tab** on detail
  screens. `audit:view`/`audit:export` are registered in the role matrix (Super Admin only by default).

## 6. Rate-limiting & cost cap

The chatbot endpoint is per-user rate-limited (`CHATBOT_RPM`, in-memory 60s window) + daily-capped
(`CHATBOT_DAILY_CAP`, from the persisted conversation count) to bound Gemini spend. Over the limit returns a
**graceful 200** ("try again shortly"), never an error. Align `CHATBOT_DAILY_CAP` with the GCP budget alert.

## 6b. File storage (Supabase — private bucket)

- **Private bucket only — no public access ever.** Bytes are served exclusively through RBAC/visibility-gated
  endpoints that mint a **short-TTL signed URL per access** (receipts 60s via
  `GET /v1/expense-items/{id}/receipt-url`; documents/signatures via the `…/file-url` endpoints, which apply
  the same scoping as the record reads). No long-lived URL is ever stored on a row.
- **Service-role key is server-only** (`SUPABASE_SERVICE_ROLE_KEY`) — never shipped to the browser; the SPA
  only ever sees minted signed URLs.
- **Server-generated paths.** The unified `POST /v1/files` pipeline builds `{purpose}s/yyyy/mm/uuid.ext`
  itself — a client never supplies a path or influences the key (no traversal, no collisions, no spoofed
  extensions; the extension comes from the validated mime). Allowlist JPEG/PNG/PDF, ≤10 MB (422 otherwise).
- **Claim validation.** Every upload is recorded in `stored_files` (uploader, mime, size, sha256, names,
  timestamp). A consumer (expense receipt, document original) may only attach a path that exists there AND
  was uploaded by the caller (Admin/SA exempt); unknown and foreign paths get the same 422 — no existence
  leak. Document claims must be PDFs.
- **Fail-safe, never fail-open:** storage unconfigured → `POST /v1/files` and the new download endpoints
  return **503 "file storage not configured"** — broken/stub references are never minted on this pipeline.
- **Audited:** uploads (`action: 'upload'`) and signed-URL issuance (`action: 'download'`, who/path/when)
  land in the append-only audit log.
- **No new permission** — `POST /v1/files` is authenticated-only (uploading creates only the caller's own
  metadata row); the real gates are at claim time (expense create rules, `documents:create`) and at download
  (the existing per-record visibility). The role-permission matrix is unchanged.

## 7. Secrets & rotation

**No secret lives in the repo** — only `backend/.env.example` (placeholders). Production secrets stay only in
Render / Supabase / Vercel env. Never commit a real `.env`.

### Rotation runbook
- **`JWT_ACCESS_SECRET`** — set `JWT_ACCESS_SECRET_OLD` to the current value, then set `JWT_ACCESS_SECRET` to
  a fresh strong value and redeploy. `verifyAccess` accepts either during the grace window, so live access
  tokens (≤15m) keep working; remove `*_OLD` after the access TTL elapses. **Zero downtime.**
- **`JWT_REFRESH_SECRET`** — refresh tokens are opaque DB sessions, NOT JWTs, so this secret is no longer
  used to sign them; rotating it has no effect on sessions (kept in env for completeness). To force a
  global re-login, truncate/revoke `refresh_sessions` (or deactivate+reactivate users).
- **Gemini key (`GEMINI_API_KEY`)** — issue a new key in Google Cloud, set it in Render env, redeploy, then
  revoke the old key. The chatbot stays leak-proof (intent-only LLM) regardless.
- **`SUPABASE_SERVICE_ROLE_KEY` / `RESEND_API_KEY` / `GOOGLE_MAPS_API_KEY`** — rotate in the provider
  dashboard, update the host env, redeploy, revoke the old. Restrict the browser Maps key to your domains.
- **Super Admin / DB passwords** — rotate via the provider; the SA password is also changeable in-app.

## 8. PII / privacy (PIPEDA stance)

Redwave handles rep and customer personal information; we follow Canadian **PIPEDA** expectations:

- **Access scoping (in the query, not the response)** — a rep reads only their own data, a manager only their
  roster, Super Admin all. **Exports are RBAC-scoped**: pay-run + expense exports filter to the caller's reps
  (a manager exports only their roster, never the whole company). Two reps can never see each other's
  earnings; the leaderboard shows counts only.
- **Field redaction** — sensitive fields are nulled in the query unless the caller is entitled: rep
  `payment_details` and document `file_url`s require `hrm:edit`; the Business/Executive dashboard
  (partner financials) is Super Admin only. Extend this discipline to any new sensitive field.
- **Rep profile PII (2026-11).** Date of birth, phone, email and address are nulled in every rep response
  unless the caller holds `hrm:edit` (`toRepView` in `hrm/reps.service.ts` is the ONE serializer for list,
  get, create and update), and the audit log records only their presence. **The SIN is encrypted at rest**
  (AES-256-GCM, `common/crypto/field-cipher.ts`, key `PII_ENCRYPTION_KEY` in the Render env, never in the
  DB): responses carry only `sin_on_file` + `sin_masked` (`••• ••• 286`, hrm:edit only); the full value
  comes from `POST /v1/reps/:id/sin/reveal` (hrm:edit), which writes a `reveal_sin` audit row every time
  and never logs the value. No key → a SIN is refused (503), never stored in clear. **Back up the key:**
  losing it makes every stored SIN unreadable.
- **Retention** — this is a financial ledger: sale, pay-run, holdback, clawback, and audit records are
  retained for the legally required period and are **never hard-deleted** (terminations/deactivations are
  soft status changes; rep codes are never reused). Document storage holds signed documents + identity files
  by object path, served only via short-TTL signed URLs.
- **Minimisation & access** — collect only what the pipeline needs; access is gated by role and audited. A
  data-subject access/erasure request is handled operationally (export the subject's records; erasure of
  ledger entries is constrained by financial-retention law — anonymise where deletion isn't permitted).
- **In transit / at rest** — HTTPS everywhere (HSTS); passwords + tokens are hashed; object storage is
  access-controlled.
- **ID document reading (2026-11-12)** — when HR asks the app to read an ID's dates, the file is sent to
  Google Gemini (`DocumentReaderService`). Use a **paid** Gemini API key: Google does not use paid-tier
  inputs to improve its models (free-tier inputs may be). Nothing the model returns is stored or logged; the
  audit row records only that a read happened and which fields were found. Only the dates HR confirms are
  saved. Without `GEMINI_API_KEY` the feature is off and the file never leaves our storage.

## 9. Operator checklist (deploy)

1. `prisma migrate deploy` (applies `20260610170000_security_hardening`) + `npm run prisma:seed` (adds the
   `audit` permissions + SA `roles.mfa_required` + the `security_settings` row).
2. Set env: `NODE_ENV=production`, `COOKIE_DOMAIN=.redwavemarketing.ca`, `CORS_ORIGIN=<frontend origin>`,
   strong `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, `ENABLE_SWAGGER=false` (or Basic-auth creds),
   `CHATBOT_RPM`/`CHATBOT_DAILY_CAP`, `MFA_ISSUER`.
3. Confirm the Vercel CSP `connect-src` lists the real API origin; load the app and watch the console
   (report-only first if unsure).
4. Verify: cookie refresh + rotation, an MFA enrol round-trip, force-logout across devices, the SA audit view.
