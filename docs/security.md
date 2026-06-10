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
- **Retention** — this is a financial ledger: sale, pay-run, holdback, clawback, and audit records are
  retained for the legally required period and are **never hard-deleted** (terminations/deactivations are
  soft status changes; rep codes are never reused). Document storage holds signed documents + identity files
  by object path, served only via short-TTL signed URLs.
- **Minimisation & access** — collect only what the pipeline needs; access is gated by role and audited. A
  data-subject access/erasure request is handled operationally (export the subject's records; erasure of
  ledger entries is constrained by financial-retention law — anonymise where deletion isn't permitted).
- **In transit / at rest** — HTTPS everywhere (HSTS); passwords + tokens are hashed; object storage is
  access-controlled.

## 9. Operator checklist (deploy)

1. `prisma migrate deploy` (applies `20260610170000_security_hardening`) + `npm run prisma:seed` (adds the
   `audit` permissions + SA `roles.mfa_required` + the `security_settings` row).
2. Set env: `NODE_ENV=production`, `COOKIE_DOMAIN=.redwavemarketing.ca`, `CORS_ORIGIN=<frontend origin>`,
   strong `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, `ENABLE_SWAGGER=false` (or Basic-auth creds),
   `CHATBOT_RPM`/`CHATBOT_DAILY_CAP`, `MFA_ISSUER`.
3. Confirm the Vercel CSP `connect-src` lists the real API origin; load the app and watch the console
   (report-only first if unsure).
4. Verify: cookie refresh + rotation, an MFA enrol round-trip, force-logout across devices, the SA audit view.
