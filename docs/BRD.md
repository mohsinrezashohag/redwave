# Redwave ERP / HRM — Business Requirements Document (v1.2)

> Repo reference copy generated from the approved BRD v1.2 .docx. The Word version is the client-facing deliverable; this markdown is for in-repo use by the dev tooling.

**Prepared by:** Fathom (Development Partner)

**Client:** Redwave Marketing Inc.

**Version:** 1.2 — Consolidated (supersedes all prior notes, proposal, and Schedule C v1)

**Status: Baseline — approved for build**

**Sources reconciled:** Meeting 1 & 2 transcripts, project proposal, Schedule C v2, contractor pay schedule, KM policy, expense form, VF/RF billing files, and the master commission workbook.

> **How to read this document**
> This BRD is the single source of truth. Where it conflicts with any earlier artifact (the proposal, Schedule C v1, or Meeting 1 notes), **this document wins**. Several rules were deliberately reversed or simplified after Meeting 2 and the revised Schedule C v2; those are flagged inline. This is a clean-slate build — nothing is reused from any prior system.

## 1. Introduction & Purpose

### 1.1 Document Purpose

This Business Requirements Document defines the complete functional and non-functional requirements for the Redwave ERP/HRM platform. It consolidates every decision reached across two client meetings and reconciles them against all source materials supplied by Redwave Marketing Inc. Its goal is to give the development team an unambiguous, build-ready specification and to give the client a clear record of what will be delivered.

### 1.2 Business Context

Redwave Marketing Inc. is a telecom sales agency operating in Manitoba (Canada) and select US markets. Independent field sales representatives (“reps” / “distributors”) sell internet, TV, and home-phone services on behalf of program partners (“clients”): Valley Fiber (VF), RF Now (RF), CTI, and VF Business. Redwave bills the clients for accepted activations and pays reps a tiered, commission-only compensation. Today this entire pipeline — sales capture, validation, commission calculation, the 70/30 holdback, clawbacks, expense reimbursement, client invoicing, and payroll — is run manually through Excel workbooks and WhatsApp. The objective of this project is to automate that pipeline end-to-end while keeping every business rule configurable by Redwave administrators.

### 1.3 Project Objectives

- **Eliminate manual calculation.** Replace the Excel-and-WhatsApp workflow with a single system that captures sales, calculates commissions, processes the 70/30 holdback and clawbacks, and produces payroll and client statements automatically.

- **Configurable by Super Admin.** Every business value — tier thresholds, rates, holdback %, incentives, expense rates, products, clients — must be editable from an admin panel with an effective date, never hard-coded.

- **Modular and role-driven.** The system is built as independent modules. Super Admins assign module access per role, so each user sees only what their role permits.

- **Future-proof and scalable.** Architected to support growth in users and data volume, a future mobile app, additional clients/products, and a Phase-3 business (B2B) sales line — with upgrades to one module not affecting others.

- **Built new, from the ground up.** This is a clean-slate build. No code, schema, or frontend from any prior system is reused; the platform is designed fresh against this specification. References to a “previous developer” or “legacy data” in this document describe historical problems to avoid, not assets to inherit.

### 1.4 Scope

In Scope (Phase 2)

- Rep / distributor HRM profiles, documents, equipment assignment, and field-manager assignment.

- Admin-managed client and per-client product catalogues with effective-dated rates.

- Sales entry, manager validation, and the unique Sale ID system.

- Tiered commission engine (Schedule C v2), incentives/spiffs, and the 70/30 holdback.

- Clawback processing (dollar-for-dollar, manual entry, no in-system date math).

- Bi-weekly pay run with ADP-ready export.

- Expense module (kilometres, meals, hotel, flight, rental, gas, other) with approval workflow and export.

- Client statement (Excel) and one-line commission invoice (PDF) generation.

- Commission ledger, rep statements, dashboards, and a competitiveness leaderboard / target tracker.

- Role-based access control with custom role creation; system notifications.

- Integrated AI chatbot (Gemini-powered, grounded on Redwave data).

Out of Scope (this phase)

- Customer-facing portal or self-service sign-up.

- Direct API integration into client CRMs (data arrives as Excel/CSV).

- Automated GST/PST calculation on invoices (handled in QuickBooks).

- Automated email notifications for rate changes (system notification only, by deliberate choice).

- B2B / business sales module (reserved for a later phase). **Note:** *"VF Business"* is a distinct **program partner / client** (with its own product catalogue and billing rates) and is **in scope now** — it is not the deferred B2B sales line.

## 2. Users, Roles & Access Control

Access is role-based and modular. The Super Admin can create custom roles and grant each role access to specific modules and actions. The roles below are the baseline; the model must allow new roles without code changes.

