# Meeting-3 Deltas (to reconcile into BRD v1.2 / SRS)

> **Status:** NOT yet in the BRD. The BRD reconciled Meetings 1 & 2 only. These are new
> inputs from Meeting 3 + a SAP Concur expense-UX reference video + the client's rate grid.
> Treat each item as a delta: it either (a) is already covered by the BRD/SRS, (b) refines an
> existing rule, or (c) is genuinely new. Reconcile accordingly — do not treat this as the spec.

**Sources:** Meeting-3 transcript · SAP Concur reference video (client's current expense app) · `Product_Commission_grid.xlsx`.

---

## 1. Products & commission rates (per-client)

Rate grid supplied by the client. Confirm with client whether these are **rep-pay** or **client-bill** rates before wiring the engine (sheet is titled "Commission" — likely rep-pay, but confirm), and confirm it's the latest.

- **VF (Valley Fiber, CAD):** Internet 150 / 500 / 940–1000 / 2500 → 350 each; Wireless → 380. Add-ons: HP 50, TV 50.
- **RF (RF Now, CAD):** Internet 150/300 → 280; 500/650 → 340; 1000/2500 → 365. Add-ons: HP 90, TV 100; **HP + TV together → +35**.
- **CTI (USD):** Internet → 250. Add-ons: HP 50, Protection Plan 50, Mesh Extender 50.
- **VF Business (CAD):** Internet 150 (Base) → 400. Add-ons: Speed attach 50, HP 60, TV 60.

Delta notes:
- **Per-client internet product/speed selection** on sale entry (select client → that client's internet product → rate auto-populates). *(Check against BRD/SRS — may already exist as Clients/Products; confirm the per-speed dropdown is specified.)*
- **Currency-aware rates** — CTI is USD, others CAD. Engine must not assume CAD.
- **VF Business** is a distinct client/product group (base internet 400).
- **RF Now $35 HP+TV bundle** — client wants it dropped from the system (handled manually). Confirm removal vs. keep.
- **RF Now base rates flagged as possibly wrong/too low** in the current data — verify against this grid.

## 2. Sales / product rules

- **Internet is the mandatory base product; TV & Home Phone (and Protection Plan, Mesh Extender, Speed attach) are add-ons.** Block standalone TV/HP. *(Likely already a BRD rule — confirm and ensure enforced.)*

## 3. Clawbacks

- **Search clawback candidates by customer name, address, and rep name** (not only Sale ID). Same address can have two reps; must identify which sale/rep. *(Refines existing clawback search.)*

## 4. Billing / statements

- **Split client statements into two separate documents per client: commission and expenses** (separate PDFs, attached separately when invoicing). *(Check whether BRD specifies a single combined statement — this refines it.)*

## 5. Expenses module — rework to SAP Concur-style workflow

This is the largest delta. The client's reference app defines the target UX.

**Report-as-folder model**
- A **weekly report** is a folder holding many expense line items; the **whole report is submitted** for approval as one unit (not line by line).
- Approval loop: approve, or **send back → rep fixes → resubmits**.
- Report list shows name, date, status (Not Submitted / Submitted), total, and alert flags; running reimbursable total.
- Report detail has Details / Expenses / Receipts tabs + a Submit action.

**Adding expenses**
- **Grouped, searchable expense-type picker** with a most-recently-used shortcut (Travel, Transportation, Meals, Office, etc.).
- **Per-type field sets** (fields differ by type):
  - *Mileage:* route, distance, from/to, date, comment.
  - *Meals:* amount, vendor name, city of purchase (recent-cities list), gratuity, attendees, receipt.
  - *Hotels/Flights/Parking/etc.:* their own fields.
- **Common fields:** currency, payment type, receipt status, **personal-expense (do-not-reimburse) toggle**, custom tags (client/channel — Redwave's equivalent of the reference app's Title/Program/Store-Department).

**Mileage specifics**
- **Google Maps**: address autocomplete (multiple candidates), multi-stop route builder, live distance, map display, "use route" → distance → auto-amount (distance × per-km rate).
- **Round-trip handling** (re-add origin as final stop, or a toggle).
- **AUTO-CALCULATED commute deduction** (the reference app only *warns*; Redwave wants it applied):
  - one-way **< 30 km → claim = 0**
  - one-way **> 30 km → billable = (distance − 30) per one-way leg** (round trip deducts 60 km total), then × per-km rate.
- **Per-km rate configurable per client** (client referenced ~45¢ rep / ~50¢ client; reference app used ~$0.42 — must be client-specific).

**Receipts & validation**
- Receipt upload mandatory (except mileage), kept for tax, **never shared with the client**.
- Two-level validation: hard stop ("fix errors before saving") + soft "save anyway?" that flags the item.
- **Alert vs. Warning** system (Alert = missing info; Warning = policy) that aggregates to the report header with a count.

**Outputs**
- **Rep report** (for pay run) — with dollar amounts.
- **Client report** (for invoicing) — mainly kilometers + food, **grouped by expense type**, itemized by date + amount per rep per day, with **dynamic selection** of which reps/days/clients to include; **auto-generated PDF**.
- *(Optional, flagged billable)* route map image in the client PDF.

## 6. Open questions (must resolve before coding the affected parts)

1. Are the rate-grid figures **rep-pay, client-bill, or both**? Is the grid the latest?
2. **CTI** scope confirmed (new client, USD)? Products/add-ons final?
3. Report period strictly **weekly**? How is the boundary defined?
4. Final **client expense report** contents/format (km + food, per rep/day, grouped, selectable)?
5. **Map image in PDF** — wanted (billable) or not?
6. Drop the **RF Now $35 bundle** — confirmed?

## 7. Non-functional reminders (already in CLAUDE.md / design system — do not re-invent)

- Mobile-first; design-system tokens only; every interactive element has all states; accessibility; CRUD patterns per CLAUDE.md §7.
- Exact-decimal money (Prisma.Decimal), immutable snapshots, separated rate streams, no clawback date math, sale_date governs period — per CLAUDE.md §3.
