# Commission Engine

The **pure, deterministic, isolated** commission calculator (`CommissionEngineService`). Given a
rep's activations for a period + the effective configuration (passed in as typed inputs), it returns
each item's rep rate, the commission total and, separately, incentives; plus a pure clawback-amount
calculation from a frozen snapshot.

**No tiers, no 70/30 split** (client decision 2026-11-13). Each item pays ONE flat rep rate and the
rep is paid in full. Redwave applies any tier or split manually, outside the system, from its exports.

**Rules it enforces** (CLAUDE §3 / §6, arch §8):

- **Exact-decimal money, never float** — `decimal.js` throughout (#1).
- **One rate per item, most specific wins** — (client + product) → (product) → (client + type) →
  (type). A missing rate throws (the caller surfaces a 422); a rep is never silently paid $0.
- **Greenfield pays the greenfield rate** — a greenfield internet sale skips the product steps, so the
  internet product's own rate never applies to it (#9).
- **Clawback is a flat, per-item recovery** — `rate + any incentive` from the snapshot; no date
  math, no effect on other items (#4, #6).
- **Incentives are separate from the rate** and paid in full. BOTH modes are applied,
  threshold-relative: `per_activation` (bonus beyond `targetCount`; null/0 = every activation) +
  `one_time` (a single bonus once the rep reaches `targetCount` matching activations, frozen onto the
  crossing one).

**Isolation:** imports only `decimal.js` + local files — no `@prisma/client`, no DB, no HTTP, no
other module. No constructor dependencies; tested by direct instantiation.

See `commission-engine.service.spec.ts` for the worked-example fixtures (the acceptance bar).
