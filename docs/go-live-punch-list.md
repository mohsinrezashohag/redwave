# Go-Live Punch List

> The loose ends to tie off before / during go-live, drawn from CLAUDE.md §12/§13.
> Grouped into prompt-able batches, in suggested order. Each is built the usual way:
> Plan Mode → review → build → verify (build/lint/stylelint + smoke) → commit.
> Run alongside the people-work: the §17 Redwave confirmations + a browser visual pass
> (the one verification an agent can't do).

## BATCH A — Backend hardening (small, highest leverage; do first)
1. **Global exception filter** — domain validation errors currently can surface as HTTP 500.
   Confirmed case: tier-contiguity violations throw a plain `Error` → 500 instead of 422
   (CLAUDE.md §13 "Commission Config — two backend findings"). Add a Nest global exception
   filter mapping domain/validation errors to the right status (422 etc.). Fixes tier + the
   whole class across modules. *Highest-value single change.*
2. **`@ApiResponse` response DTOs** — responses are `never`-typed in the contract, so every
   frontend feature **hand-writes** its response types (sales.types.ts, etc.). Add response
   DTOs so `gen:api` emits typed responses. (CLAUDE.md §13, recurring follow-up.)
3. **Server-side `/v1/sales` pagination** — returns a plain array today; the frontend has a
   client-side paginate seam (`useSalesList`) ready to switch. (CLAUDE.md §13 Sales.)
4. **Expose tier + gross on the pay-run line** — the line API omits them, so the Pay Run
   breakdown drawer can't show the full waterfall without UI math (forbidden). Add the fields.
   (CLAUDE.md §13 Pay Run UI.)

## BATCH B — Auth / user onboarding (needed to run a real org)
5. **AUTH-002 invite / password-reset** — no admin-set-password, invite/email, must-change, or
   self-service reset exists; create-user shows a temp password once. Build the real flow
   (invite email or admin reset endpoint; optional `must_change_password`). Depends on Email
   (external-services #2). (CLAUDE.md §12 + §13 Administration.)
6. **Server-side self-protection** — an admin can deactivate themselves / remove their own
   roles (lockout). The UI guards it, but add a server actor self-check. (CLAUDE.md §12.)
7. **httpOnly refresh cookie (optional, more secure)** — refresh token is in localStorage today
   (accepted tradeoff for an internal ERP); a httpOnly cookie is more XSS-resistant but needs a
   backend change. (CLAUDE.md §13 Auth/session.)

## BATCH C — Notifications & dashboards completeness
8. **User-facing notification-preferences READ endpoint (AUTH-013)** — the only settings endpoint
   is SA-gated, so non-SA users can't see their channels (the My Account tab shows a graceful
   banner). Add an authenticated own-scoped read (no per-user override). (CLAUDE.md §12.)
9. **Trend/period-aggregation endpoint for the Business dashboard** — it returns single-period
   scalars; `date_from`/`date_to` are accepted but ignored. Add aggregation so trend charts work
   (the FE shows a "trends coming" banner today). (CLAUDE.md §12 + §13 Dashboards.)

## BATCH D — Real integrations (swap the stubs — see docs/external-services.md)
10. **Object storage** — real upload/download for documents, receipts, exports (external #1).
11. **Email/SMS dispatch** — rebind `EMAIL_DISPATCHER` (external #2/#3).
12. **Real Gemini** — rebind `LLM_PROVIDER` (external #4); chatbot stays leak-proof.
13. **Real Excel/CSV parse** — Import's JSON-rows editor becomes real partner-file ingestion
    (parse → the same staging→reconcile→commit pipeline). (CLAUDE.md §12 Import deferrals.)

## BATCH E — Smaller schema/feature gaps (when convenient)
14. **`roles.status` soft-deactivation (AUTH-003)** — role removal is delete-of-custom-only today.
15. **`pay_run_exports` table (PAY-010)** — ADP export is audit-recorded only; add the table if the
    artifact must persist.
16. **KM map/geocoder** — expense km stops stub `lat/lng='0'` + manual `total_km`; add geocoding to
    auto-derive distance.
17. **Expense-report DELETE / void** — no delete endpoint exists.
18. **`reps.contact` column** — login-less reps have no separate contact.
19. **Billing add-on `rate_kind` pricing** — only `rate_kind='product'` is applied; confirm add-on
    combination rules with Redwave, then extend.

## PARALLEL (people + decisions, not code) — should happen before "final"
- **§17 Redwave confirmations:** holdback-release timing · greenfield-at-close · 2026 pay-period
  anchor/payday offset · `target_based` incentive rule · add-on rate_kind rules · historical/paid
  sales import rule. (CLAUDE.md §11 + §12.) Each turns a "PROPOSED" flag into settled behavior.
- **Browser visual pass:** every screen, light + dark — the verification an agent can't do.
- **Parallel-run** the pay run against the manual Excel process for 1–2 cycles before cutover
  (CLAUDE.md §8).

## DEPLOYMENT (the genuinely new phase — see external-services.md for providers)
- Hosting (backend, DB, frontend) · secrets/config management · `prisma migrate deploy` + seed in
  prod · backups · monitoring/logging/error-tracking · HTTPS/CORS/security-headers/rate-limiting.
