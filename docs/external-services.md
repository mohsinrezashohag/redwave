# External Services & Keys — Provisioning Guide

> What the platform needs from the outside world to run for real. Every item below is
> currently **stubbed** in code (the workflow is built and tested; only the real provider
> is missing). For each: what it's for, which endpoints/modules stub it today, the
> credential shape, and provider options.
>
> **Provider choice is yours / Redwave's** (budget, compliance, existing infra). The code
> reads every credential from the **environment / secret store** — real keys go in
> `backend/.env` (dev) or the host's secret manager (prod), **never into code or chat.**

## 1. Object storage (file uploads) — REQUIRED for go-live
- **WIRED → Supabase Storage (the same provider for all of):** expense receipts (`POST /v1/expense-receipts`),
  **documents** (`POST /v1/documents` — the PDF original, per-signer stamped copies, the final all-signatures
  copy, and saved-signature images), and **rep documents** (`POST /v1/reps/{id}/documents`). Files are stored
  by **object path**; bytes are served only through RBAC/visibility-gated `…/file-url` endpoints that mint a
  short-TTL **signed URL** on each access (never public). Env-gated + graceful: with the env below it's a real
  upload; unset → a `local://` reference and file-url endpoints 404 (the workflow still functions).
  - **Credentials (env):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only secret),
    `SUPABASE_STORAGE_BUCKET` (default `receipts`). Create the bucket first.
- **STILL STUBBED `s3://…`:** expense exports + billing statement/invoice exports (the server-recorded export
  artifact; the client-side file export is real). **Word→PDF conversion** for documents is deferred (PDF-only
  today) — a later enhancement (headless LibreOffice or a hosted converter, env-gated).
- **Provider options (for the remaining stubs):** Supabase Storage (already used) · AWS S3 · Cloudflare R2 ·
  Backblaze B2 · MinIO. Reuse the `common/storage` `StorageService` (`upload`/`uploadBuffer`/`signedUrl`).
- **Code today:** CLAUDE.md §12 — expense/billing export stubs + the Word→PDF deferral. (Expense receipts,
  documents/e-signature, and rep documents are no longer stubs; the e-signature provider is now real
  in-system stamping via pdf-lib — no third-party e-sign vendor.)

## 2. Email — REQUIRED for go-live
- **For:** notification emails (the `EMAIL_DISPATCHER` is a noop today — Reporting/Notifications),
  and unblocks the user invite / password-reset flow (AUTH-002).
- **Provider options:** AWS SES · SendGrid · Postmark · Resend · Mailgun.
- **Credentials (env):** `EMAIL_PROVIDER`, `EMAIL_API_KEY` (or SMTP host/user/pass), `EMAIL_FROM`.
- **Code today:** CLAUDE.md §12 "Reporting deferrals — Email/SMS dispatch stubbed (EMAIL_DISPATCHER noop)".

## 3. SMS — OPTIONAL (confirm with Redwave whether they want SMS notifications at all)
- **For:** SMS-channel notifications, if used. The notification model has channels but only
  in-app + email are seeded; SMS is not required unless Redwave wants it.
- **Provider options:** Twilio · AWS SNS · MessageBird.
- **Credentials (env):** `SMS_PROVIDER`, `SMS_API_KEY`/`TWILIO_SID`+`TWILIO_TOKEN`, `SMS_FROM`.
- **Decision needed:** does Redwave want SMS? If no, skip entirely.

## 4. LLM / Gemini (chatbot real NL) — LOWER URGENCY (stub is usable)
- **For:** the chatbot's real natural language. Today the `LLM_PROVIDER` is a stub recognizing
  5 keyword intents; a `ChatbotConfig` row (`provider:'gemini'`, `is_active:false`) already exists.
- **Provider options:** Google Gemini (per the seeded config) · or any LLM the intent-router can target.
- **Credentials (env):** `GEMINI_API_KEY` (+ model name, already in `ChatbotConfig`).
- **Code today:** CLAUDE.md §12 "Reporting deferrals — Gemini LLM stubbed (StubLlmProvider)".
- **Note:** the chatbot is **structurally leak-proof regardless** (intent-only LLM + entitlement-gated
  tools), so wiring the real LLM does not change the security model.

## 4b. Google Maps (expense KM distance) — OPTIONAL, recommended
- **For:** the expense kilometre log. **WIRED + env-gated, graceful.** Two keys:
  - **Browser (frontend):** `VITE_GOOGLE_MAPS_API_KEY` enables Places **address autocomplete** + the
    route **map** on the KM entry form (captures real lat/lng). Restrict to your domains + the Maps
    JavaScript / Places APIs. Unset → manual address + total-km entry (the server still computes the amount).
  - **Server (backend):** `GOOGLE_MAPS_API_KEY` lets the backend **re-derive the authoritative route
    distance** from the stops via the **Directions API** (the client value is ignored). Enable the
    Directions API on this key. Unset → the server falls back to the client-supplied `total_km`.
- **Money invariant:** the KM amount is **always** computed server-side (single −30 / round −60, floor 0,
  × $0.45). Maps only affects how the *distance* is obtained, never the amount math.

## 5. Production PostgreSQL — REQUIRED (the DB itself, not an external API)
- **For:** the live database. Dev uses local Postgres with password `7654321` (dev-only — never prod).
- **Provider options:** AWS RDS · Google Cloud SQL · Azure Database · Supabase · Neon · Render · self-host.
- **Credentials (env):** `DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/redwave?schema=public"`.
- **Run on deploy:** `npx prisma migrate deploy` (applies migrations), then `npm run prisma:seed`
  (RBAC catalogue + Super Admin + Schedule C v2 + 2026 pay periods).

## 6. App secrets (generated by you — not third-party)
- **JWT secrets:** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (separate, strong random values).
- **Super Admin seed:** `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD` (set a real strong
  password — if unset the seed uses a loud placeholder).

## Provisioning order (suggested)
1. Production Postgres (everything needs it) → set `DATABASE_URL`, run migrate + seed.
2. Object storage + Email (the two that block real use) → buckets/keys.
3. JWT + Super Admin secrets (generate strong values).
4. Gemini (when you want real NL) · SMS (only if Redwave wants it).
