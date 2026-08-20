# Packet 05 — Target-based client SPIFF

> **RE-SCOPED 14 August 2026 after Redwave's answer. The team dimension is CANCELLED.**
> The original packet built teams first and then a spiff that could pay on an agent target **or** a team
> target. Redwave has confirmed there is no team concept and none is being built. What is left is recorded
> below, together with one question that must be answered before any of it starts.

## Redwave's answer (14 Aug 2026)

> There is no team concept, and none is being built. Spiffs are individual only. The engine already sums
> multiple matching incentives, so stacking is handled. Product scope and client scope are already
> admin-set on each incentive (`scope_product_type`: null = all / one catalogue key; `scope_client_id`:
> null = all clients / one). Do not build team targets. If a team-bonus feature is ever confirmed as
> wanted, it's separate net-new scope — hold until explicitly greenlit.

## CANCELLED — Phase A, teams

`teams` / `team_members` tables, effective-dated membership, CRUD, RBAC and the admin screen: **not being
built.** This is recorded as a decision rather than deleted, so the packet is not half-rebuilt later from
the old text.

A team feature is **net-new scope** if it ever comes back — it needs an explicit greenlight, not a revival
of this packet. The three "Ask before building" questions the original carried (both-targets precedence,
target metric, whether a team spans clients) are dead with it; all three were about teams.

## Already true, so nothing to build

Two things the answer describes are already in place on the **rep-pay** side, and were verified in the code
before this re-scope:

- **Multiple matching incentives stack.** `CommissionEngineService#addIncentive` does
  `item.incentiveAmount = item.incentiveAmount.plus(incentive.amount)` — genuinely additive across every
  matching incentive in the period pass.
- **Scope is already admin-set per incentive.** `Incentive.scope_product_type` (FK → the product-type
  catalogue key, `null` = every type) and `Incentive.scope_client_id` (`null` = every client).

So no work is needed for stacking or scoping **on the rep stream**.

## 🔴 OPEN — which stream is the target spiff on?

**This must be answered before anything in this packet is built, and it is not a detail.**

The answer above resolves stacking and scoping by pointing at **incentives**. `Incentive` is the
**rep-pay** stream — it feeds the commission engine and the pay run. But the target spiff Siam described
was specified on `client_billing_rates` with `rate_kind='spiff'`, which is the **client-billing** stream —
what we charge the client, not what we pay the rep.

What Siam asked for:

> "একেকটা এজেন্ট যদি সার্টেন অ্যামাউন্ট সেল করতে পারে … ইন্টারনেট ওই উইকের জন্য"
> — per agent, on internet, for that billing week.

Two readings, with opposite outcomes:

- **(a) The existing rep-side incentives already satisfy this.** Then **packet 05 is cancelled entirely**
  and nothing below gets built.
- **(b) The weekly-target spiff is genuinely on the client bill** — an amount Redwave *charges the client*
  when an agent hits a weekly target. Then the reduced Phase B below is still open.

These cannot both be true, and the difference is exactly what invariant **#3** exists to protect: the two
rate streams never mix, and no code path joins them. The original packet made the same point in its own
words — *"Rep-side incentives already have `target_type`/`target_count` — they are a different feature on
the other stream. Do not merge them, do not share a table 'to avoid duplication'."*

**Ask Redwave: is the weekly-target spiff something we CHARGE THE CLIENT, or something we PAY THE REP?**
If it is rep pay, this packet closes. If it is client billing, build Phase B.

## Phase B (only under reading (b)) — agent-target spiff, client stream

Reduced from the original: the `target_scope` / `target_team_id` fields are gone, since there is only the
agent form.

- Extend the `spiff` rate kind with `target_metric` (internet activations), `target_count`, and the
  evaluation window (the billing week).
- Evaluate in `statement.logic.ts` as a **pure function** over the week's sales; applied only when the
  target is met.
- The statement column header states the condition and window, the way the existing spiff column already
  freezes `spiff_from` / `spiff_to`.

### Invariants at risk
- **#3.** Client stream. It must not read or write `commission_*`. `billing.no-commission.spec.ts` is the
  enforcement and must stay green.
- **#5.** Counting activations for a target must not touch or re-derive the commission tier — a separate
  count, for a separate purpose, on a separate stream.
- **#2.** Once a statement is issued, the spiff decision is frozen with it.
- **#10.** Target config is effective-dated like every other rate row.

### Definition of done
- Target met → spiff applied to that week's qualifying lines; not met → absent, with the reason visible on
  preview.
- `grep -r "commission_" backend/src/modules/billing/` shows no new reference.
