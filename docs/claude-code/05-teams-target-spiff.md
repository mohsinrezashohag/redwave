# Packet 05 — Teams, and target-based client SPIFF

**The largest packet. Scope it with Redwave before writing code.**

## Goal
Client-side SPIFF that pays out when an agent hits a weekly target, **or when a team collectively does**.

## What Siam asked for
> "একেকটা এজেন্ট যদি সার্টেন অ্যামাউন্ট সেল করতে পারে **অথবা অ্যাজ বিইং এ টিম** যদি সার্টেন অ্যামাউন্ট সেল করতে পারো ইন্টারনেট ওই উইকের জন্য"

Per agent **or** collectively, on internet, for that billing week.

## Two things stand in the way

**1. Today's spiff has no target logic.** `rate_kind='spiff'` on `client_billing_rates` is a flat,
date-bounded, per-sale amount — `selectEffectiveRate`, then apply. That flat form is real and stays
(Siam described it too: a summer incentive on every sale). The target-conditional form is new.

**2. There is no team concept anywhere in the schema.** No team, group, branch or squad. Confirmed:
teams must be built first. Redwave's answer: *"mostly field managers or any other team"* — so
`Rep.field_manager_id` is the common case but **not** the definition. Build a real grouping.

## What to build

**Phase A — teams.**
- `teams` + `team_members` tables and a dated migration. A rep may belong to more than one team;
  membership is effective-dated (#10) so a mid-period move does not rewrite history.
- Seeding a team from a field manager's reps is a convenience action, not the data model.
- CRUD + RBAC + a simple admin screen following the §13.2 screen playbook.

**Phase B — target spiff.**
- Extend the spiff rate kind with: `target_scope` (`agent` | `team`), `target_team_id`,
  `target_metric` (internet activations), `target_count`, and the evaluation window (the billing week).
- Evaluate in `statement.logic.ts` as a pure function over the week's sales. Applied only when the
  target is met.
- The statement column header must state the condition and window, the way the existing spiff column
  already freezes `spiff_from`/`spiff_to`.

## Invariants at risk — read carefully
- **#3.** This is the **client** stream. It must not read or write `commission_*`. Rep-side incentives
  already have `target_type`/`target_count` — they are a different feature on the other stream. Do not
  merge them, do not share a table "to avoid duplication".
- **#5.** Counting activations for a target must not touch or re-derive the commission tier.
  A separate count, for a separate purpose, on a separate stream.
- **#2.** Once a statement is issued, the spiff decision is frozen with it. A later membership change
  never alters an issued document.
- **#10.** Target config is effective-dated like every other rate row.

## Definition of done
- A team target met → spiff applied to that week's qualifying lines; not met → absent, with the reason
  visible on preview.
- An agent target and a team target can coexist on one client without double-paying. Decide the
  precedence rule **with Redwave**, write it in the build-log entry, and assert it in a spec.
- A rep moving teams mid-period does not change an already-issued statement.
- `grep -r "commission_" backend/src/modules/billing/` shows no new reference.

## Ask before building
1. If both an agent target and a team target are met, does the client pay both, or the higher?
2. Is the team target counted on internet activations only, or all products?
3. Can a team span clients, or is a team per client?