| **Role**                | **Description**                                                     | **Baseline Access**                                                                                                                                                                       |
|-------------------------|---------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Super Admin             | Business partners (Naimur, Imran, Rubel).                           | Full access to every module, all financial analytics, rate/tier configuration, pay-run execution, and role creation. Only role that can edit records after approval.                      |
| Admin                   | Administrative & Operations Coordinator (e.g. CM) and senior staff. | Most operational modules: sales validation, expense approval, ledger, statements. Can edit expenses before approval. Cannot see partner-level company financials unless granted.          |
| Manager (Field Manager) | Mid-level managers; every rep is assigned one.                      | Validate/edit sales and expenses for their reps before approval; send items back for correction; view rep-level data.                                                                     |
| Sales Rep / Distributor | Field agents.                                                       | Enter own sales (incl. greenfield flag request), submit own expenses, view own commission statement and the leaderboard. No access to rates, other reps’ earnings, or company financials. |
| Custom roles            | Defined by Super Admin (e.g. Accountant, General Manager).          | Granular module/action access selected at creation time.                                                                                                                                  |

> **Confirmed in Meeting 2**
> Every rep has an assigned **Field Manager**. Managers, Admins, and Super Admin can edit expenses **before** approval. **After approval, only the Super Admin can change anything.** Commission amounts are never manually editable. All staff (including partners and Admins) can also submit their own expenses, since they occasionally make field sales and incur costs.

## 3. Core Data Model & Key Entities

The data model is the foundation of the system. It is designed so that business rules live in configuration tables (not code), every financial figure is reconstructable from immutable records, and modules connect through stable keys. The entities below are described functionally; the physical schema is the development team’s responsibility but must preserve these relationships and rules.

### 3.1 Entity Overview

| **Entity**                 | **Purpose**                                  | **Key Relationships**                                                                            |
|----------------------------|----------------------------------------------|--------------------------------------------------------------------------------------------------|
| Rep / Distributor          | A field salesperson and their HR record.     | 1 Rep → many Sales, Expenses, Pay-Run Lines, Equipment, Documents. Has 1 Field Manager (a User). |
| User & Role                | Any system login; role drives module access. | 1 Role → many Users; Role ↔ Modules (many-to-many permissions).                                  |
| Client (Program Partner)   | VF, RF, CTI, VF Business, and future partners. | 1 Client → many Products; 1 Client → many Sales; has its own billing **currency** (admin-managed); carries optional SA-defined custom fields. |
| Product Type (catalogue)   | Configurable product types + commission behaviour (tiered/greenfield/standard add-on). | The SA adds types at runtime (always standard add-on); core types are locked.                     |
| Product                    | An admin-created, per-client sellable item.  | Belongs to 1 Client; has a product type from the catalogue; referenced by Sales; has effective-dated client + rep rates. |
| Sale                       | One customer/household activation.           | Belongs to Rep + Client + Product(s); has 1 unique Sale ID; spawns 0..1 Clawback.                |
| Rate Card / Tier Config    | Effective-dated commission rules.            | Referenced by the commission engine at period close.                                             |
| Incentive / Spiff          | Admin-defined, time-boxed bonus.             | Applied to qualifying Sales; recorded per Sale.                                                  |
| Pay Run                    | A bi-weekly payroll cycle.                   | 1 Pay Run → many Pay-Run Lines (one per rep).                                                    |
| Holdback Ledger            | Tracks each 30% hold and its release.        | Belongs to Rep + originating Pay Period; released into a later Pay Run.                          |
| Clawback                   | A cancellation recovery.                     | References the original Sale; applied against a Pay-Run Line.                                    |
| Expense Item               | A single expense (item-first; the atomic unit). | Belongs to a submitter/Rep; carries its own status + pay period (by its date); flows into a Pay Run. |
| Client Statement / Invoice | Billing output per client per period.        | Aggregates Sales for one Client + period.                                                        |

### 3.2 The Sale Entity & Unique Sale ID

**The Sale is the atomic financial unit.** Each sale is one customer/household activation and carries a complete, immutable snapshot of how it was paid, so that a clawback months later can recover the exact amount without recalculating anything.

**Sale ID composition (confirmed Meeting 2):** Sale Date + MPU ID (where the program partner provides one) + Client Name. A duplicate address on the same MPU ID receives a ‑ 1 / ‑ 2 suffix.

> **Why this matters**
> Only the US program (CTI) supplies an **MPU ID** per house. RF Now supplies no ID and sends manual, irregular Excel files; VF sits in between. The composite Sale ID gives every sale a stable unique key regardless of client, and the date component cleanly handles the common “customer moves out, new customer at the same address” scenario — duplicate addresses are valid and must never be blocked.

Sale — stored fields

