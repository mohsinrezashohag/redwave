# Redwave ERP / HRM — Software Requirements Specification (v1.0)

> Repo reference copy generated from the approved SRS v1.0 .docx. The Word version is the client-facing deliverable; this markdown is for in-repo use by the dev tooling. Requirement IDs (<MODULE>-NNN) and MoSCoW priorities are preserved exactly.

**Prepared by:** Fathom (Development Partner)

**Client:** Redwave Marketing Inc.

**Version:** 1.0 — aligned to BRD v1.2 and Data Model v1.0

**Phase:** Architecture & Design — Software Requirements Specification

**Companion artifacts:** Redwave_BRD_v1.2.docx, Redwave_Data_Model.drawio, Redwave_Data_Model.docx

> **Requirement identifiers & priority**
> Requirements are numbered **<MODULE>-NNN** (e.g. SALE-004) so they are individually traceable and testable. Priority uses MoSCoW: **M** = Must (core, build-blocking), **S** = Should (important, not blocking), **C** = Could (desirable). Worked examples are written as acceptance criteria — if the system reproduces the example, the requirement is met.

## 1. Introduction

### 1.1 Purpose

This Software Requirements Specification (SRS) defines precisely how the Redwave ERP/HRM platform must behave. It translates the business rules in the BRD into testable functional requirements, specifies the user interface at the screen level, and sets the non-functional requirements the system must satisfy. It is the document the Fathom development team builds against and the document against which acceptance is judged.

### 1.2 Scope

The SRS covers all eleven modules of the platform: Auth & RBAC, HRM/Reps, Clients & Products, Commission Configuration, Sales & Validation, Pay Run & Holdback, Clawback, Expenses, Billing & Statements, Documents & E-Signature, and Reporting & Platform. It specifies behavior, UI, and data interactions for each, plus system-wide non-functional requirements and the sale lifecycle state machine.

### 1.3 Definitions

| **Term**           | **Meaning**                                                                                                            |
|--------------------|------------------------------------------------------------------------------------------------------------------------|
| Rep / Distributor  | An independent field salesperson.                                                                                      |
| Activation         | A valid sold product (internet, TV, or home phone) on a customer/household.                                            |
| Tally              | The gross count of non-greenfield internet activations for a rep in a pay period; determines the tier.                 |
| Tier               | A commission bracket (Tier 1 highest .. Tier 4 entry) applied retroactively to all internet activations in the period. |
| Greenfield         | An internet activation in a designated greenfield area; flat-rated and excluded from the tally.                        |
| Snapshot           | Immutable values frozen on a sale_item at payment (tier, rate, amount, incentive) used for accurate clawback.          |
| Clawback           | Recovery of the exact amount paid for a cancelled activation, entered manually; no in-system date math.                |
| Pay period / cycle | A bi-weekly Sunday–Saturday window with a payday ~13 days after close.                                                 |
| MPU ID             | A per-house identifier supplied by some program partners (CTI); used in the Sale ID and clawback matching.             |

### 1.4 References

- Redwave BRD v1.2 (business requirements, single source of truth).

- Redwave Data Model v1.0 — ERD (.drawio) and data dictionary (.docx).

- Schedule C v2 (revised compensation schedule).

- Meeting 1 & 2 transcripts; contractor pay schedule; KM policy; expense form; VF/RF billing files; master commission workbook.

## 2. Overall Description

### 2.1 Product Perspective

The platform is a new, from-scratch, modular web application with a shared API designed to also serve a future mobile app. Business rules are data-driven (configuration tables, effective-dated), so Redwave administrators can change tiers, rates, products, incentives, and access without a code release. The system replaces a manual Excel-and-WhatsApp workflow.

### 2.2 User Classes

| **User class**          | **Characteristics & primary tasks**                                                                                                            |
|-------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| Super Admin             | The three business partners. Full configuration, pay-run execution, role creation, all analytics. Only role that edits records after approval. |
| Admin                   | Operations/administrative staff (e.g. the Administration & Operations Coordinator). Sales validation, expense approval, statements, ledger.    |
| Manager (Field Manager) | Validates and corrects the sales and expenses of assigned reps.                                                                                |
| Sales Rep / Distributor | Enters own sales, submits own expenses, signs documents, views own statement and the leaderboard.                                              |
| Custom roles            | Defined by Super Admin with granular module/action grants (e.g. Accountant, General Manager).                                                  |

### 2.3 Operating Environment & Constraints

- Web application accessed via modern browsers; responsive layout; a future mobile app consumes the same versioned API.

- Primary operating region is Manitoba, Canada (Central Time); some clients operate in US markets.

- Monetary calculations use exact decimal arithmetic; floating-point representation of money is prohibited.

- All business values are configurable and effective-dated; nothing financial is hard-coded.

- Disbursement is via ADP; the system generates a configurable ADP-ready export (no fixed external format imposed).

### 2.4 Assumptions & Dependencies

- Client cancellation reports (and activation dates) are produced and tracked by the program partners, not the system.

- Client remittance data arrives as Excel/CSV; formats vary (CTI automated with MPU ID; RF manual and irregular).

- GST/PST is handled in QuickBooks and is excluded from system-generated statements and invoices.

- The AI chatbot is integrated (Gemini-powered), not built; provider is configurable.

## 3. System-Wide (Non-Functional) Requirements

| **ID**      | **Requirement**                                                                                                                                                                                                                                      | **Pri** |
|-------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| **NFR-001** | **Monetary accuracy.** All money is computed and stored using exact decimal types. Commission, holdback, clawback, and net-pay figures must be reproducible to the cent from stored records.                                                         | **M**   |
| **NFR-002** | **Snapshot immutability.** Once a sale_item is paid, its snapshot fields (tier_at_payment, rate_applied, commission_paid, incentive_amount) must never change. Corrections occur via new records (clawback/adjustment), never by editing a snapshot. | **M**   |
| **NFR-003** | **Rate-stream separation.** Client billing rates and rep commission rates are stored and computed independently; no code path may combine them.                                                                                                      | **M**   |
| **NFR-004** | **Configurability.** Tiers, flat rates, holdback %, incentives, products, billing rates, expense categories, roles, and notification channels are editable via the admin UI with effective dates and no code deploy.                                 | **M**   |
| **NFR-005** | **RBAC enforcement.** Every action is authorized server-side against the user's role permissions; client-side hiding is not sufficient. Unauthorized requests return an error and are logged.                                                        | **M**   |
| **NFR-006** | **Audit logging.** Every create/update/delete/approve on financial and configuration entities is written to the audit log with actor, timestamp, and before/after state. Post-approval edits are restricted to Super Admin and logged.               | **M**   |
| **NFR-007** | **Performance.** Typical interactive screens respond within ~2 seconds under normal load (25+ concurrent users, 300+ sales per cycle). Bulk validation of a full period completes without timeout.                                                   | **S**   |
| **NFR-008** | **Scalability.** The architecture supports growth in users, clients, products, and historical data without redesign, and supports the future mobile app via the shared API.                                                                          | **M**   |
| **NFR-009** | **Security.** Transport encryption (HTTPS); hashed passwords; sensitive PII (banking, IDs) access-restricted by role; signed-document audit metadata (IP, timestamp) captured.                                                                       | **M**   |
| **NFR-010** | **Reliability & cutover.** Payroll correctness is paramount; the system runs in parallel with the manual process for 1–2 cycles before full cutover.                                                                                                 | **S**   |
| **NFR-011** | **Auditable exports.** Generated client statements, invoices, expense exports, and ADP files are stored as records with scope, format, and generator.                                                                                                | **S**   |
| **NFR-012** | **Timezone consistency.** Pay periods, sale dates, and deadlines are evaluated in a single configured business timezone (Central Time) to avoid off-by-one-day errors.                                                                               | **M**   |
| **NFR-013** | **Backup & recovery.** Regular automated backups; documented recovery procedure.                                                                                                                                                                     | **S**   |
| **NFR-014** | **Maintainability.** Code is modular with documented module boundaries and a versioned API contract; all files carry comments sufficient for a new developer to maintain a module, with business rules citing their BRD/SRS reference.               | **M**   |

## 4. Auth & RBAC

