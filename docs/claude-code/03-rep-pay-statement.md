# Packet 03 — Per-rep pay statement (admin-issued and rep self-service)

**Depends on packet 02.** Reuses `payroll_report_lines`.

## Goal
A statement for one rep showing, per sale: what was sold, the price, their 70%, and the 30% held.
Redwave issues it today; reps generate their own later. Both forms are in scope — confirmed.

## What Siam asked for
> "70% তোমাকে এই সেলের জন্য... প্রাইস ছিল 88 ডলারের 70%, বাকি 30% হোল্ড"

Per sale, not a period summary.

## Read first
- Packet 02's `payroll_report_lines` and logic module.
- `backend/src/common/rbac/` — the permission model and how self-scoping is expressed.
- `Rep.user_id` in `backend/prisma/schema.prisma` — the `RepLogin` relation already exists.
  Reps can be given logins; you are not building an identity model.

## What to build

**1. Admin-issued statement** — endpoint under `/v1/pay-runs/{id}/reps/{repId}/statement`,
PDF or Excel consistent with how client statements are rendered. Reuses the packet-02 frozen lines
filtered to one rep. Do not recompute.

**2. Rep self-service** — a new permission (e.g. `pay_statements:read_self`) and a self-scoped
endpoint that resolves the rep from the authenticated user via `Rep.user_id`.

**3. Frontend** — an action on the rep's pay-run row for admins, and a simple statements list for
a logged-in rep.

## Security — the part that matters
A rep must **never** see:
- another rep's lines, totals, or existence in the response
- **any client billing rate** — this statement is the rep stream only (#3)
- org-wide aggregates, margin, or client revenue

Self-scoping is resolved **server-side from the token**. Never from a `repId` in the request path or
body — that is the whole vulnerability. Add a spec that asserts rep A requesting rep B's statement
gets 403, not an empty 200.

## Invariants at risk
**#2** read frozen snapshots only · **#3** no client rates on a rep-facing document ·
**RBAC §5** enforced server-side, every endpoint.

## Definition of done
- Admin can issue a statement for any rep in a finalized pay run.
- A rep with only `pay_statements:read_self` can fetch their own and is 403 on anyone else's.
- Response contains no client-rate field. Assert this in a spec, not by inspection.
- Numbers reconcile exactly with that rep's rows in the packet-02 payroll report.

## Do NOT
- Do not let the rep-facing endpoint reuse an admin serializer that happens to include extra fields.
  Build a separate response DTO with only what a rep may see.