| **Field**                           | **Type**                        | **Notes**                                                                                                                                                                                              |
|-------------------------------------|---------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| sale_id                             | string (PK)                     | Composite, generated as above. Globally unique and stable.                                                                                                                                             |
| sale_date                           | date                            | The date the rep made the sale. Drives which pay period the sale belongs to — NOT the validation date.                                                                                                 |
| activation_date                     | date (nullable, reference only) | When the program partner installed/activated the service. Stored for reference and manual matching against client reports. NO system logic depends on it — it drives no calculation, window, or tally. |
| rep_id                              | FK → Rep                        | The crediting rep. Rep codes are never reused, so this is a stable key.                                                                                                                                |
| client_id                           | FK → Client                     | Selected from a dropdown (no free text), eliminating the VF/Vf case-inconsistency seen in legacy data.                                                                                                 |
| products                            | list → Product                  | One or more products on the single sale (Internet / TV / Home Phone / Greenfield, per client).                                                                                                         |
| customer_name, address              | string                          | Address stored as structured components where possible; duplicates permitted.                                                                                                                          |
| mpu_id                              | string (nullable)               | Client order/house ID where available; used for clawback matching and Sale ID.                                                                                                                         |
| is_greenfield                       | bool                            | Requested by rep at entry, confirmed by admin at validation (see §5).                                                                                                                                  |
| status                              | enum                            | Entered → Validated → In Pay Run → Paid → (Clawed Back). Unvalidated/invalid sales can be deleted before payout.                                                                                       |
| tier_at_payment                     | int (snapshot)                  | The tier that governed this sale when paid — frozen for clawback accuracy.                                                                                                                             |
| commission_paid                     | decimal (snapshot)              | Exact dollar amount paid for this sale (internet tier rate + flat add-ons + incentive).                                                                                                                |
| incentive_applied, incentive_amount | bool / decimal                  | Whether a spiff applied and how much — frozen so clawback can recover it too.                                                                                                                          |

> **Confirmed in Meeting 2**
> Redwave’s database design already anticipates this: **every sale has a unique Sale ID and a per-sale record holding its tier, any incentive and amount, and the total paid** — which is exactly what the clawback engine reads from to deduct the correct figure later.

## 4. Commission Engine (Schedule C v2)

> **This section reflects Schedule C v2 and reverses earlier rules**
> **Three things changed from Schedule C v1:** (1) tier numbering is inverted — Tier 1 is now the highest; (2) tiers are calculated on the GROSS activation count, not net; (3) the “tier cascade” clawback is removed — a cancellation never re-tiers a period.