Identity, authentication, and modular role-based access. A role is a set of (module, action) permissions; the Super Admin composes roles and assigns them to users. All access is enforced server-side.

### 4.1 Functional Requirements

| **ID**       | **Requirement**                                                                                                                                                                                                                                                                                          | **Pri** |
|--------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| **AUTH-001** | Users authenticate with email and password over an encrypted connection; sessions expire after inactivity.                                                                                                                                                                                               | **M**   |
| **AUTH-002** | **User provisioning + password recovery (BUILT).** Admin INVITE (emailed set-password link), self-service forgot-password (emailed expiring link, non-enumerating), and admin-assisted reset (email a link or a forced-change temp password — the admin never sees the password). Passwords meet a strength policy (≥8 + upper+lower+digit); brute-force lockout after N failed logins. Email via Resend. | **M**   |
| **AUTH-003** | The Super Admin can create, rename, and deactivate custom roles; built-in roles cannot be deleted.                                                                                                                                                                                                       | **M**   |
| **AUTH-004** | The Super Admin can grant a role any combination of (module, action) permissions, where action is view / create / edit / approve / delete / export. One additional dedicated action exists outside the grid: **`notifications:broadcast`** (the right to send a manual broadcast), granted to the **Super Admin only** (see RPT-013).                                                                                                                                                      | **M**   |
| **AUTH-005** | The Super Admin can assign one or more roles to a user; effective permissions are the union of the user's roles.                                                                                                                                                                                         | **M**   |
| **AUTH-006** | Every server request is authorized against the caller's permissions; unauthorized requests are rejected and written to the audit log.                                                                                                                                                                    | **M**   |
| **AUTH-007** | Admin/Manager/Rep default roles are seeded; CM (Administration & Operations Coordinator) is granted Admin access.                                                                                                                                                                                        | **M**   |
| **AUTH-008** | Deactivating a user immediately revokes access while retaining their historical records.                                                                                                                                                                                                                 | **M**   |
| **AUTH-009** | **Personal account — all users.** Every authenticated user has a personal “My Account” area to view their profile, change their password, set preferences, and see (read-only) which notifications they receive.                                                                                         | **M**   |
| **AUTH-010** | **Theme preference.** Each user can set a Light / Dark / System theme; the choice is saved on their user record (theme_preference) and applies immediately with no review.                                                                                                                               | **M**   |
| **AUTH-011** | **Profile edits via review.** A user can request changes to their profile HR fields (full name, phone, avatar). The request is held as pending and applied only after a reviewer approves it; it is never applied directly.                                                                              | **M**   |
| **AUTH-012** | **Review routing.** A rep's profile-change request is reviewed by their Field Manager or an Admin; any other user's request is reviewed by a Super Admin. Routing is expressed via an approve permission on the profile area.                                                                            | **M**   |
| **AUTH-013** | **Personal notifications are not individually overridable.** Users see which notifications they receive, but channel configuration is controlled by the Super Admin per event (no per-user opt-out in this version).                                                                                     | **S**   |
| **AUTH-014** | **System Settings / Administration grouping.** Existing org-wide configuration (roles & permissions, users, tiers/rates, holdback release, incentives, clients/products, expense categories, notification routing, chatbot) is presented under one role-gated Administration area rather than scattered. | **S**   |

