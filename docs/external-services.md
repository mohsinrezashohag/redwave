# External Services & Keys — Provisioning Guide

> What the platform needs from the outside world to run for real. Every item below is
> currently **stubbed** in code (the workflow is built and tested; only the real provider
> is missing). For each: what it's for, which endpoints/modules stub it today, the
> credential shape, and provider options.
>
> **Provider choice is yours / Redwave's** (budget, compliance, existing infra). The code
> reads every credential from the **environment / secret store** — real keys go in
> `backend/.env` (dev) or the host's secret manager (prod), **never into code or chat.**

## 1. Object storage (file uploads) — IMPLEMENTED → Supabase Storage (private bucket)
- **The unified pipeline (`POST /v1/files`)** backs user uploads — **expense receipts** (purpose=receipt) and
  **document originals** (purpose=document): JPEG/PNG/PDF, ≤10 MB, the storage **path is SERVER-generated**
  (`{purpose}s/yyyy/mm/uuid.ext` — never client-supplied), every upload is recorded in **`stored_files`**
  (who/what/when + sha256 + original/display name), and consumers **CLAIM** the path at use time (must be the
  caller's own upload; Admin/SA exempt) so a foreign/unknown reference can never be attached to a record.
  Images are compressed in-browser before upload (max 2000px long edge → JPEG 0.8; HEIC decoded on iOS).
- **Also on the same provider:** e-sign per-signer/final stamped copies + saved-signature images
  (server-generated), and **rep documents** (`POST /v1/reps/{id}/documents`, its own multipart flow).
- **Access:** the bucket is **PRIVATE — no public access ever**; bytes are served only through
  RBAC/visibility-gated endpoints that mint a **short-TTL signed URL** per access (receipts: 60s via
  `GET /v1/expense-items/{id}/receipt-url`; documents/signatures: the `…/file-url` endpoints). Upload AND
  signed-URL issuance are **audited**.
- **Fail-safe:** with the env unset, `POST /v1/files` + the new download endpoints return a clear **503
  "file storage not configured"** — never a silent stub reference. (The legacy flows — rep docs, e-sign
  copies, imports — keep their graceful `local://` fallback.)
  - **Credentials (env):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only secret),
    `SUPABASE_STORAGE_BUCKET` (default `receipts`). Create the PRIVATE bucket first.
- **STILL STUBBED `s3://…`:** expense exports + billing statement/invoice exports (the server-recorded export
  artifact; the client-side file export is real). **Word→PDF conversion** for documents is deferred (PDF-only
  today) — a later enhancement (headless LibreOffice or a hosted converter, env-gated).
- **Provider options (for the remaining stubs):** Supabase Storage (already used) · AWS S3 · Cloudflare R2 ·
  Backblaze B2 · MinIO. Reuse the `common/storage` `StorageService` (`upload`/`uploadBuffer`/`signedUrl`).
- **Code today:** CLAUDE.md §12 — expense/billing export stubs + the Word→PDF deferral. (Expense receipts,
  documents/e-signature, and rep documents are no longer stubs; the e-signature provider is now real
  in-system stamping via pdf-lib — no third-party e-sign vendor.)

## 2. Email — WIRED → Resend (env-gated, graceful)
- **For:** the user invite / password-reset flow (AUTH-002) + email-enabled notifications. The
  `common/email` `MailerService` sends transactional mail (invite / reset / temp password) via Resend; the
  notification `EMAIL_DISPATCHER` is rebound to Resend too. With no key it logs the intent (the build/flows
  still work); sends are best-effort (never break a user-create / forgot flow).
- **Credentials (env):** `RESEND_API_KEY`, `EMAIL_FROM` (a verified Resend sender on the domain below),
  `APP_BASE_URL` (the frontend base every email link is built from — **REQUIRED in production**, e.g.
  `https://app.redwavemarketing.ca`; dev defaults to `http://localhost:5173`; unset in production → the
  backend logs a loud startup error and refuses to send link-bearing emails rather than emailing localhost
  links; legacy `APP_URL` honored, deprecated). Optional: `LOCKOUT_MAX_ATTEMPTS`/`LOCKOUT_MINUTES`,
  `PASSWORD_RESET_TTL_MINUTES`/`INVITE_TOKEN_TTL_MINUTES`.
- **DNS to add in Namecheap (Advanced DNS) for `app.redwavemarketing.ca`** — add the domain in the Resend
  dashboard, then copy the EXACT values it generates (the DKIM public key is unique per domain — I cannot
  generate it). The records have this shape (host = the part Namecheap prepends to the domain):

  | Type  | Host (name)                  | Value (from the Resend dashboard)                          | Notes |
  |-------|------------------------------|------------------------------------------------------------|-------|
  | TXT   | `send.app`                   | `v=spf1 include:amazonses.com ~all`                        | SPF for the bounce subdomain |
  | MX    | `send.app`                   | `feedback-smtp.<region>.amazonses.com` (priority `10`)     | bounce/complaint handling; region per Resend |
  | TXT   | `resend._domainkey.app`      | `p=<long DKIM public key from Resend>`                     | DKIM — copy verbatim from Resend |
  | TXT   | `_dmarc.app`                 | `v=DMARC1; p=none;`                                        | optional but recommended |

  After the records propagate, verify the domain in Resend; once "Verified", set `EMAIL_FROM` to e.g.
  `Redwave <noreply@app.redwavemarketing.ca>` and email delivers. Until then, Resend rejects sends (the app
  still records the intent gracefully).
- **Provider note:** chose Resend per the brief. The seam is abstracted (`EMAIL_DISPATCHER` + `MailerService`)
  so the provider can be swapped without touching auth/notification logic.

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

## 4c. FX rate source (multi-currency, stored-FX) — OPTIONAL (only if a non-CAD client/expense exists)
- **For:** the daily currency→CAD rate frozen onto a foreign expense (at approval) or a foreign client
  billing document (at issue). **WIRED + env-gated, graceful** (mirrors Maps). CAD-only deployments can
  ignore this — CAD → rate `1`, no fetch, nothing to configure.
- **Provider:** **Bank of Canada Valet API** — public, free, **no API key**. The gate is a flag:
  - `FX_RATE_SOURCE="bank_of_canada"` → the server pre-fills the day's rate from the Valet series
    `FX{CUR}CAD` (e.g. `FXUSDCAD`), taking the most recent observation on/before the date.
  - unset / `"manual"` (DEFAULT) → no auto rate; the approver/issuer supplies a **manual override**. If a
    foreign record has neither an override nor an auto rate, the action is **rejected (422)** — the system
    never guesses a rate. `FX_HTTP_TIMEOUT_MS` (default 8000) bounds the lookup.
- **Money invariant:** the confirmed rate + its CAD conversion are **frozen once** (never re-converted, #12);
  the `amount_cad` is rounded 2 dp **half-up**. Rep pay stays CAD-only. No DNS/keys to provision.

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