> **The per-client rate grid is client-BILLING data, not rep pay (Meeting 3).** The `Product_Commission_grid.xlsx` figures (e.g. VF internet $350, RF $280–365, CTI $250, VF Business $400, and per-client add-on rates) are **what Redwave charges each client** — they live in `client_billing_rates`, per client × product, and are entered by the admin. **Rep commission is unchanged: the cross-client tiered Schedule C v2 below.** The two streams never mix (§8.2 / #3). Add-on rep commission is an admin-set flat rate that may be **zero (bill-only)**.

### 4.1 Internet Commission — Tiered (per Pay Period)

Internet commission is tiered on the rep’s gross Internet Activations Tally for the pay period. The highest tier reached governs every internet activation in that period (retroactive within the period). The tier is fixed at period close.

| **Tier**         | **Internet Activations Tally (per pay period)** | **Commission per Internet Activation** |
|------------------|-------------------------------------------------|----------------------------------------|
| Tier 4 (entry)   | 0 – 6                                           | $110                                  |
| Tier 3           | 7 – 16                                          | $125                                  |
| Tier 2           | 17 – 35                                         | $145                                  |
| Tier 1 (highest) | 36 +                                            | $160                                  |

**Tally basis:** the tally is the GROSS count of internet activations submitted in the period. Greenfield internet activations do NOT count toward the tally. Cancellations occurring after the period closes do NOT reduce the tally or change the earned tier.

### 4.2 Flat-Rate Products

| **Product**                                           | **Commission per Valid Activation (flat)** |
|-------------------------------------------------------|--------------------------------------------|
| Greenfield Internet (not tiered, excluded from tally) | $100                                      |
| TV                                                    | $30                                       |
| Home Phone                                            | $30                                       |

> **Cross-client aggregation**
> A rep’s tally aggregates internet activations across **all clients** in the period. If a rep sells 3 internet for VF and 9 for RF, the tally is 12 → Tier 3 → every one of those 12 pays $125. Per-client tallies would underpay reps and must not be used.

### 4.3 Incentives / Spiffs

- **Custom-set by Super Admin.** An incentive is an optional, time-boxed bonus the Super Admin configures — e.g. $20 extra per internet activation, or a target such as “5 sales in one day” over a chosen date range, scoped to a program/product.

- **Recorded per sale.** When an incentive applies, its amount is frozen on the Sale record.

- **Clawed back with the sale.** If a sale with a $20 incentive cancels, the clawback recovers $145 + $20 = $165 — the exact total paid for that sale.

### 4.4 Worked Example (from Schedule C v2)

| **Pay-Period Activity**                | **Amount**  |
|----------------------------------------|-------------|
| Internet activations submitted (gross) | 20          |
| Tally → applicable tier                | 20 → Tier 2 |
| Tier 2 rate per internet activation    | $145       |
| Gross internet commission (20 × $145) | $2,900     |
| TV activations (4 × $30)              | $120       |
| Home Phone activations (3 × $30)      | $90        |
| Greenfield internet (2 × $100)        | $200       |
| **Gross commission earned**            | **$3,310** |

### 4.5 Configurability

Every value in this section — tier thresholds, per-tier rates, greenfield/TV/home-phone flat rates, and incentive definitions — must be editable by the Super Admin with an effective date. Changes apply prospectively only and never alter a closed pay period.

## 5. Sales Entry & Validation Workflow

**Workflow:** Rep enters sale → status Entered → Field Manager / Admin validates (within 1–2 days, by Monday night / Tuesday) → status Validated → included in the pay run for the sale-date’s period. Validation is a middle approval layer that lets fake or ineligible sales be removed before payout.

> **Confirmed: sale date governs the period**
> **A sale belongs to the pay period of its sale date, not its validation date.** Saturday/Sunday sales validated the following Monday/Tuesday still count in the sale-date period. Validation never moves a sale into a different pay period.

### 5.1 Greenfield Flag (two-step, confirmed)

1. The rep clicks the greenfield flag when entering the sale.
2. The admin verifies and confirms it during validation.

The $100 greenfield rate and exclusion from the internet tally apply only once an admin has **confirmed** the flag. A rep-requested but unconfirmed flag does not change the calculation.

### 5.2 Sales Entry Fields

- Rep identity — auto-populated from the logged-in account.

- Client — dropdown (VF / RF / CTI / future), no free text.

- Product(s) — populated from the selected client’s admin-created catalogue; one or more per sale. **Internet is the mandatory base product of a sale**; TV, Home Phone, Protection Plan, Mesh Extender and Speed-attach are **add-ons that cannot be sold standalone** (enforced client- and server-side). Whether an add-on pays rep commission is an admin-set flat rate — including **zero (bill-only)**.

- Customer name and address — duplicates permitted.

- MPU ID — where the program provides one; reps may be asked to input it.

- Sale date — defaults to today, editable to the actual sale date.

- Greenfield request — checkbox (confirmed by admin at validation).

### 5.3 Bulk Validation

With 200–300 sales per period, validation supports bulk operations. Where a client supplies a report (Excel/CSV), the system can match on MPU ID and auto-validate, surfacing only mismatches (often rep typos) for manual matching by an Admin or Manager.

## 6. Pay Run, Holdback & Clawback

### 6.1 Pay Cycle

- Bi-weekly. Pay periods run Sunday–Saturday; payday is the Friday roughly 13 days after period close.

- All pay-period/payday pairs are pre-loaded from the 2026 contractor pay schedule — admins select a cycle to run, they do not create cycles manually.

- If a payday falls on a bank holiday, payment issues the next business day.

### 6.2 70% Advance / 30% Holdback

- **70% advance** of the calculated commission is paid on the payday for the period.

- **30% holdback** of each period’s commission is withheld and released in a later pay cycle.

- **Super Admin controls the release cycle (bulk, sticky).** The Super Admin sets which pay cycle a period’s 30% holdback releases into. The setting is applied in bulk (not per individual hold) and persists as the standing rule until the Super Admin changes it. The system may default to the next eligible cycle, but the Super Admin’s choice governs.

- **Holdback Ledger.** Each hold is a tracked record (rep, originating period, amount, scheduled release cycle, release status, amount released, clawback applied). Releases reference the specific originating period.

> **Important nuance from Schedule C v2**
> The day-30 release is a **cash-flow convenience** and does NOT mean the commission is fully earned — contractually it remains at risk through a 60-day window. **However, the SYSTEM does not implement any 30/60-day date math (see 6.3).**

### 6.3 Clawback — System Logic (the key simplification)

> **Confirmed in Meeting 2 — read carefully**
> **The system does NOT calculate or enforce the 30-day or 60-day clawback windows.** Redwave’s contractual clawback window is measured from the sale date, but the client tracks cancellation dates and reports them (often well after the window). Redwave simply inputs a clawback when a cancellation report arrives. The system records and processes it — no elapsed-time logic, no date math.

- **Dollar-for-dollar.** A clawback recovers the exact amount originally paid for that sale (tier rate at payment + any flat add-ons + any incentive), read from the Sale’s frozen snapshot. The period is never re-tiered.

- **Not yet paid? Delete it.** If a sale is found invalid before payout (e.g. a fast cancellation, likely a fake or ineligible sale), it is removed/deleted and never enters the pay run — no clawback record needed.

- **Flat deduction from the rep’s pay-run total.** A clawback is simply subtracted from the total amount the rep would receive in the next available pay run. There is no 70%/30% sequencing — because the Super Admin manages holdback release timing in line with normal business, the buffer logic is unnecessary. Per Schedule C v2, already-released 30% remains recoverable; in practice the clawback just reduces the rep’s net total.

- **Affects incentives.** Any incentive paid on the cancelled sale is clawed back with it.

- **Current-cycle cancellations.** If a sale is cancelled while its own pay cycle is still open, it is removed and therefore does NOT count toward that period’s tally (the tally is finalized only at period close). Once a period has closed and paid, a later cancellation is a dollar-for-dollar clawback that does not re-tier.

### 6.4 Pay-Run Output

Per rep per cycle the pay run produces: 70% advance for the period, any 30% holdback released from a prior period (per the Super Admin’s release setting), approved expenses, incentives/bonuses, clawback deductions (a flat subtraction from the total), and the net payout. Bonuses are custom Super-Admin entries with a note. The run generates an ADP-ready export.

> **Open / design item**
> ADP has **no fixed format requirement** — Fathom will design the export schema. Treat it as a configurable export module so fields can be adjusted without a rebuild.

## 7. Expense Module

> **Reversed in Meeting 3 — report-as-folder model (supersedes the earlier item-first / "list, not folders" decision).** Expenses are now captured in a **weekly report** (the business week) — a folder that holds many expense line items and is **submitted as one unit** for approval. Approval is per report: an approver **approves the whole report**, or **sends it back → the rep fixes → resubmits**. A report list shows name / date / status (Not Submitted / Submitted / Approved) / total / an **alert count**, plus a running reimbursable total. Report detail has **Details / Expenses / Receipts** tabs and a **Submit** action. Each approved report's items still follow the pay cycle of the period **their own expense date falls in** (same-cycle payout). (This reverses the v1.2 item-first rule; `expense_reports` becomes the live submission entity.)

### 7.1 Expense Categories (confirmed)

| **Category** | **Rules**                                                                                                                                                                                                                                              |
|--------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Kilometres   | From / To with multi-stop (Google Maps Places autocomplete + “add stop”). ONE km log per day per rep. Rep selects Single Trip (‒30 km) or Round Trip (‒60 km). Billable distance × the km rate, computed server-side. The km rate is **per-client and effective-dated** (default $0.45) and is **two-stream** — a rep-reimbursement rate (CAD) and a separate client-bill rate, never combined (§8.2 / #3). With a Maps key the route distance is derived automatically from the stops; otherwise the rep enters it manually. Origin is an open input, not a hardcoded office. Receipt NOT required. |
| Meals        | Lunch $15, Dinner $30 (admin-configurable; may be lowered). Amount entered manually + place name. Receipt mandatory.                                                                                                                                 |
| Hotel        | Name, location, date, amount. Receipt mandatory.                                                                                                                                                                                                       |
| Flight       | Description, date, amount. Receipt mandatory.                                                                                                                                                                                                          |
| Rental       | Vehicle rental cost. Receipt mandatory.                                                                                                                                                                                                                |
| Gas Money    | For reps given a rental car (paid by receipt instead of km). Receipt mandatory.                                                                                                                                                                        |
| Other        | Blank custom field: description, date, amount, receipt (e.g. event costs). Receipt mandatory.                                                                                                                                                          |

> **Confirmed in Meeting 2**
> **Receipts are mandatory for every category except the kilometre log.** The Super Admin can add new expense fields that then appear in the rep dropdown. Meal eligibility (“road trips only”) is handled manually by the validating manager, not enforced by the system — Redwave deliberately keeps these judgement calls manual rather than over-automating.

> **Added in Meeting 3 (SAP-Concur-style workflow)**
> - **Grouped, searchable expense-type picker** (with a most-recently-used shortcut) and **per-type field sets** — each type shows its own fields (e.g. Meals: amount, vendor, city, gratuity, attendees; Hotel/Flight/Parking: their own).
> - **Personal / do-not-reimburse toggle** — an item flagged personal is **excluded** from the reimbursable total, the pay run, and any client-facing output.
> - **Custom tags** — client/program and **channel** (Redwave's equivalent of the reference app's Title/Program/Store-Department).
> - **Alert vs Warning validation** — a hard stop ("fix before saving") plus a soft "save anyway?" that flags the item; alerts/warnings **aggregate to the report header with a count**.
> - **Receipts are retained for tax and are NEVER included in client-facing output.**

### 7.2 Submission, Approval & Visibility

- All users (reps, managers, admins, partners) can add their own expense items — one or several at a time; receipts upload to cloud storage and are stored as access-controlled digital copies.

- Submitted items go to a Pending Approval queue for the Field Manager / Admin. Approval is **per item, with bulk select** to act on many at once (approve / reject / send back).

- Manager/Admin can edit an item before approval and can send it back for correction. After approval, only the Super Admin can change it; a not-yet-approved item can be deleted.

- **List view, not folders.** Expenses display as a filterable, paginated list of items — default filter is the current pay cycle — filterable by Date range, Rep, Client, Category, and Status, and **groupable daily/weekly/monthly/custom**.

- **Export.** Exportable to Excel/PDF/CSV — per-item rows or grouped period totals: per-rep KM logs for client submission (KM only where that is all the client needs), and select-all for internal accounting/bookkeeping; each server-recorded export is stored.

## 8. Client Billing & Statements

### 8.1 What the System Generates

- **Statement (primary).** Recreate the Excel statement Redwave currently sends each client: one line per customer/household showing all products on that single line with the dollar total.

- **Commission invoice (secondary).** An optional one-line PDF invoice showing only the total commission amount for the client.

- **Client expense billing document (added Meeting 3).** A **separate**, gapless-numbered PDF per client — **kilometres + food, grouped by type, itemized per rep per day**, with **dynamic selection** of which reps / days / clients to include, rendered in the **client's currency**. It is generated and attached **separately** from the commission statement when invoicing. It contains **no receipts and no commission data** (§8.2 / #3). (An optional route-map image is deferred / out of scope for now.)

> **Confirmed in Meeting 2**
> **One line per customer — not one line per product.** A customer with Internet + TV + Home Phone is a single row with the combined total. This fixes a known defect in the current export, where three products produced three lines. **Remove the GST/PST portion entirely** — tax is handled in QuickBooks and varies, so it must not be hard-coded into the statement or invoice.

### 8.2 Rates & Separation of Streams

> **Architectural rule — do not violate**
> **Client billing rates and rep commission rates are two completely separate calculation streams.** Mixing these two streams was the core defect of Redwave’s earlier system and is the single most important mistake to avoid in this clean-slate build. They live in separate configuration tables, are edited independently, and are never combined. (E.g. a VF internet activation may bill the client at one rate while paying the rep a tier rate — unrelated numbers.)

Each client has its own product catalogue and its own billing rates, created and maintained by the admin. **Bundles are admin-created and fully configurable** (the RF Now $35 HP+TV bundle is just one configured bundle via the `bundle_bonus` rate kind — there is no hard-coded/special-cased bundle logic). Billing rates are per client and are held in the **client's currency** (§8.3).

### 8.3 Numbering, Immutability, Reconciliation & Export (confirmed)

- **Gapless sequential numbering (accounting requirement).** Statements and invoices receive gapless, sequential numbers (`STMT-00001` / `INV-00001`), one sequence per document type across all clients (the issuer-side register). Numbers are minted atomically when a document is **issued** (not on preview), so they never gap even under concurrent generation.
- **Immutable once issued.** An issued statement/invoice is never edited. A correction produces a **new numbered document**; the prior one is marked *superseded* and retained unchanged (preserves the audit trail + gapless integrity).
- **Preview before issue.** The user previews the one-line-per-customer rows (combined total, no tax) before generating; generating then issues and renders the Excel.
- **Reconciliation / tie-out (integrity safety net).** Finance can verify: each statement total = the sum of its customer lines = the sum of the underlying sales’ billing amounts; each pay-run total = the sum of its lines. Discrepancies are flagged clearly (e.g. a statement that has gone stale because sales changed after issue).
- **QuickBooks-friendly export.** Because tax lives in QuickBooks, statements/invoices export as a CSV that maps cleanly into QuickBooks (no tax column), stored as a recorded artifact.
- **Multi-currency with a frozen FX snapshot (reversed in Meeting 3; supersedes the earlier CAD-only rule).** Amounts are incurred/billed in any currency (**USD + CAD** primary; the currency set is admin-configurable and extensible — never hard-coded). Each client has its own **billing currency** (e.g. CTI = USD, others = CAD). **Final reconciliation is in CAD.** When a non-CAD amount is converted, the system captures that day's **FX rate** and stores `{original amount, original currency, FX rate, rate date, converted CAD amount}`; the **rate + CAD value are frozen/immutable** (like every other snapshot — #2) and are **never re-converted**. Roll-ups and reconciliation read the stored CAD; the original currency + rate are retained for audit. **Capture moments:** client-bill FX freezes at **document issue** (statement/invoice/expense-doc — never on preview; a correction re-issues a new numbered doc with a fresh rate); rep-expense FX freezes at **approval**. The `fx_rate` is stored at high precision; the resulting `amount_cad` is rounded to **2 dp, half-up** (the central house rule, unchanged). **Rep pay (commission, pay run, holdback, clawback) is CAD-only.**

## 9. Dashboards, Leaderboard & Notifications

### 9.1 Rep Dashboard & Leaderboard

- Personal view: own sales counts by product, current tier, estimated commission, own statement.

- **Competitiveness leaderboard / target tracker (confirmed good-to-have).** Ranks reps by internet sales volume for the period and supports target-vs-actual tracking to drive competition — bringing the current WhatsApp motivation workflow into the system. Reps see counts, never other reps’ earnings.

### 9.2 Admin / Partner Analytics

- Company revenue (client billings), total rep payout, net margin ($ and %), by client / rep / product / period.

- A full period KPI set: holdback liability (held / scheduled / released), clawback total + rate, expenses
  (KM vs other), activation volumes (by product, by client, greenfield), the validation funnel, the rep tier
  distribution, client mix, and period-over-period growth — plus **cross-period trend charts** (revenue/payout/
  margin, activations by product, revenue by client, tier distribution over time).

- All figures are READ from the frozen ledger (commissions are never recomputed). Kept separate from the rep
  leaderboard and gated to Super Admin (`reports:business`) / permitted roles.

- **Sales targets** (per rep per period) drive the rep "target progress" widget and the manager
  "target-vs-actual"; a manager sees roster aggregates always but per-rep earnings only with `hrm:edit`.

### 9.3 Notifications

- **System notifications only — no automated emails for rate changes.** This is a deliberate choice to minimise digital trace and retain control of wording; rate-change communication is done manually (PDF + WhatsApp).

- **Lean and batched.** No per-sale email spam. Notifications cover actionable events (e.g. expense awaiting approval, statement ready).

- **Super-Admin-managed event catalogue.** Every actionable event (sale validated, expense submitted/approved/rejected/sent-back, signature requested/signed/declined, document completed, pay run finalized, holdback released, clawback applied, profile change requested/decided, statement ready, rate change, import committed) is a catalogue entry the Super Admin manages. Per event the Super Admin can: enable/disable it, choose the channel (in-app and/or email), and edit the **title and body templates** (with documented `{variable}` placeholders; a blank template falls back to the built-in wording). **Recipients are intrinsic to each event** (e.g. a sale's notification goes to that sale's rep) and are shown read-only — they are not freely re-targeted, so an automatic event is never silently redirected. Adding a genuinely **new** automatic trigger still requires a code change (a new emit call); the Super Admin manages the catalogue, not the trigger logic.

- **Manual broadcast.** The Super Admin can also compose a one-off **broadcast** (title + body) to a chosen audience — everyone, a role, or specific users — fanned out as in-app notifications (and email where the broadcast channel is on). This is the only path that targets recipients freely; it is gated by a dedicated `notifications:broadcast` permission (Super Admin only).

- **Notification Center + unread badge.** Users have a full Notification Center (read/unread, mark-all, bulk actions, filter, search) and a live unread-count badge on the bell that refreshes on a poll interval and on window focus. Clicking a notification opens the related record and marks it read.

### 9.4 Rate-Change Mechanism

Rate/tier/threshold changes are entered by the Super Admin with an effective date that is **selected as a pay period**, not a free calendar date: the admin picks the pay period the change takes effect in (`Period N · start–end`) and the system stores that period's boundary date (the start date for *effective from*, the end date for *effective to*). This keeps every rate window aligned to pay-period boundaries and avoids mid-period changes. The effective date must be today's period or later — **back-dating is rejected** (closed/in-progress periods are never altered). A later change supersedes/overwrites a pending one (e.g. if partners reverse a decision before it takes effect). The 14-day notice required by Schedule C is handled by Redwave manually outside the system.

### 9.5 AI Chatbot (Integrated)

The platform includes an AI assistant chatbot. Per Meeting 2, this is **integrated rather than built from scratch** — it is powered by Google Gemini (or whichever provider is most cost-effective) and trained/grounded on Redwave’s own data. Fathom integrates it into the system; Redwave does not need a bespoke model.

- Grounded on Redwave’s data so it can answer operational questions in context.

- Access governed by the same role-based permissions as the rest of the platform.

- Provider is configurable so Redwave can switch to the most cost-effective option over time.

## 10. Non-Functional Requirements & Architecture Principles

| **Principle**        | **Requirement**                                                                                                                                                                                                                                                        |
|----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Configurability      | All business values (tiers, rates, holdback %, incentives, expense rates, products, clients, roles) are stored in effective-dated configuration — never hard-coded. Admin changes never need a code deploy.                                                            |
| Modularity           | Independent modules (Sales, Commission, Pay Run, Expense, Billing, HRM, Reporting, Admin/Config). Upgrading or replacing one module must not break others. Roles grant access per module.                                                                              |
| Scalability          | Must handle hundreds of sales per cycle and growth in users, clients, and data volume without redesign. Designed for a future mobile app sharing the same backend/API.                                                                                                 |
| Data integrity       | Commission figures must be exact — underpaying a rep is unacceptable. Every paid figure is reconstructable from immutable Sale snapshots. Rep codes are never reused, so they remain stable keys.                                                                      |
| Auditability         | Sales, validations, rate changes, approvals, pay runs, and clawbacks are logged with timestamp and acting user. Edits after approval are restricted to Super Admin and logged.                                                                                         |
| Effective-date logic | Rate/product/tier changes are prospective only and never rewrite closed periods or historical data.                                                                                                                                                                    |
| Security & privacy   | Banking details, IDs, and earnings are sensitive; access is role-based and enforced server-side. NDA in force.                                                                                                                                                         |
| Maintainability      | Code is thoroughly commented so any future developer can pick up a module. Clear module boundaries and documented APIs.                                                                                                                                                |
| Reliability          | Payroll must be correct and tested; 1–2 cycles run in parallel with the manual process before full cutover.                                                                                                                                                            |
| Delivery approach    | Clean-slate build. The data model is designed first, then a versioned API contract is defined as the seam between backend and frontend (and the future mobile app), then modules are implemented against that contract. Nothing is carried over from any prior system. |

## 11. Decisions Log & Reconciliation

This log records decisions that reversed or materially refined earlier artifacts, so no team member builds from a stale source.

| **Topic**               | **Earlier position**                        | **Final decision (this BRD)**                                |
|-------------------------|---------------------------------------------|--------------------------------------------------------------|
| Tier numbering          | Tier 1 lowest (v1)                          | Tier 1 highest; Tier 4 entry (v2)                            |
| Tier thresholds         | 0–6 / 7–15 / 16–24 / 25+                    | 0–6 / 7–16 / 17–35 / 36+                                     |
| Tier basis              | Net activations                             | Gross tally; cancellations never re-tier                     |
| Tier-cascade clawback   | One cancel re-tiers period                  | Removed entirely; dollar-for-dollar only                     |
| Clawback date math      | 30/60-day windows in system                 | Not in system; client tracks dates, Redwave inputs clawbacks |
| Activation vs Sale Date | Activation Date drives logic                | Sale Date drives everything                                  |
| Clawback deduction      | 30% first (proposal), then 70%-first (v1.1) | Flat deduction from rep’s pay-run total; no sequencing       |
| 30% release timing      | Fixed ~day-31 + payroll lag                 | Super Admin sets release cycle (bulk, sticky)                |
| Home Phone rate         | $15 (v1) / $40–$50 (legacy)              | $30 (v2)                                                    |
| Greenfield rate         | $90                                        | $100                                                        |
| Greenfield flagging     | Disputed (rep vs admin)                     | Rep requests, admin confirms                                 |
| GST on invoice          | Included                                    | Removed (handled in QuickBooks)                              |
| Rate-change email       | Automated email                             | System notification only; manual comms                       |
| Products                | Fixed catalogue                             | Admin-created per client                                     |
| Rep code reuse          | Ambiguous in legacy data                    | Never reused going forward                                   |
| Expense capture (M3)    | Item-first list, "not folders" (v1.2)       | Weekly **report-as-folder**, submitted as one unit           |
| Currency (M3)           | Single-currency CAD (v1.2)                  | **Per-client currency + frozen FX snapshot**, reconciled in CAD |
| Clients (M3)            | VF, RF, CTI                                 | + **VF Business** (4th program partner, in scope)            |
| Commission grid (M3)    | (ambiguous "Commission" sheet)              | Confirmed **client-billing** data; Schedule C rep pay unchanged |

### 11.1 Remaining Items to Finalise

- **ADP export schema** — no external constraint; Fathom to design (build as configurable export).

- **CTI product specifics** — resolved in principle by admin-created per-client products; confirm CTI’s catalogue (no TV, home-phone rate) when configuring.

- **Target dashboard depth** — confirmed as a good-to-have for competitiveness; scope the metrics during build.

*End of Business Requirements Document v1.2*