> **Built-in role grants (reference).** The RBAC catalogue is **17 modules** (auth/users, hrm, clients, **billing_rates**, commission, sales, payrun, clawback, expenses, billing, documents, import, reporting, settings, profile, account, **notifications**) × **6 actions** (view/create/edit/approve/delete/export), seeded as the standard permission grid, **plus one off-grid permission `notifications:broadcast`**. Default role coverage:
>
> | Permission | Super Admin | Admin | Manager | Sales Rep |
> |---|:---:|:---:|:---:|:---:|
> | All (module, action) grid permissions | ✅ all | operational subset | roster subset | self subset |
> | **`billing_rates:*`** (view/create/edit/delete client rate cards) | ✅ | — | — | — |
> | **`reports:business`** (business/executive dashboard + cross-period trends) | ✅ | — | — | — |
> | **`notifications:broadcast`** | ✅ | — | — | — |
>
> `billing_rates:*` gates the client billing rate cards (sensitive partner financials) and is **Super Admin only** by default — Admin/Manager/Rep do NOT see rate cards; a custom "Business Partner" role can be granted `billing_rates:view`. Managing the **product-type catalogue** is gated `commission:edit`. **`reports:business`** is an off-grid action gating the business/executive dashboard + the cross-period trends endpoint — **Super Admin only** (a custom finance role can be granted it, RPT-006). On the **manager dashboard**, roster AGGREGATE money is shown to any manager, but **per-rep payout / money-ranking requires `hrm:edit`** (the same permission that unredacts a rep's payment details) — enforced server-side. `notifications:broadcast` is **Super Admin only** and is the only path that targets notification recipients freely; all other (automatic) events have intrinsic, non-re-targetable recipients (RPT-012/RPT-013).

### 4.2 UI / Screen Requirements

| **Screen / View**                      | **Purpose & key UI elements**                                                                                                                                            |
|----------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Login**                              | Email + password, error messaging, forgot-password link.                                                                                                                 |
| **User Management**                    | List of users with role(s) and status; create/edit user; assign roles; deactivate. Visible to Super Admin (and Admin if granted).                                        |
| **Role Builder**                       | Create/edit a role; a module × action matrix of checkboxes to grant permissions; save. Super Admin only.                                                                 |
| **My Account — Profile**               | All users: view profile; request edits to name/phone/avatar (submitted for review, shown as ‘pending’ until approved); read-only fields clearly distinguished.           |
| **My Account — Security**              | Change password; view active session / sign out.                                                                                                                         |
| **My Account — Preferences**           | Light / Dark / System theme toggle (applies instantly); other personal preferences.                                                                                      |
| **My Account — Notifications**         | Read-only list of notification types the user receives (channel controlled by Super Admin).                                                                              |
| **Profile Change Requests (reviewer)** | Queue of pending profile edits routed to this reviewer; approve or reject with the proposed values shown.                                                                |
| **Administration / System Settings**   | Role-gated home grouping org-wide config (roles, users, tiers/rates, holdback release, incentives, clients/products, expense categories, notification routing, chatbot). |

### 4.3 Worked Example (acceptance criterion)

> **Custom role: “General Manager”**
> Super Admin creates role “General Manager” and grants: Expenses [view, approve], Commission [view], Sales [view], Reports [view]; leaves User Management unchecked. **Expected:** a user with only this role can approve expenses and view commissions/sales/reports, but any attempt to open User Management or run a pay run is rejected server-side and logged.

### 4.4 Account & Personal Settings

Every user has a personal account area, separate from the role-gated Administration area. It covers profile, security, preferences, and a read-only view of their notifications. Two behaviors are specified precisely:

- **Theme toggle is instant.** Selecting Light / Dark / System writes theme_preference on the user record and takes effect immediately — no review, no reload. It is a harmless personal setting.

- **HR-field edits go through review.** Requests to change full name, phone, or avatar are stored in profile_change_requests as pending; the live profile is unchanged until a reviewer approves. On approval the proposed values are written to the user and the request is marked approved; on rejection nothing changes and the request is marked rejected. Both outcomes are auditable.

Reviewer routing: a rep’s request is reviewed by their Field Manager or an Admin; any other user’s request is reviewed by a Super Admin.

#### Profile-change-request flow

| **Step**        | **Behavior**                                                                                                                                                                                                       |
|-----------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Request         | User edits a profile HR field and submits; a profile_change_request is created (status = pending) with the proposed values. The displayed profile still shows the current values, flagged ‘change pending review’. |
| Route           | The request appears in the queue of the appropriate reviewer (rep → Field Manager/Admin; others → Super Admin).                                                                                                    |
| Review          | Reviewer sees current vs proposed values and approves or rejects.                                                                                                                                                  |
| Apply / discard | Approved → proposed values written to the user, status = approved, reviewed_by/at set. Rejected → no change, status = rejected. Either way the user is notified.                                                   |

> **Worked example — rep updates phone number**
> A rep changes their phone number in My Account and submits. **Expected:** their profile still shows the old number marked ‘pending review’; the request lands in their Field Manager’s review queue; on approval the new number replaces the old and the rep is notified; on rejection the old number stands. The theme toggle, by contrast, changes instantly with no such flow.

### 4.5 Data Touchpoints

users (incl. theme_preference, phone, avatar_url), profile_change_requests, roles, modules, permissions, role_permissions, user_roles, audit_log.

## 5. HRM / Reps

Distributor HR records, documents, and equipment. Rep codes are unique and never reused.

### 5.1 Functional Requirements

| **ID**      | **Requirement**                                                                                                                 | **Pri** |
|-------------|---------------------------------------------------------------------------------------------------------------------------------|---------|
| **HRM-001** | An Admin/Super Admin can create and edit a rep profile (name, contact, payment details, hire date, status).                     | **M**   |
| **HRM-002** | Each rep is assigned exactly one Field Manager (a user with the Manager role).                                                  | **M**   |
| **HRM-003** | Rep codes are unique; the system prevents reuse of a code previously assigned to any rep, including terminated ones.            | **M**   |
| **HRM-004** | A rep can be marked terminated with a termination date; their historical sales, pay, and documents are retained.                | **M**   |
| **HRM-005** | Documents (contracts, IDs) can be uploaded against a rep and stored securely.                                                   | **S**   |
| **HRM-006** | Equipment (e.g. iPad) can be assigned to a rep with a deposit amount and tracked through assigned / returned / withheld states. | **S**   |
| **HRM-007** | Reps are listed with filters (status, field manager) and searchable by name or rep code.                                        | **S**   |
| **HRM-008** | Payment details and identity documents are visible only to roles granted access.                                                | **M**   |

### 5.2 UI / Screen Requirements

| **Screen / View**  | **Purpose & key UI elements**                                                                                     |
|--------------------|-------------------------------------------------------------------------------------------------------------------|
| **Rep List**       | Table of reps (code, name, field manager, status); filter and search; add-rep button.                             |
| **Rep Profile**    | Tabbed detail: Profile, Documents (upload/list), Equipment (assign/return, deposit). Sensitive fields role-gated. |
| **Add / Edit Rep** | Form with validation; field-manager picker; status control.                                                       |

### 5.3 Worked Example

> **Rep code never reused**
> Rep “Redwave07” is terminated. An Admin later tries to create a new rep with code Redwave07. **Expected:** the system rejects the code as already used and requires a new, unused code.

### 5.4 Data Touchpoints

reps, rep_documents, rep_equipment, users (field manager link).

## 6. Clients & Products

Program partners and their admin-created product catalogues, plus client billing rates. Billing rates are a separate stream from rep commission rates.

### 6.1 Functional Requirements

| **ID**       | **Requirement**                                                                                                                                             | **Pri** |
|--------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| **CLNT-001** | An Admin/Super Admin can create and edit clients (code, name, market CA/US, whether the partner supplies MPU IDs, active flag).                             | **M**   |
| **CLNT-002** | Products are created per client, choosing a product type from the **configurable product-type catalogue** (no fixed enum). Creating a product may optionally set its **initial client-billing rate** inline (requires `billing_rates:create`). product_type is immutable after creation. | **M**   |
| **CLNT-003** | Client billing rates are configured per client/product with a rate kind (product / tv_addon / hp_addon / bundle_bonus / spiff) and an effective date range. | **M**   |
| **CLNT-004** | A new billing rate with a future effective date supersedes a pending one for the same scope; closed periods are never altered. A **PENDING** rate may be edited or deleted; a current/past rate is immutable (supersede instead). | **M**   |
| **CLNT-005** | Client billing rates are stored and computed entirely separately from rep commission rates and are never combined.                                          | **M**   |
| **CLNT-006** | Clients and products can be deactivated without deleting historical references.                                                                             | **S**   |
| **CLNT-007** | **Product-type catalogue (configurable).** The SA can add product types at runtime (gated `commission:edit`). Each type carries a LOCKED behaviour: `tiered` (internet — counts toward the tally), `greenfield` (flat, excluded), or `standard_addon`. **New types are always `standard_addon`** (billable, flat-rated, NOT tiered, NOT greenfield — never changes tally/greenfield logic); the 4 core types are system types (behaviour immutable, non-deletable). A type may optionally be created with an inline COMMISSION flat rate. | **M**   |
| **CLNT-008** | **Modular rate-card visibility.** Client billing rate cards are gated by a discrete `billing_rates` permission set (view/create/edit/delete), granted by default to **Super Admin only**. Roles without `billing_rates:view` cannot see rate cards (server-enforced). | **M**   |
| **CLNT-009** | **Client custom fields.** The SA can add/edit/remove repeatable name/value custom fields on a client; they persist and show on the client detail. | **S**   |

### 6.2 UI / Screen Requirements

| **Screen / View**        | **Purpose & key UI elements**                                                                               |
|--------------------------|-------------------------------------------------------------------------------------------------------------|
| **Client List**          | All clients with status and market; add-client button.                                                      |
| **Client Detail**        | Client info; Products tab (create/edit per-client products); Billing Rates tab (effective-dated rate rows). |
| **Product / Rate Forms** | Product creation with type; billing-rate entry with rate kind and an effective-from/to **pay-period selector** (`Period N · start–end`, mapped to the period boundary date; back-dating rejected — BRD §9.4). |

### 6.3 Data Touchpoints

clients, client_custom_fields, products, product_type_catalogue, client_billing_rates.

## 7. Commission Configuration

Rep-side commission rules (Schedule C v2): the tier schedule, flat rates, holdback split, the Super-Admin holdback-release setting, and incentives. All effective-dated.

### 7.1 Functional Requirements

| **ID**       | **Requirement**                                                                                                                                                                                                       | **Pri** |
|--------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| **COMM-001** | The Super Admin can configure the tier schedule: four tiers with count thresholds and a per-activation rate each, effective-dated.                                                                                    | **M**   |
| **COMM-002** | The Super Admin can configure flat rates per **non-tiered product type** (greenfield internet, TV, home phone, and any SA-added standard add-on), effective-dated. A tiered type (internet) is rejected (it's priced by the tier schedule). | **M**   |
| **COMM-003** | The Super Admin can configure the advance/holdback split (default 70% / 30%), effective-dated.                                                                                                                        | **M**   |
| **COMM-004** | **Holdback release setting (bulk, sticky).** The Super Admin sets the release rule (`cycles:N` or `days:N`); it applies in bulk and persists until changed (future holds only). Read by Pay Run at finalize (§17.1). | **M**   |
| **COMM-005** | The Super Admin can create incentives/spiffs: scope (client/product/all), **mode (`per_activation` or `one_time`)**, threshold (`target_count`), date window, and amount. BOTH modes are applied by the engine (per_activation pays beyond the threshold; one_time pays a single bonus at it). | **M**   |
| **COMM-006** | A later configuration change with a future effective date supersedes a pending change; changes apply prospectively only and never recompute a closed period.                                                          | **M**   |
| **COMM-007** | Rate changes generate a system notification; email is sent only if enabled for the rate_change event (default off).                                                                                                   | **S**   |
| **COMM-008** | **Consistent effective-dated CRUD.** Tier schedules, flat rates, and the holdback split support edit/delete of a **PENDING** (not-yet-effective) row; a current/past row is immutable (supersede instead). An incentive may be deleted only if never applied to a paid item (else it is ended). | **S**   |

### 7.2 Tier Schedule (Schedule C v2)

| **Tier**         | **Tally (gross internet, per period)** | **Rate per internet activation** |
|------------------|----------------------------------------|----------------------------------|
| Tier 4 (entry)   | 0 – 6                                  | $110                            |
| Tier 3           | 7 – 16                                 | $125                            |
| Tier 2           | 17 – 35                                | $145                            |
| Tier 1 (highest) | 36 +                                   | $160                            |

| **Flat product**                          | **Rate** |
|-------------------------------------------|----------|
| Greenfield internet (excluded from tally) | $100    |
| TV                                        | $30     |
| Home phone                                | $30     |

### 7.3 UI / Screen Requirements

| **Screen / View**      | **Purpose & key UI elements**                                                                              |
|------------------------|------------------------------------------------------------------------------------------------------------|
| **Tier Configuration** | Edit the four tiers (thresholds + rates) with an effective-from date; shows current and pending schedules. |
| **Flat Rates**         | Edit greenfield/TV/home-phone rates with effective dates.                                                  |
| **Holdback Settings**  | Set advance/holdback split and the bulk release-cycle rule.                                                |
| **Incentive Builder**  | Create/edit a spiff: scope, target type/count, date window, amount; list active and ended incentives.      |

### 7.4 Data Touchpoints

commission_tier_configs, commission_tiers, commission_flat_rates, holdback_config, holdback_release_settings, incentives.

## 8. Sales & Validation

Capture of customer/household activations, the composite Sale ID, the validation workflow, and the greenfield two-step flag. Sale date governs the pay period.

### 8.1 Functional Requirements

| **ID**       | **Requirement**                                                                                                                                                                                                                     | **Pri** |
|--------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| **SALE-001** | A rep enters a sale: client (dropdown, no free text), one or more products, customer name and address, MPU ID (where available), sale date (defaults to today), and an optional greenfield request.                                 | **M**   |
| **SALE-002** | **Sale ID generation.** On entry the system generates a composite Sale ID = sale_date + MPU ID (if provided) + client; a duplicate address on the same MPU ID receives a ‑1/‑2 suffix.                                              | **M**   |
| **SALE-003** | Duplicate addresses are permitted and never blocked (e.g. a new occupant at a prior address).                                                                                                                                       | **M**   |
| **SALE-004** | A sale moves through states: Entered → Validated → In Pay Run → Paid → Clawed Back; an Entered/Validated sale not yet paid may be Deleted.                                                                                          | **M**   |
| **SALE-005** | A Field Manager/Admin validates sales (target: within 1–2 days, by Monday night/Tuesday). Validation is an approval gate and never changes the sale's pay period.                                                                   | **M**   |
| **SALE-006** | **Greenfield two-step.** A rep may request greenfield at entry; an Admin confirms or sets it during validation. The greenfield rate and tally-exclusion apply only to the confirmed state at period close. *[PROPOSED — see §17]* | **M**   |
| **SALE-007** | Bulk validation: an Admin uploads a client report (Excel/CSV); the system matches on MPU ID and auto-validates matches, surfacing only mismatches for manual matching.                                                              | **M**   |
| **SALE-008** | The system records activation_date when present in client data, for reference only; no logic depends on it.                                                                                                                         | **S**   |
| **SALE-009** | Sales are listed with filters by status, rep, client, and date; each sale shows its items and (once paid) snapshots.                                                                                                                | **M**   |
| **SALE-010** | **Pay-period assignment.** A sale belongs to the pay period containing its sale_date, regardless of when it is validated.                                                                                                           | **M**   |

### 8.2 Business Rules & Worked Examples (acceptance criteria)

> **Cross-client tier aggregation**
> In one period a rep submits 3 internet activations for Valley Fiber and 9 for RF Now (none greenfield). **Tally = 12 → Tier 3. Expected:** every one of the 12 internet activations is paid at $125, across both clients. Per-client tallies must not be used.

> **Sale date governs the period**
> A rep makes a sale on Saturday (period A's last day); it is validated the following Monday (period B). **Expected:** the sale counts in period A (its sale_date), not period B.

### 8.3 UI / Screen Requirements

| **Screen / View**    | **Purpose & key UI elements**                                                                                                                            |
|----------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Sale Entry**       | Form: client dropdown, product selector (per-client products), customer + address, MPU ID, sale date, greenfield request checkbox. Live Sale ID preview. |
| **Sales List**       | Filterable table (status, rep, client, date); status badges; bulk-select for validation.                                                                 |
| **Validation Queue** | Entered sales awaiting validation; approve, edit, confirm/clear greenfield, or delete; shows client-report match status.                                 |
| **Bulk Upload**      | Upload client Excel/CSV; preview matched vs unmatched; resolve mismatches manually; commit validation.                                                   |
| **Sale Detail**      | Full sale with items, greenfield state, status history, and (once paid) frozen snapshots.                                                                |

### 8.4 Data Touchpoints

sales, sale_items, products, clients, reps, users (validated_by), pay_runs.

## 9. Pay Run & Holdback

Bi-weekly payroll: tier determination at close, the 70/30 split, holdback ledger and Super-Admin-controlled release, clawback deductions, bonuses, net pay, and the ADP export.

### 9.1 Functional Requirements

| **ID**      | **Requirement**                                                                                                                                                                                      | **Pri** |
|-------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| **PAY-001** | Pay periods (Sunday–Saturday with paydays) are pre-loaded from the schedule; admins select a cycle to run, not create cycles.                                                                        | **M**   |
| **PAY-002** | **Tier determination.** At period close the system computes each rep's gross internet tally and assigns the highest tier reached; that tier rate applies to every internet activation in the period. | **M**   |
| **PAY-003** | The 70% advance of total commission is computed per rep for the period; the 30% holdback is recorded in the holdback ledger.                                                                         | **M**   |
| **PAY-004** | **Holdback release.** The 30% from an origin period is released at finalize in the cycle set by the sticky rule (§17.1), with a clawback set-off reducing a due release first. | **M**   |
| **PAY-005** | Approved expenses for the period are included in the same pay run as that period's commission.                                                                                                       | **M**   |
| **PAY-006** | The Super Admin can add an ad-hoc bonus to a rep's pay-run line with a note.                                                                                                                         | **M**   |
| **PAY-007** | **Clawback application.** Clawbacks are applied as a flat deduction from the rep's pay-run total (no 70/30 sequencing).                                                                              | **M**   |
| **PAY-008** | Each pay-run line shows: 70% advance, 30% released (from origin period), expenses, incentives, bonus, clawback deduction, and net payout.                                                            | **M**   |
| **PAY-009** | A pay run can be saved as draft, finalized, and exported; finalized snapshots (tier, rate, amounts) are frozen onto sale_items.                                                                      | **M**   |
| **PAY-010** | **ADP export.** The run produces a configurable ADP-ready export; the export is stored as a record. No fixed external format is imposed.                                                             | **M**   |
| **PAY-011** | Where a tier cannot yet be finalized at advance time, the system may advance at Tier 4 and true-up at close.                                                                                         | **C**   |

### 9.2 Worked Example — full pay-run line (acceptance criterion)

> **Rep pay-run line for Period A**
> Internet activations (gross): 20 → Tier 2 ($145). Internet = 20 × $145 = $2,900.
> TV: 4 × $30 = $120. Home phone: 3 × $30 = $90. Greenfield: 2 × $100 = $200.
> **Gross commission = $3,310.**
> 70% advance = $2,317.00; 30% holdback = $993.00 (to ledger).
> Plus: 30% released from a prior origin period per Super-Admin setting; plus approved expenses; plus any bonus.
> Minus: any clawbacks as a flat deduction from the total.
> **Net payout = (70% advance + released 30% + expenses + bonus) − clawbacks.**

### 9.3 UI / Screen Requirements

| **Screen / View**       | **Purpose & key UI elements**                                                                                      |
|-------------------------|--------------------------------------------------------------------------------------------------------------------|
| **Pay Run Dashboard**   | List of periods with status (open/closed/paid); select a period to run.                                            |
| **Run Execution**       | Computed per-rep lines preview; add bonuses; review clawbacks and releases; finalize.                              |
| **Pay-Run Line Detail** | Full breakdown for one rep (all components and net).                                                               |
| **Holdback Ledger**     | All holds with origin period, scheduled release cycle, status, released amount; Super-Admin release-cycle control. |
| **ADP Export**          | Generate/download the configurable export; stored export history.                                                  |

### 9.4 Data Touchpoints

pay_periods, pay_runs, pay_run_lines, holdback_ledger, holdback_release_settings, sale_items, clawbacks, expense_reports.

## 10. Clawback

Manual recovery of cancelled activations. No in-system date math: a clawback is entered when the client reports a cancellation, and recovers the exact amount paid from the item snapshot.

### 10.1 Functional Requirements

| **ID**       | **Requirement**                                                                                                                                                                                                                          | **Pri** |
|--------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| **CLAW-001** | An Admin/Super Admin enters a clawback by selecting the cancelled sale_item; the amount defaults to the exact amount originally paid (rate + any incentive) from the snapshot.                                                           | **M**   |
| **CLAW-002** | **No date math.** The system does not compute or enforce 30/60-day windows; the contractual window is sale-date-based but tracked by the client. A clawback can be entered at any time.                                                  | **M**   |
| **CLAW-003** | **Per-product.** A clawback targets a single sale_item, so (e.g.) a TV cancellation is recovered without affecting the internet activation on the same household.                                                                        | **M**   |
| **CLAW-004** | **Never re-tier.** A clawback never recalculates the tier of its original period; other activations are unaffected.                                                                                                                      | **M**   |
| **CLAW-005** | Any incentive paid on the cancelled item is included in the recovered amount.                                                                                                                                                            | **M**   |
| **CLAW-006** | **Flat deduction.** The clawback is applied as a flat deduction from the rep's total in the next available pay run.                                                                                                                      | **M**   |
| **CLAW-007** | **Current-cycle cancellation.** If a sale is cancelled while its own period is still open (before payout), it is deleted and therefore never counts toward that period's tally — no clawback record is created. *[PROPOSED — see §17]* | **M**   |
| **CLAW-008** | Clawbacks are listed with their source sale, amount, reported date, and the pay run they were applied in.                                                                                                                                | **M**   |

### 10.2 Worked Example — per-product clawback (acceptance criterion)

> **TV cancels, internet stays**
> A household had internet ($145, Tier 2) + TV ($30) paid in Period A. Weeks later the client reports the TV cancelled. An Admin enters a clawback on the TV item. **Expected:** $30 is deducted from the rep's next pay-run total; the $145 internet activation is untouched; Period A's tier is not recalculated. If a $20 incentive had been paid on the TV, the clawback would be $50.

### 10.3 UI / Screen Requirements

| **Screen / View**  | **Purpose & key UI elements**                                                                                     |
|--------------------|-------------------------------------------------------------------------------------------------------------------|
| **Clawback Entry** | Search/select the sale and item; auto-filled amount (editable only with permission); reason; reported date; save. |
| **Clawback List**  | All clawbacks with status (pending/applied), source sale, amount, and pay run.                                    |

### 10.4 Data Touchpoints

clawbacks, sale_items (snapshot read), sales, reps, pay_runs.

## 11. Expenses

**Item-first** expense capture by any user — the expense ITEM is the atomic unit (no mandatory weekly report wrapper). Configurable categories, map-automated multi-stop kilometre logs, real receipt storage, a **per-item** approval workflow, a grouped filterable list/export, and same-cycle payout derived from each item's own date.

### 11.1 Functional Requirements

| **ID**      | **Requirement**                                                                                                                                                                                                                                   | **Pri** |
|-------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| **EXP-001** | Any user (rep, manager, admin, partner) can add **expense items** — one or several at once. Each item is independent (its own submitter, status, approver); there is **no required weekly report**. (The legacy `expense_reports` table is retained only as optional grouping/history.)                                                                          | **M**   |
| **EXP-002** | Supported categories: kilometres, meals, hotel, flight, rental, gas, other; the Super Admin can add new categories/fields (with a per-category receipt rule) that appear in the selector. Config-driven, not hardcoded.                            | **M**   |
| **EXP-003** | A receipt upload is mandatory for every category except the kilometre log; enforced client- **and** server-side. Receipts upload to object storage (Supabase) and return an access-controlled URL.                                                | **M**   |
| **EXP-004** | **Kilometre log.** One km log per day **per rep**, with multiple stops; the user selects single trip (−30 km) or round trip (−60 km); billable km × rate (default $0.45) is the amount, **computed server-side**. When a Maps key is configured, each stop is a Places autocomplete and the route distance is **re-derived server-side** from the coordinates (the client value is ignored); otherwise the user enters the total distance manually and the server falls back to it. | **M**   |
| **EXP-005** | The “other” category provides a free description, date, amount, and receipt for ad-hoc costs (e.g. events).                                                                                                                                       | **M**   |
| **EXP-006** | Submitted items enter a Pending Approval queue; a Manager/Admin can edit before approval and **approve/reject/send-back per item, with bulk select** for many at once.                                                                            | **M**   |
| **EXP-007** | **Edit rights.** Before approval: Manager/Admin can edit. After approval: only the Super Admin can change an item. Not-yet-approved items can be deleted (`expenses:delete`); approved items are preserved.                                        | **M**   |
| **EXP-008** | Meal eligibility is a manual approver judgement; the system does not auto-enforce it.                                                                                                                                                             | **M**   |
| **EXP-009** | **Same-cycle payout (by item date).** Each item's pay period is derived from its **own `expense_date`**; an approved item is paid in the cycle of its date. Pay Run aggregates approved ITEMS by `{rep, pay_period, status}`.                       | **M**   |
| **EXP-010** | Expenses display as a filterable, **paginated** item list (default: current pay cycle), filterable by date range, rep, client, category, status, and free-text; **groupable daily/weekly/monthly/custom**; each item can be tagged to a client/program.                                                                                                        | **M**   |
| **EXP-011** | Expenses can be exported to PDF/Excel/CSV (per-item rows or grouped period·count·total; e.g. per-rep KM logs for clients, select-all for accounting); the server-recorded export is stored as a record, RBAC-scoped (manager = roster, rep = own). | **M**   |

### 11.2 Worked Example — kilometre deduction (acceptance criterion)

> **Single vs round trip**
> A rep logs a day with stops totalling 130 km and selects **round trip**. Deduction = 60 km. Billable = 70 km × $0.45 = $31.50. Had they selected single trip, deduction = 30 km, billable = 100 km × $0.45 = $45.00. (With Maps configured the 130 km is the server-derived route distance; without it, the rep types it and the server uses that value.)

### 11.3 UI / Screen Requirements

| **Screen / View**   | **Purpose & key UI elements**                                                                                                                                                                          |
|---------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Add Expense**     | Pick a category → per-category fields (km log: trip type + Places-autocomplete stops on a map with auto distance, or manual entry; standard: date + amount + receipt + description + optional client). “Add another item” to capture several at once. |
| **Expense List**    | Paginated DataTable of items (date default current cycle); filters (status/category/rep/client/date/search); grouping (daily/weekly/monthly); approvers get row-select → bulk approve/reject/send-back; row → detail/edit/delete. |
| **Approval Queue**  | Pending items (server-scoped); per-item + bulk approve/reject/send-back; Super-Admin edit after approval.                                                                                              |
| **Expense Export**  | Grouping + PDF/Excel/CSV (per-item or grouped buckets); a server-recorded export with date/rep/client scope.                                                                                          |

### 11.4 Data Touchpoints

expense_items (item-first: submitter/status/approver/pay_period on the item), expense_km_logs, expense_km_stops, expense_field_configs, expense_exports, expense_reports (optional grouping/history), clients, pay_periods. External: Google Maps Directions (server) + Places (browser); Supabase Storage (receipts).

## 12. Billing & Statements

Per-client, per-period output: the statement Excel (one line per customer) and an optional one-line commission invoice. GST is excluded.

### 12.1 Functional Requirements

| **ID**       | **Requirement**                                                                                                                                                            | **Pri** |
|--------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| **BILL-001** | **One line per customer.** The client statement lists one row per customer/household with all products on that single line and the line total — never one row per product. | **M**   |
| **BILL-002** | Statements are generated per client per pay period and stored with the generated file.                                                                                     | **M**   |
| **BILL-003** | An optional commission invoice (PDF) shows only the total commission amount for the client.                                                                                | **M**   |
| **BILL-004** | **No GST.** Statements and invoices exclude any GST/PST line; tax is handled in QuickBooks.                                                                                | **M**   |
| **BILL-005** | Generated statements/invoices are retained as records (client, period, total, file, generator).                                                                            | **S**   |
| **BILL-006** | **Gapless sequential numbering.** Statements and invoices receive gapless, sequential numbers (one sequence per type), minted atomically on issue — no gaps under concurrency. | **M**   |
| **BILL-007** | **Immutable once issued.** An issued document is never mutated; a correction issues a NEW numbered document and marks the prior one superseded (retained).                   | **M**   |
| **BILL-008** | **Preview before issue.** The one-line-per-customer rows + total are previewable (not persisted, no number) before generating.                                              | **S**   |
| **BILL-009** | **Reconciliation tie-out.** statement total = Σ lines = Σ underlying sales’ billing; pay-run total = Σ lines. Discrepancies are flagged.                                     | **M**   |
| **BILL-010** | **QuickBooks CSV export** of statements/invoices/summary (no tax column), recorded like other exports.                                                                      | **S**   |
| **BILL-011** | **Single-currency CAD** across all clients (incl. US/CTI); no multi-currency/FX. One central rounding rule (2 dp, half-up) → identical CAD figures on screen + every export. | **M**   |

### 12.2 Worked Example

> **Household with three products**
> A customer buys internet + TV + home phone. **Expected:** the statement shows one row for that customer covering all three products with a combined line total — not three separate rows.

### 12.3 UI / Screen Requirements

| **Screen / View**        | **Purpose & key UI elements**                                                            |
|--------------------------|------------------------------------------------------------------------------------------|
| **Statement Generation** | Select client + period; preview one-line-per-customer rows; generate and download Excel. |
| **Invoice Generation**   | Generate one-line commission PDF for a client/period.                                    |
| **Billing History**      | List of generated statements/invoices with download.                                     |

### 12.4 Data Touchpoints

client_statements, client_statement_lines, client_invoices, sales, clients, pay_periods.

## 13. Documents & E-Signature

A two-way document-sharing and in-system e-signature system. Either management or a rep can share a document and request one or many signatures; the requester places signature fields on the PDF, recipients sign **in the browser** (a saved, drawn, or typed signature) or upload an externally-signed file, and the original plus a distinct stamped copy per signer (and a final all-signatures copy) are stored with immutable audit metadata. Files are stored in object storage (Supabase) and served only through **access-controlled, short-TTL signed URLs** — never public.

### 13.1 Functional Requirements

| **ID**      | **Requirement**                                                                                                                     | **Pri** |
|-------------|-------------------------------------------------------------------------------------------------------------------------------------|---------|
| **DOC-001** | A user can upload a **PDF** document (compensation agreement, rate notice, equipment agreement, or other) and retain the unsigned original **unchanged**. Non-PDF (e.g. Word) is rejected with guidance to save as PDF first. | **M**   |
| **DOC-002** | **Share & request.** Either management or a rep can share a document and request a signature from one or many recipients; recipients become the shared-with set. | **M**   |
| **DOC-003** | **Field placement + signing.** The requester places fields (signature / initial / date / text) per recipient on the PDF. Each recipient can sign (applying a signature into their fields) or decline; the system records signer, status, method (drawn / typed / saved / uploaded), IP, and timestamp. | **M**   |
| **DOC-004** | **Distinct signed copies; original immutable.** On signing, the server stamps the signer's fields into a distinct per-signer copy (pdf-lib) stored alongside the retained original, which is **never** modified. | **M**   |
| **DOC-005** | A request tracks overall status (pending / partially signed / completed / declined / cancelled) across its recipients; on completion a **final copy carrying all signatures** is produced. | **M**   |
| **DOC-006** | Signature requests and completions raise notifications per the configured channels.                                                 | **S**   |
| **DOC-007** | Signed-document audit metadata is queryable and immutable.                                                                          | **M**   |
| **DOC-008** | **In-browser preview + download.** Any user with access can preview the original and the signed copies in-app (pdf.js) and download them; signing needs no download/upload round-trip, but uploading an externally-signed file is also offered (method = uploaded). | **M**   |
| **DOC-009** | **Saved reusable signatures.** Each user can create and save a reusable signature (draw / type / upload an image), set a default, and reuse it on every future signing. Saved signatures are private and own-scoped. | **S**   |

### 13.2 UI / Screen Requirements

| **Screen / View**             | **Purpose & key UI elements**                                                         |
|-------------------------------|---------------------------------------------------------------------------------------|
| **Documents**                 | List of documents with status; upload a PDF; open detail.                             |
| **Document detail**           | In-browser PDF preview of the original + download; per-signer signed-copy + final-copy download; activity timeline. |
| **Share / Request Signature** | Pick recipient(s) (one or many), add a message and due date, optionally **place fields** on the PDF per recipient, send request. |
| **Sign Document**             | Recipient previews the document with their fields highlighted and signs (saved / drawn / typed) or declines; or uploads an externally-signed PDF. |
| **Signature Status**          | Per-document view of each recipient's status, signed copy, and audit metadata.        |
| **My Account → Signatures**   | Manage saved reusable signatures (create by draw/type/upload, set default, delete).   |

### 13.3 Data Touchpoints

documents, signature_requests, signature_fields, document_signatures, user_signatures, users, notifications.

### 13.4 Storage & access control

Document files (originals, per-signer signed copies, the final copy, saved-signature images, rep documents) are uploaded to object storage; the row stores the object **path**, and bytes are served only via an RBAC/visibility-gated `…/file-url` endpoint that mints a short-TTL signed URL on each access. Word→PDF conversion is a later enhancement (PDF-only today). When storage is unconfigured the upload returns a `local://` reference and file-url endpoints respond 404 — the workflow, status rollup, audit, and notifications still function.

## 14. Reporting, Dashboards & Platform

Role-scoped dashboards, the competitiveness leaderboard and targets, configurable notifications, and the integrated chatbot. All dashboards are a read layer over existing data — they introduce no new entities.

### 14.1 Dashboards — Overview & Design Rules

The platform provides four role-scoped landing experiences. Each is built from the same shared widget/KPI library and differs only in scope, permitted data, and which queries feed it. None requires new tables; all figures are computed from existing entities (sales, sale_items, pay_run_lines, holdback_ledger, clawbacks, client_statements, expense_\*).

> **Cross-cutting dashboard rules**
> • **Read layer only.** Dashboards aggregate existing data; no new entities. Heavy aggregations may use materialized views or a reporting read-model purely for performance — an implementation choice, not a schema change.
> • **Server-side scope.** Data scope is enforced on the server by role: a rep sees only their own data; a manager only their roster; Super Admin sees everything. Client-side hiding is never sufficient.
> • **Earnings privacy.** The leaderboard shows counts only — never earnings. Cross-person monetary figures appear only on the Super-Admin business dashboard.
> • **Shared widgets.** KPI tiles and charts are built once and reused across dashboards with different queries/filters.

### 14.2 Functional Requirements — Dashboards

| **ID**      | **Requirement**                                                                                                                                                                                                                                                                                                                                                                                                                         | **Pri** |
|-------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| **RPT-001** | **Rep dashboard.** Shows the rep's own sales counts by product, current tier and progress to the next tier, estimated commission for the period, holdback pending release, recent clawbacks against them, and personal statement link. Scoped to the rep's own data only.                                                                                                                                                               | **M**   |
| **RPT-002** | **Manager dashboard.** Scoped to the field manager's assigned roster: combined team sales for the period, sales pending validation, expenses awaiting the manager's approval, and team performance against targets.                                                                                                                                                                                                                     | **S**   |
| **RPT-003** | **Business / Executive dashboard (Super Admin only, `reports:business`).** A period-aware KPI set READ from the frozen ledger (no money recomputed, #1/#5): revenue, rep payout, net margin $/%, holdback held/scheduled/released, clawback total + **clawback rate** (clawback ÷ paid commission), expense total split KM/other, total activations by product type and by client, internet volume, greenfield count + $, the validation funnel (entered→validated→in_pay_run→paid), active reps + **rep tier distribution**, client mix (revenue + volume share), and **period-over-period growth**. A dedicated **`GET /v1/dashboards/business/trends`** endpoint returns multi-period series (revenue/payout/margin, activations by product, revenue by client, tier distribution over the last N periods) for the trend charts. Gated to Super Admin and enforced server-side; partner-level financials are never exposed to Admin/Manager/Rep. | **M**   |
| **RPT-004** | **Admin operational home.** A “what needs my action today” landing view for Admin: pending validations, expenses awaiting approval, current cycle status, and statements due. This is a task/queue view, not an analytics dashboard.                                                                                                                                                                                                    | **S**   |
| **RPT-005** | The Business dashboard supports filters by date range / pay period, client, product, and rep.                                                                                                                                                                                                                                                                                                                                           | **S**   |
| **RPT-006** | A custom view-only finance/executive role can later be granted Business-dashboard access without full Super-Admin powers, via the existing role system; no separate role is built now.                                                                                                                                                                                                                                                  | **C**   |

### 14.3 Functional Requirements — Leaderboard, Notifications & Chatbot

| **ID**      | **Requirement**                                                                                                                                                                                    | **Pri** |
|-------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| **RPT-007** | **Leaderboard.** Ranks reps by internet activation volume for the period and shows progress against targets; reps see counts only, never others' earnings.                                         | **S**   |
| **RPT-008** | **Sales targets (count goals).** A target is an internet-activation goal per rep per pay period (`sales_targets` entity). `GET /v1/sales-targets` is scoped (rep=own, manager=roster, admin=all); `PUT /v1/sales-targets` upserts and requires **`hrm:edit`** (a manager may only set targets for reps they manage — enforced server-side). Drives the **rep "target progress"** widget and the **manager "target-vs-actual"** list.                                                               | **S**   |
| **RPT-009** | **Notifications.** In-app notifications are produced for actionable events; the Super Admin configures, per event type, whether email is also sent. The rate_change event defaults to in-app only. | **M**   |
| **RPT-010** | No automated email is sent for rate changes unless the Super Admin explicitly enables it; rate-change comms are otherwise manual.                                                                  | **M**   |
| **RPT-012** | **Event catalogue management.** The Super Admin manages a catalogue of every automatic event. Per event they may enable/disable it, set the channel (in-app and/or email), and edit the **title/body templates** (documented `{variable}` placeholders; blank → built-in wording). **Recipients are intrinsic to each event** and shown read-only — automatic events are never re-targeted. A genuinely **new** automatic trigger needs a code change (a new emit call); the catalogue manages wording/channel, not trigger logic. | **M**   |
| **RPT-013** | **Manual broadcast.** The Super Admin can compose a one-off broadcast (title + body) to a chosen audience — everyone, a role, or specific users — delivered in-app (and by email where the broadcast channel is on). Gated by the dedicated `notifications:broadcast` permission (Super Admin only). | **S**   |
| **RPT-014** | **Notification Center + unread badge.** Every user has a Notification Center (own-scoped: read/unread, mark-all, bulk read/unread, unread/all filter, search) and a live unread-count badge on the bell that refreshes on a poll interval and on window focus. Clicking a notification deep-links to the related record and marks it read. | **M**   |
| **RPT-011** | **Chatbot.** An integrated, Gemini-powered chatbot grounded on Redwave data answers in-context questions; access is role-gated and the provider is configurable.                                   | **S**   |

> **Worked example — dashboard scope & privacy**
> A field manager opens their dashboard and sees their 6 reps' combined 84 internet activations and 3 pending validations — but cannot see reps outside their roster, nor any rep's pay. A Super Admin opens the business dashboard and sees $182k revenue, $96k payout, net margin, and per-client breakdowns. A rep sees only their own 14 activations, Tier 3, and “3 more to Tier 2.” **Expected:** each request returns only the data the role is permitted, enforced server-side.

### 14.4 UI / Screen Requirements

| **Screen / View**                  | **Purpose & key UI elements**                                                                                                                            |
|------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Rep Dashboard**                  | Own counts by product, current tier + progress to next, estimated commission, pending holdback, recent clawbacks, statement link, leaderboard position.  |
| **Manager Dashboard**              | Roster team sales, pending validations, expenses awaiting approval, team-vs-target. Scoped to assigned reps.                                             |
| **Business / Executive Dashboard** | Revenue, payout, net margin, holdback liability, clawback totals; breakdowns and trends by client/product/rep/period; filters; export. Super Admin only. |
| **Admin Operational Home**         | Action queues: pending validations, pending approvals, cycle status, statements due.                                                                     |
| **Leaderboard**                    | Ranked reps by internet volume with target progress; counts only.                                                                                        |
| **Notification Center**            | Own notifications on the shared DataTable: unread/all filter + search, read/unread, mark-all, bulk read/unread, row click → deep-link to the record. Live unread-count badge on the bell (polled + refetch-on-focus). |
| **Notification Settings**          | Super-Admin per-event management: enable/disable, channel (in-app/email), editable title/body templates (`{variable}` hints), read-only intrinsic recipients per event. rate_change email default off.               |
| **Broadcast composer**             | Super-Admin one-off announcement (title + body) to an audience (everyone / a role / specific users). Gated `notifications:broadcast`.                     |
| **Chatbot**                        | Role-gated assistant widget answering from Redwave data.                                                                                                 |

### 14.5 Data Touchpoints

Read-only aggregation over: sales, sale_items, pay_run_lines, holdback_ledger, clawbacks, client_statements, expense_\*; plus sales_targets, notifications, notification_event_settings, chatbot_config, chatbot_conversations, chatbot_messages. No new entities are introduced.

## 15. Data Import & Integration

Redwave can bring its own files and client data into the system seamlessly. Every import — whether one-time go-live migration or recurring client reports — runs through a configurable mapping and a staging/preview step, so nothing is written to live tables until a user reviews and confirms. This is a clean-slate build of the software; migrating data into it is a normal, separate activity and does not reuse the old system.

### 15.1 Functional Requirements

| **ID**      | **Requirement**                                                                                                                                                                                                                                                                                                                                  | **Pri** |
|-------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| **IMP-001** | **Access.** Only Super Admin and Admin can run imports or migrations.                                                                                                                                                                                                                                                                            | **M**   |
| **IMP-002** | **Configurable field mapping.** Each client/source can have a reusable column-to-field mapping (e.g. RF Now's layout vs CTI's), so new or changed file formats are handled by configuration, not code.                                                                                                                                           | **M**   |
| **IMP-003** | **Staging + preview.** On upload, the file is parsed and validated into staged rows; the user sees matched / unmatched / duplicate / error rows before committing. Nothing is written to live tables until the user confirms the batch.                                                                                                          | **M**   |
| **IMP-004** | **Validation & cleansing.** The pipeline de-duplicates, matches on MPU ID where available, normalizes client names, flags online sign-ups that are not actual sales, and surfaces likely typos for correction.                                                                                                                                   | **M**   |
| **IMP-005** | **Manual reconciliation.** Unmatched or ambiguous rows route to an Admin/Super Admin to resolve (match, edit, or ignore) before commit, exactly as the current manual process requires.                                                                                                                                                          | **M**   |
| **IMP-006** | **Initial migration mode — master data.** At go-live, reps, clients, products, and roles are imported with the same preview/validate/commit safety.                                                                                                                                                                                              | **M**   |
| **IMP-007** | **Initial migration mode — opening financial balances.** Open sales (with reconstructed snapshots), outstanding 30% holdback balances per rep per origin period, and any in-flight clawbacks are imported as the system's opening state. The imported monetary total must reconcile to Redwave's source total before the batch can be committed. | **M**   |
| **IMP-008** | **Traceability.** Every imported row carries its import_batch_id, so any record can be traced to its source file and distinguished from manually entered data.                                                                                                                                                                                   | **M**   |
| **IMP-009** | **Import history & audit.** Each batch is stored with source, type, scope, row counts, errors, who ran it, and when; committed and failed batches are both retained.                                                                                                                                                                             | **M**   |
| **IMP-010** | **Unified with bulk validation.** The recurring client-report ingestion used for sales validation (SALE-007) is a consumer of this same pipeline — one ingestion mechanism, not two.                                                                                                                                                             | **M**   |
| **IMP-011** | Supported source formats are Excel (.xlsx/.xls) and CSV/TSV — uploaded as a real file, parsed server-side (exceljs / papaparse), with cleansing (whitespace trimmed, **dates → 'YYYY-MM-DD'**, **money → exact decimal CAD**, **client codes normalised** — kills the VF/Vf inconsistency). On upload the mapping is **auto-suggested** from the column headers; the operator adjusts + **saves** it for reuse (IMP-002). **Downloadable templates** (Excel + CSV) for every target — incl. the VF / RF Now / CTI client-report formats — are provided so Redwave has the exact columns. | **M**   |
| **IMP-012** | **Historical sales (CONFIRMED, reference-only).** Imported historical / already-paid sales get a `historical` status: they are **REFERENCE-ONLY** — never paid, never enter a pay run, and are **excluded** from rep commission, the tier tally, the leaderboard, holdback, and clawbacks. They appear **only** in the owner's business-side aggregations (Business dashboard revenue + activations), capturing client / product / rep / sale_date / activation_date / billed amount (`sale_items.historical_billed_amount`, a billing-stream reference — never commission, #3). Historical data must never pollute current rep-facing commission or the live pay pipeline. | **M**   |

### 15.2 Worked Examples (acceptance criteria)

> **RF Now manual report with typos**
> An Admin uploads an irregular RF Now Excel with no MPU IDs and two mistyped addresses. **Expected:** the system maps RF's columns via its saved mapping, auto-matches what it can, and routes the two unmatched rows to a reconciliation view where the Admin matches them to the correct entered sales. Nothing commits until the Admin confirms.

> **Holdback opening-balance migration**
> At go-live, Redwave imports outstanding 30% holdbacks totalling $48,200 across all reps. **Expected:** the staged batch shows a computed total; the Admin must confirm it reconciles to Redwave's $48,200 figure before commit. On commit, each rep's holdback ledger opens with the correct balance, available for release in the next pay run per the Super-Admin setting.

### 15.3 UI / Screen Requirements

| **Screen / View**           | **Purpose & key UI elements**                                                                                                                     |
|-----------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| **Import / Migration Home** | Choose import type (client report / master migration / balance migration); upload file; pick or create a field mapping. Super Admin / Admin only. |
| **Field Mapping Editor**    | Map source columns to system fields with transforms; save reusable per-client mappings.                                                           |
| **Staging Preview**         | Parsed rows with match status (matched/unmatched/duplicate/error); counts and reconcile total; per-row issues.                                    |
| **Reconciliation**          | Resolve unmatched/ambiguous rows (match, edit, ignore) before commit.                                                                             |
| **Commit & Confirm**        | Final summary with reconcile check (for balances); commit writes to live tables; batch recorded.                                                  |
| **Import History**          | List of past batches with status, scope, counts, errors, and downloadable source file.                                                            |

### 15.4 Data Touchpoints

import_batches, import_field_mappings, import_rows; writes (on commit) to reps, clients, products, client_billing_rates, sales (incl. `historical`), sale_items, holdback_ledger. Provenance is one-directional via `import_rows.matched_entity_id`; imported **sales** additionally carry `import_batch_id` (so migrated/historical sales are distinguishable from manual entry, IMP-008). Supported targets: client_report→sales (bulk validation, SALE-007); master_migration→clients / products(+rate) / billing_rates / reps / sales(historical); balance_migration→holdback.

## 16. Sale Lifecycle State Machine

The authoritative state model for a sale. Transitions not listed are invalid and must be rejected.

| **State**   | **Meaning**                                             | **Allowed transitions**                                                 |
|-------------|---------------------------------------------------------|-------------------------------------------------------------------------|
| Entered     | Rep has submitted the sale; awaiting validation.        | → Validated (manager approves); → Deleted (invalid/fake).               |
| Validated   | Approved; will be included in its sale-date pay period. | → In Pay Run (period runs); → Deleted (if found invalid before payout). |
| In Pay Run  | Included in a pay run being processed.                  | → Paid (run finalized).                                                 |
| Paid        | Commission paid; snapshots frozen on items.             | → Clawed Back (post-close cancellation entered).                        |
| Clawed Back | A flat clawback was applied for a cancelled item.       | Terminal (further items may be clawed back independently).              |
| Deleted     | Removed before payout; never counts toward any tally.   | Terminal.                                                               |
| Historical  | Migrated/already-paid sale (set only at import). Reference-only — excluded from the pay pipeline (commission/tier/leaderboard/holdback/clawback); shown only in business aggregations. | Terminal (no transitions in or out). |

> **Key invariants**
> • A sale never changes pay period after entry — sale_date is fixed.
> • The tally is finalized only at period close; deletions before close simply never count.
> • A clawback never re-tiers a closed period; it is a flat deduction.
> • Clawbacks operate per sale_item, so products on one sale can be clawed back independently.

## 17. Items Pending Final Confirmation

The following behaviors are specified as the most logical interpretation consistent with all decisions to date, and are flagged for Redwave's explicit confirmation. Each is build-ready as written; confirmation only removes risk of a late change.

### 17.1 Holdback Release Timing (COMM-004, PAY-004) — CONFIRMED & BUILT

The Super Admin sets, once and stickily, the release rule for the 30% holdback in one of two modes:
**`cycles:N`** (release each period's 30% in the **Nth pay cycle after** the origin) or **`days:N`** (release
in the **first pay cycle whose payday is ≥ origin payday + N days**). The rule persists until changed; a later
change affects only **future** holds (already-scheduled/released rows are never re-resolved). The Pay Run reads
the rule at finalize and records each hold's scheduled release cycle + status on the holdback ledger.

> **Worked example**
> Super Admin sets `days:30`. A 30% hold of $993 from Period A is Scheduled for the first cycle ≥ 30 days
> after Period A's payday, and is released in that cycle's run. A pending **clawback sets off** against the
> due release first (recorded as `clawback_applied`, lowering `amount_released`); only the uncovered remainder
> deducts from net — so the clawback is recovered exactly once. Release happens inside finalize (atomic/
> idempotent).

### 17.2 Greenfield Tally at Period Close (SALE-006)

Proposed rule: the internet tally is computed from each sale's confirmed greenfield state at the moment the period closes. Greenfield may be set in either direction by an admin during the open period (rep-requested then confirmed, or admin-initiated). A confirmed-greenfield activation never counts toward the tally; a cleared/never-greenfield internet activation does. Because the tally finalizes only at close, mid-period flag changes need no special handling.

> **Worked example (proposed)**
> A rep enters 10 internet activations; mid-period an admin marks 2 of them greenfield. At close, tally = 8 (the 2 greenfield are excluded and paid at $100 flat); the tier is determined on 8. Had the admin instead cleared a rep's greenfield request on 1 sale, that sale would count, making the tally 9.

### 17.3 Current-Cycle Cancellation (CLAW-007)

Proposed rule: a sale cancelled while its own pay period is still open is deleted and therefore never counts toward that period's tally (the tally is finalized only at close). A cancellation reported after the period has closed and paid is handled as a flat dollar-for-dollar clawback that does not re-tier. The dividing line is solely whether the period has closed.

> **Worked example (proposed)**
> A sale is entered and validated in an open period, then cancelled before that period closes → it is deleted and excluded from the tally, with no clawback. The same sale cancelled after the period closed and paid → a flat clawback of the exact amount paid, with no re-tiering.

## 18. Requirement Traceability

Each module's requirements trace to the BRD and data model. Summary mapping:

| **SRS section**              | **BRD source**    | **Primary entities**                                                           |
|------------------------------|-------------------|--------------------------------------------------------------------------------|
| 4 Auth & RBAC                | BRD §2, §10       | users, roles, permissions, role_permissions, user_roles                        |
| 5 HRM / Reps                 | BRD §2            | reps, rep_documents, rep_equipment                                             |
| 6 Clients & Products         | BRD §8.2          | clients, products, client_billing_rates                                        |
| 7 Commission Config          | BRD §4            | commission_tier_configs, commission_tiers, commission_flat_rates, holdback_\* |
| 8 Sales & Validation         | BRD §5, §3.2      | sales, sale_items                                                              |
| 9 Pay Run & Holdback         | BRD §6            | pay_periods, pay_runs, pay_run_lines, holdback_ledger                          |
| 10 Clawback                  | BRD §6.3          | clawbacks, sale_items                                                          |
| 11 Expenses                  | BRD §7            | expense_items (item-first), expense_km_\*, expense_field_configs, expense_exports |
| 12 Billing                   | BRD §8            | client_statements, client_statement_lines, client_invoices                     |
| 13 Documents                 | BRD §9.5 (new)    | documents, signature_requests, document_signatures                             |
| 14 Reporting & Platform      | BRD §9            | sales_targets, notifications, notification_event_settings, chatbot_\*         |
| 15 Data Import & Integration | BRD §5, Meeting 2 | import_batches, import_field_mappings, import_rows (+ tagged target tables)    |

*End of Software Requirements Specification v1.0 · Redwave ERP/HRM*
