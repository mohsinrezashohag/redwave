# Redwave ERP / HRM — Data Model & Data Dictionary (v1.0)

> Repo reference copy generated from the approved Data Model v1.0 .docx. The entity-relationship diagram lives in **Redwave_Data_Model.drawio** (open in diagrams.net) — an ERD is not meaningfully expressible as markdown, so this file is the data dictionary and the .drawio is the visual model.

**Prepared by:** Fathom (Development Partner)

**Client:** Redwave Marketing Inc.

**Version:** 1.0 — aligned to BRD v1.2

**Phase:** Architecture & Design — Data Model (Phase 1 of build prep)

**Companion file:** Redwave_Data_Model.drawio (open in diagrams.net / draw.io)

> **How this document maps to the diagram**
> The diagram has two pages: **Module Map** (the big picture — modules and their dependencies) and **Full ERD** (every entity with its fields, colour-coded by module, with relationship lines). This document is the data dictionary for that ERD: it explains each module, each entity, every field, the keys, and the design rules the schema enforces.

> **Meeting-3 additions (spec ahead of the built schema — pending migration).** This dictionary now records the Meeting-3 deltas: the **stored-FX money fieldset** `{original_amount, original_currency, fx_rate, fx_rate_date, amount_cad}` on every foreign-capable record (`expense_items` + the billing artifacts), new config entities **`currencies`** and **`km_rate_config`** (per-client, two-stream), a new billing artifact **`client_expense_documents`**, `clients.currency`, `expense_items.is_personal` + `tags`, and the promotion of **`expense_reports`** back to the live weekly submission unit. Captured `fx_rate`/`amount_cad` are frozen like snapshots (#2) — never re-converted. Rep pay (commission/pay-run/holdback/clawback) stays CAD-only.

## 1. Design Principles

The schema is engineered around a single non-negotiable property: every dollar ever paid must be reconstructable from immutable records. The following principles flow from that and from the locked BRD.

- **Surrogate primary keys.** Every table uses a stable internal id (uuid) as its primary key. Business identifiers (rep_code, client_code, sale_code) are unique attributes, not primary keys — so the model survives any future change to those identifiers. Rep codes are never reused, but the surrogate key is still the safe anchor.

- **Configuration is effective-dated, never hard-coded.** Tiers, rates, holdback %, flat rates, and incentives live in config tables with effective_from / effective_to. A change is a new row with a future effective date; it never rewrites history and never requires a code deploy.

- **Two separate rate streams.** Client billing rates (client_billing_rates) and rep commission rates (commission_* tables) are physically separate and never joined. Mixing them was the core defect of the prior system; the schema makes that mistake structurally impossible.

- **Immutable pay snapshots.** When a sale item is paid, the tier, rate, commission amount, and any incentive are frozen onto the sale_items row. A clawback months later reads that snapshot and recovers the exact figure — the period is never recalculated.

- **Sale date governs; no clawback date math.** sale_date determines a sale’s pay period. activation_date is stored for reference only and drives no logic. The system performs no 30/60-day window calculation — clawbacks are entered when the client reports a cancellation.

- **Modular boundaries.** Tables group into the modules shown in the diagram. Cross-module links are explicit foreign keys, so a module can evolve behind a stable interface without disturbing the others.

- **Auditability.** audit_log captures who changed what and when across the system; post-approval edits are restricted (per the BRD) and logged.

## 2. Reading the Dictionary

Each module below has a short description followed by its entities. For every entity, a table lists its fields with type, key, and notes. Key markers:

- **PK** — primary key (the surrogate id).

- **FK** — foreign key; the note shows the referenced table.

- **UQ** — unique business key (e.g. rep_code, sale_code).

> **Snapshot fields**
> Fields marked “SNAPSHOT” on **sale_items** are frozen at the moment of payment and must never be updated afterwards. They are the backbone of accurate clawbacks.

## 3. Auth & RBAC

Identity, roles, and granular module/action permissions. A Role is a bag of (module, action) grants; Super Admin composes custom roles from these. Every sensitive mutation is written to the audit log.

#### `users`

*Any system login. May or may not be linked to a rep profile.*

| **Field**            | **Type**  | **Key** | **Notes**                                                        |
|----------------------|-----------|---------|------------------------------------------------------------------|
| **id**               | uuid      | **PK**  | Surrogate primary key.                                           |
| **email**            | varchar   | **UQ**  | Login identity.                                                  |
| **password_hash**    | varchar   | —       | Server-side only.                                                |
| **full_name**        | varchar   | —       |                                                                  |
| **phone**            | varchar   | —       | Personal contact (editable via review workflow).                 |
| **avatar_url**       | varchar   | —       | Profile photo (editable via review workflow).                    |
| **theme_preference** | enum      | —       | light / dark / system. Personal; applies immediately, no review. |
| **status**           | enum      | —       | active / inactive.                                               |
| **must_change_password** | bool  | —       | Set on invite / admin reset — forces a change at next login (AUTH-002). |
| **failed_login_attempts** | int  | —       | Brute-force counter; reset on success.                          |
| **locked_until**     | timestamp | —       | Lockout expiry; null = not locked.                              |
| **created_at**       | timestamp | —       |                                                                  |
| **updated_at**       | timestamp | —       |                                                                  |

#### `password_reset_tokens`

*Single-use, expiring tokens for the invite (first set-password) + forgot-password flows. Only the token HASH is stored. — AUTH-002*

| **Field**     | **Type**  | **Key** | **Notes**                                  |
|---------------|-----------|---------|--------------------------------------------|
| **id**        | uuid      | **PK**  |                                            |
| **user_id**   | uuid      | **FK**  | -> users.id                                |
| **token_hash**| varchar   | **UQ**  | SHA-256 of the secret (plaintext only in the emailed link). |
| **purpose**   | enum      | —       | invite / reset.                            |
| **expires_at**| timestamp | —       | Reset ~1h, invite ~7d (env-tunable).       |
| **used_at**   | timestamp | —       | Null until consumed (single-use).          |
| **created_at**| timestamp | —       |                                            |

#### `refresh_sessions`  *(Security batch)*

*A persisted, rotating, revocable refresh-token session — one row per device/login. The cookie carries `<id>.<secret>`; only `sha256(secret)` is stored and ROTATED each refresh. A replayed old secret = reuse → the session is revoked. Access tokens carry this row's id as `sid`; the guard rejects revoked sessions (immediate force-logout). — arch §security*

| **Field**       | **Type**  | **Key** | **Notes**                                          |
|-----------------|-----------|---------|----------------------------------------------------|
| **id**          | uuid      | **PK**  | = the access/refresh token `sid` claim.            |
| **user_id**     | uuid      | **FK**  | -> users.id (RESTRICT; never hard-deleted).        |
| **token_hash**  | varchar   | **UQ**  | sha256 of the CURRENT refresh secret (rotated).    |
| **user_agent**  | varchar   | —       | Device label for the sessions list.                |
| **ip_address**  | varchar   | —       | Last-seen IP.                                       |
| **created_at**  | timestamp | —       |                                                    |
| **last_used_at**| timestamp | —       | Updated on each rotation.                          |
| **expires_at**  | timestamp | —       | Mirrors JWT_REFRESH_TTL.                            |
| **revoked_at**  | timestamp | —       | Null = live; set on logout / reuse / force-logout. |

#### `user_mfa` · `mfa_recovery_codes`  *(Security batch)*

*Per-user TOTP MFA. `user_mfa` (PK = user_id): `secret` (base32), `enabled` (flips true only after a verified first code), `confirmed_at`. `mfa_recovery_codes`: 10 one-time codes, **hashed** (`code_hash`), `used_at` (single-use). — AUTH MFA*

#### `security_settings`  *(Security batch, singleton)*

*One row: `mfa_enforced` (bool, default false — the master switch that makes `roles.mfa_required` actually block login), `updated_by` (-> users.id, SET NULL), `updated_at`.*

**Column additions:** `roles.mfa_required` (bool, default false — SA seeded true) · `audit_log.ip_address` (varchar, nullable — the actor's request IP).

#### `roles`

*A named set of permissions. Built-in or Super-Admin-created.*

| **Field**       | **Type**  | **Key** | **Notes**                                       |
|-----------------|-----------|---------|-------------------------------------------------|
| **id**          | uuid      | **PK**  |                                                 |
| **name**        | varchar   | **UQ**  | e.g. Super Admin, Admin, Manager, Sales Rep.    |
| **description** | varchar   | —       |                                                 |
| **is_system**   | bool      | —       | True for built-in roles that cannot be deleted. |
| **created_by**  | uuid      | **FK**  | -> users.id                                    |
| **created_at**  | timestamp | —       |                                                 |

#### `modules`

*Catalogue of system modules access can be granted against.*

| **Field**       | **Type** | **Key** | **Notes**                                  |
|-----------------|----------|---------|--------------------------------------------|
| **id**          | uuid     | **PK**  |                                            |
| **key**         | varchar  | **UQ**  | e.g. sales, commission, expenses, billing. |
| **name**        | varchar  | —       |                                            |
| **description** | varchar  | —       |                                            |

#### `permissions`

*A single (module, action) capability.*

| **Field**       | **Type** | **Key** | **Notes**                                         |
|-----------------|----------|---------|---------------------------------------------------|
| **id**          | uuid     | **PK**  |                                                   |
| **module_id**   | uuid     | **FK**  | -> modules.id                                    |
| **action**      | enum     | —       | view / create / edit / approve / delete / export. |
| **description** | varchar  | —       |                                                   |

#### `role_permissions`

*Join: which permissions a role holds.*

| **Field**         | **Type** | **Key** | **Notes**          |
|-------------------|----------|---------|--------------------|
| **role_id**       | uuid     | **FK**  | -> roles.id       |
| **permission_id** | uuid     | **FK**  | -> permissions.id |

#### `user_roles`

*Join: a user may hold one or more roles.*

| **Field**   | **Type** | **Key** | **Notes**    |
|-------------|----------|---------|--------------|
| **user_id** | uuid     | **FK**  | -> users.id |
| **role_id** | uuid     | **FK**  | -> roles.id |

#### `audit_log`

*Append-only record of who changed what, when.*

| **Field**       | **Type**  | **Key** | **Notes**                                 |
|-----------------|-----------|---------|-------------------------------------------|
| **id**          | uuid      | **PK**  |                                           |
| **user_id**     | uuid      | **FK**  | -> users.id (actor).                     |
| **entity_type** | varchar   | —       | Table affected.                           |
| **entity_id**   | uuid      | —       | Row affected.                             |
| **action**      | varchar   | —       | create / update / delete / approve / etc. |
| **before_json** | jsonb     | —       | Prior state (nullable).                   |
| **after_json**  | jsonb     | —       | New state (nullable).                     |
| **created_at**  | timestamp | —       |                                           |

#### `profile_change_requests`

*A pending edit to a user's profile, held for review.*

| **Field**            | **Type**  | **Key** | **Notes**                                                                    |
|----------------------|-----------|---------|------------------------------------------------------------------------------|
| **id**               | uuid      | **PK**  |                                                                              |
| **user_id**          | uuid      | **FK**  | -> users.id (whose profile).                                                |
| **requested_by**     | uuid      | **FK**  | -> users.id (usually the same user).                                        |
| **proposed_changes** | jsonb     | —       | Field -> new value (name/phone/avatar). Theme excluded (applies instantly). |
| **status**           | enum      | —       | pending / approved / rejected.                                               |
| **reviewed_by**      | uuid      | **FK**  | -> users.id (reviewer; nullable).                                           |
| **reviewed_at**      | timestamp | —       | Nullable.                                                                    |
| **created_at**       | timestamp | —       |                                                                              |

## 4. HRM / Reps

Distributor (sales rep) HR records, their documents, and assigned equipment. Rep codes are never reused, but a surrogate id is still the primary key so the person record is stable even if business identifiers ever change.

#### `reps`

*A field salesperson / distributor.*

| **Field**            | **Type**  | **Key** | **Notes**                              |
|----------------------|-----------|---------|----------------------------------------|
| **id**               | uuid      | **PK**  |                                        |
| **rep_code**         | varchar   | **UQ**  | e.g. Redwave07. Never reused.          |
| **user_id**          | uuid      | **FK**  | -> users.id (login, nullable).        |
| **full_name**        | varchar   | —       |                                        |
| **field_manager_id** | uuid      | **FK**  | -> users.id. Every rep has one.       |
| **status**           | enum      | —       | active / terminated.                   |
| **hire_date**        | date      | —       |                                        |
| **termination_date** | date      | —       | Nullable.                              |
| **payment_details**  | jsonb     | —       | Banking / e-transfer info (sensitive). |
| **created_at**       | timestamp | —       |                                        |

#### `rep_documents`

*Files attached to a rep (contracts, IDs).*

| **Field**       | **Type**  | **Key** | **Notes**                |
|-----------------|-----------|---------|--------------------------|
| **id**          | uuid      | **PK**  |                          |
| **rep_id**      | uuid      | **FK**  | -> reps.id              |
| **doc_type**    | varchar   | —       |                          |
| **file_url**    | varchar   | —       | Cloud storage reference. |
| **uploaded_at** | timestamp | —       |                          |

#### `rep_equipment`

*Equipment assigned to a rep (e.g. iPad on deposit).*

| **Field**          | **Type** | **Key** | **Notes**                       |
|--------------------|----------|---------|---------------------------------|
| **id**             | uuid     | **PK**  |                                 |
| **rep_id**         | uuid     | **FK**  | -> reps.id                     |
| **equipment_type** | varchar  | —       |                                 |
| **identifier**     | varchar  | —       | Serial / asset tag.             |
| **deposit_amount** | decimal  | —       | Held against return.            |
| **assigned_date**  | date     | —       |                                 |
| **returned_date**  | date     | —       | Nullable.                       |
| **status**         | enum     | —       | assigned / returned / withheld. |

## 5. Clients & Products (Config)

Program partners and their admin-created product catalogues. CLIENT BILLING RATES live here and are effective-dated. These are a completely separate stream from rep commission rates (Commission Config) and must never be combined.

#### `clients`

*A program partner (VF, RF, CTI, VF Business, future). Meeting 3 added VF Business as the 4th partner.*

| **Field**           | **Type**  | **Key** | **Notes**                                           |
|---------------------|-----------|---------|-----------------------------------------------------|
| **id**              | uuid      | **PK**  |                                                     |
| **client_code**     | varchar   | **UQ**  | VF / RF / CTI / VFB. Enforced via dropdown, no free text. |
| **name**            | varchar   | —       |                                                     |
| **market**          | enum      | —       | CA / US.                                            |
| **currency**        | varchar   | **FK**  | -> currencies.code. The client's **billing currency** (CTI = USD, others = CAD; Meeting 3). All billing rates/documents are in this currency; roll-ups convert to CAD (frozen-FX, BILL-011). Default CAD. |
| **supplies_mpu_id** | bool      | —       | Whether the partner provides per-house MPU IDs.     |
| **is_active**       | bool      | —       |                                                     |
| **created_at**      | timestamp | —       |                                                     |

#### `currencies`

*The admin-configurable set of allowed currencies (USD + CAD primary; extensible — never hard-coded, Meeting 3). Referenced by `clients.currency`, `expense_items.original_currency`, and every billing artifact's `original_currency`.*

| **Field**     | **Type**  | **Key** | **Notes**                                    |
|---------------|-----------|---------|----------------------------------------------|
| **code**      | varchar   | **PK**  | ISO 4217 (e.g. CAD, USD).                     |
| **name**      | varchar   | —       | Display name.                                 |
| **symbol**    | varchar   | —       | e.g. `$`.                                     |
| **is_active** | bool      | —       |                                               |
| **created_at**| timestamp | —       |                                               |

#### `km_rate_config`

*Per-client, effective-dated kilometre rate — **two-stream** (#3): a `rep` reimbursement rate (CAD) and a separate `client_bill` rate, never combined. Reuses the effective-dating supersession pattern. Default $0.45 when no row.*

| **Field**          | **Type**  | **Key** | **Notes**                                          |
|--------------------|-----------|---------|----------------------------------------------------|
| **id**             | uuid      | **PK**  |                                                    |
| **client_id**      | uuid      | **FK**  | -> clients.id (nullable = global default).          |
| **stream**         | enum      | —       | rep (reimbursement, CAD) / client_bill.             |
| **rate_per_km**    | decimal   | —       | `Decimal(6,3)`.                                     |
| **effective_from** | date      | —       | Supersession-dated; back-dating rejected (#10).     |
| **effective_to**   | date      | —       | Nullable (open-ended current row).                  |
| **created_at**     | timestamp | —       |                                                    |

#### `client_custom_fields`

*SA-defined name/value pairs carrying extra info about a client. Replace-in-place on client create/edit.*

| **Field**         | **Type**  | **Key** | **Notes**                  |
|-------------------|-----------|---------|----------------------------|
| **id**            | uuid      | **PK**  |                            |
| **client_id**     | uuid      | **FK**  | -> clients.id              |
| **field_name**    | varchar   | —       |                            |
| **field_value**   | varchar   | —       |                            |
| **display_order** | int       | —       | Order as supplied.         |
| **created_at**    | timestamp | —       |                            |

#### `product_type_catalogue`

*The configurable set of product types + their LOCKED commission behaviour (replaces the old fixed enum). The SA adds types at runtime (always `standard_addon`); the 4 core types are system types (behaviour immutable, non-deletable). Read by the engine seam (the engine itself stays string-keyed).*

| **Field**      | **Type**  | **Key** | **Notes**                                                              |
|----------------|-----------|---------|------------------------------------------------------------------------|
| **key**        | varchar   | **PK**  | Natural key (e.g. internet). Referenced by product_type columns.       |
| **label**      | varchar   | —       | Display label.                                                         |
| **behaviour**  | enum      | —       | tiered (internet, #5) / greenfield (#9) / standard_addon (default).    |
| **is_system**  | bool      | —       | True for the 4 core types — behaviour locked, non-deletable.           |
| **is_active**  | bool      | —       |                                                                        |
| **created_at** | timestamp | —       |                                                                        |

#### `products`

*An admin-created, per-client sellable item.*

| **Field**        | **Type**  | **Key** | **Notes**                                         |
|------------------|-----------|---------|---------------------------------------------------|
| **id**           | uuid      | **PK**  |                                                   |
| **client_id**    | uuid      | **FK**  | -> clients.id                                    |
| **name**         | varchar   | —       | e.g. Fibre 1gig/2.5gig.                           |
| **product_type** | varchar   | **FK**  | -> product_type_catalogue.key (was an enum).      |
| **is_active**    | bool      | —       |                                                   |
| **created_at**   | timestamp | —       |                                                   |

#### `client_billing_rates`

*What Redwave charges the CLIENT. Effective-dated. Interpreted in the client's `currency`; **bundles are just configured `bundle_bonus` rows** (e.g. RF Now HP+TV $35), not special-cased (Meeting 3).*

| **Field**          | **Type** | **Key** | **Notes**                                             |
|--------------------|----------|---------|-------------------------------------------------------|
| **id**             | uuid     | **PK**  |                                                       |
| **client_id**      | uuid     | **FK**  | -> clients.id                                        |
| **product_id**     | uuid     | **FK**  | -> products.id (nullable for add-on kinds).          |
| **rate_kind**      | enum     | —       | product / tv_addon / hp_addon / bundle_bonus / spiff. |
| **amount**         | decimal  | —       | In the client's `currency` (#3 — never combined with commission). |
| **effective_from** | date     | —       |                                                       |
| **effective_to**   | date     | —       | Nullable = open-ended.                                |
| **created_by**     | uuid     | **FK**  | -> users.id                                          |

## 6. Commission Config

REP commission rules (Schedule C v2): the tier table, flat rates, holdback split, incentives, and the Super-Admin holdback-release setting. All effective-dated and editable from the admin panel. Separate stream from client billing rates.

#### `commission_tier_configs`

*A versioned tier schedule header.*

| **Field**          | **Type** | **Key** | **Notes**    |
|--------------------|----------|---------|--------------|
| **id**             | uuid     | **PK**  |              |
| **effective_from** | date     | —       |              |
| **effective_to**   | date     | —       | Nullable.    |
| **created_by**     | uuid     | **FK**  | -> users.id |

#### `commission_tiers`

*Bracket rows within a tier schedule.*

| **Field**               | **Type** | **Key** | **Notes**                      |
|-------------------------|----------|---------|--------------------------------|
| **id**                  | uuid     | **PK**  |                                |
| **tier_config_id**      | uuid     | **FK**  | -> commission_tier_configs.id |
| **tier_number**         | int      | —       | 1=highest .. 4=entry.          |
| **min_count**           | int      | —       | Tally lower bound.             |
| **max_count**           | int      | —       | Upper bound (null for 36+).    |
| **rate_per_activation** | decimal  | —       | $110 / $125 / $145 / $160. |

#### `commission_flat_rates`

*Flat (non-tiered) REP-commission rates. CAD (rep pay is CAD-only). New `standard_addon` types (Wireless, Protection Plan, Mesh Extender, Speed-attach — Meeting 3) are priced here.*

| **Field**          | **Type** | **Key** | **Notes**                              |
|--------------------|----------|---------|----------------------------------------|
| **id**             | uuid     | **PK**  |                                        |
| **product_type**   | varchar  | **FK**  | -> product_type_catalogue.key (non-tiered types). |
| **amount**         | decimal  | —       | e.g. $100 / $30 / $30; **may be $0 (bill-only add-on — a rep earns no commission on it, but it may still bill the client, Meeting 3)**. |
| **effective_from** | date     | —       |                                        |
| **effective_to**   | date     | —       | Nullable.                              |
| **created_by**     | uuid     | **FK**  | -> users.id                           |

#### `holdback_config`

*The advance/holdback split.*

| **Field**          | **Type** | **Key** | **Notes** |
|--------------------|----------|---------|-----------|
| **id**             | uuid     | **PK**  |           |
| **advance_pct**    | decimal  | —       | 0.70.     |
| **holdback_pct**   | decimal  | —       | 0.30.     |
| **effective_from** | date     | —       |           |
| **effective_to**   | date     | —       | Nullable. |

#### `holdback_release_settings`

*Super-Admin bulk/sticky release rule.*

| **Field**          | **Type**  | **Key** | **Notes**                                 |
|--------------------|-----------|---------|-------------------------------------------|
| **id**             | uuid      | **PK**  |                                           |
| **release_rule**   | varchar   | —       | Structured sticky rule: `cycles:N` or `days:N` (read by Pay Run at finalize, §17.1). |
| **set_by**         | uuid      | **FK**  | -> users.id                              |
| **effective_from** | timestamp | —       | Sticky until changed.                     |

#### `incentives`

*Super-Admin-defined, time-boxed spiff.*

| **Field**              | **Type** | **Key** | **Notes**                         |
|------------------------|----------|---------|-----------------------------------|
| **id**                 | uuid     | **PK**  |                                   |
| **name**               | varchar  | —       |                                   |
| **scope_client_id**    | uuid     | **FK**  | -> clients.id (nullable = all).  |
| **scope_product_type** | varchar  | **FK**  | -> product_type_catalogue.key. Nullable = all. |
| **target_type**        | enum     | —       | per_activation / one_time (both applied by the engine, threshold-relative). |
| **target_count**       | int      | —       | Nullable (e.g. 5 sales in 1 day). |
| **window_start**       | date     | —       |                                   |
| **window_end**         | date     | —       |                                   |
| **amount**             | decimal  | —       | Per-activation bonus.             |
| **status**             | enum     | —       | active / ended.                   |
| **created_by**         | uuid     | **FK**  | -> users.id                      |

## 7. Sales & Validation

The atomic financial unit. A Sale is one customer/household activation with a composite unique Sale ID. Each product on the sale is a sale_item carrying an IMMUTABLE snapshot of how it was paid, so a later clawback recovers the exact amount without recalculating anything.

#### `sales`

*One customer/household activation.*

| **Field**           | **Type**  | **Key** | **Notes**                                                        |
|---------------------|-----------|---------|------------------------------------------------------------------|
| **id**              | uuid      | **PK**  |                                                                  |
| **sale_code**       | varchar   | **UQ**  | Composite: sale_date + MPU ID (if any) + client; -1/-2 on dup.   |
| **sale_date**       | date      | —       | KING. Drives which pay period the sale belongs to.               |
| **activation_date** | date      | —       | Reference only. NO logic depends on it.                          |
| **rep_id**          | uuid      | **FK**  | -> reps.id                                                      |
| **client_id**       | uuid      | **FK**  | -> clients.id                                                   |
| **customer_name**   | varchar   | —       |                                                                  |
| **street**          | varchar   | —       |                                                                  |
| **city**            | varchar   | —       |                                                                  |
| **province_state**  | varchar   | —       |                                                                  |
| **postal_code**     | varchar   | —       |                                                                  |
| **mpu_id**          | varchar   | —       | Client house ID where supplied (nullable).                       |
| **is_greenfield**   | bool      | —       | Confirmed state at close; admin-settable either way.             |
| **status**          | enum      | —       | entered / validated / in_pay_run / paid / clawed_back / deleted / **historical** (migrated, reference-only — never in the pay pipeline; set only at import). |
| **validated_by**    | uuid      | **FK**  | -> users.id (nullable).                                         |
| **validated_at**    | timestamp | —       | Nullable.                                                        |
| **pay_run_id**      | uuid      | **FK**  | -> pay_runs.id (nullable until paid).                           |
| **import_batch_id** | uuid      | —       | Provenance for imported (bulk-validated / historical) sales; no FK (polymorphic, IMP-008). Nullable. |
| **created_at**      | timestamp | —       |                                                                  |

#### `sale_items`

*One product line on a sale; carries the frozen pay snapshot.*

| **Field**               | **Type** | **Key** | **Notes**                                         |
|-------------------------|----------|---------|---------------------------------------------------|
| **id**                  | uuid     | **PK**  |                                                   |
| **sale_id**             | uuid     | **FK**  | -> sales.id                                      |
| **product_id**          | uuid     | **FK**  | -> products.id                                   |
| **product_type**        | varchar  | —       | Catalogue key, frozen snapshot (no FK — #2 immutable). |
| **counts_toward_tally** | bool     | —       | True only for non-greenfield internet.            |
| **tier_at_payment**     | int      | —       | **SNAPSHOT (internet only); frozen at payment.**  |
| **rate_applied**        | decimal  | —       | **SNAPSHOT of the rate used.**                    |
| **commission_paid**     | decimal  | —       | **SNAPSHOT of exact $ paid for this item.**      |
| **incentive_id**        | uuid     | **FK**  | -> incentives.id (nullable).                     |
| **incentive_amount**    | decimal  | —       | **SNAPSHOT (nullable).**                          |
| **historical_billed_amount** | decimal | —    | Historical sales only — the source-file BILLED amount (a billing-stream reference for business aggregations; NOT commission, never joined to commission_*, #3). Nullable. |
| **item_status**         | enum     | —       | active / cancelled / clawed_back.                 |

## 8. Pay Run & Holdback

Bi-weekly payroll. Pay periods are pre-loaded from the 2026 schedule. A pay run produces one line per rep (70% advance, released 30%, expenses, bonuses, clawback deduction, net). The Holdback Ledger tracks each 30% hold and the cycle it releases into.

#### `pay_periods`

*A bi-weekly cycle (Sun-Sat) with its payday.*

| **Field**         | **Type** | **Key** | **Notes**             |
|-------------------|----------|---------|-----------------------|
| **id**            | uuid     | **PK**  |                       |
| **period_number** | int      | **UQ**  |                       |
| **start_date**    | date     | —       | Sunday.               |
| **end_date**      | date     | —       | Saturday.             |
| **payday**        | date     | —       | ~13 days after close. |
| **status**        | enum     | —       | open / closed / paid. |

#### `pay_runs`

*One execution of payroll for a period.*

| **Field**         | **Type**  | **Key** | **Notes**                     |
|-------------------|-----------|---------|-------------------------------|
| **id**            | uuid      | **PK**  |                               |
| **pay_period_id** | uuid      | **FK**  | -> pay_periods.id            |
| **run_date**      | date      | —       |                               |
| **status**        | enum      | —       | draft / finalized / exported. |
| **executed_by**   | uuid      | **FK**  | -> users.id                  |
| **created_at**    | timestamp | —       |                               |

#### `pay_run_lines`

*Per-rep payout for a run.*

| **Field**               | **Type** | **Key** | **Notes**                           |
|-------------------------|----------|---------|-------------------------------------|
| **id**                  | uuid     | **PK**  |                                     |
| **pay_run_id**          | uuid     | **FK**  | -> pay_runs.id                     |
| **rep_id**              | uuid     | **FK**  | -> reps.id                         |
| **commission_70**       | decimal  | —       | 70% advance for this period.        |
| **holdback_release_30** | decimal  | —       | 30% released from an origin period. |
| **expense_total**       | decimal  | —       |                                     |
| **incentive_total**     | decimal  | —       |                                     |
| **bonus_amount**        | decimal  | —       | Ad-hoc, Super-Admin set.            |
| **bonus_note**          | varchar  | —       |                                     |
| **clawback_total**      | decimal  | —       | Flat deduction from total.          |
| **net_payout**          | decimal  | —       | Final amount paid.                  |

#### `holdback_ledger`

*Tracks each 30% hold and its scheduled release.*

| **Field**                       | **Type** | **Key** | **Notes**                             |
|---------------------------------|----------|---------|---------------------------------------|
| **id**                          | uuid     | **PK**  |                                       |
| **rep_id**                      | uuid     | **FK**  | -> reps.id                           |
| **origin_pay_period_id**        | uuid     | **FK**  | -> pay_periods.id                    |
| **amount_held**                 | decimal  | —       |                                       |
| **scheduled_release_period_id** | uuid     | **FK**  | -> pay_periods.id (Super-Admin set). |
| **release_status**              | enum     | —       | held / scheduled / released.          |
| **released_in_pay_run_id**      | uuid     | **FK**  | -> pay_runs.id (nullable).           |
| **amount_released**             | decimal  | —       | Nullable.                             |
| **clawback_applied**            | decimal  | —       | Set-off against this hold (nullable). |

## 9. Clawback

A cancellation recovery. No in-system date math: Redwave inputs a clawback when a client cancellation report arrives. It recovers the exact amount originally paid (read from the sale_item snapshot) as a flat deduction from the rep's pay-run total. Never re-tiers a period.

#### `clawbacks`

*One cancellation recovery against a paid activation.*

| **Field**                 | **Type**  | **Key** | **Notes**                                            |
|---------------------------|-----------|---------|------------------------------------------------------|
| **id**                    | uuid      | **PK**  |                                                      |
| **sale_item_id**          | uuid      | **FK**  | -> sale_items.id (the cancelled activation).        |
| **sale_id**               | uuid      | **FK**  | -> sales.id                                         |
| **rep_id**                | uuid      | **FK**  | -> reps.id                                          |
| **amount**                | decimal   | —       | Exact $ recovered, incl. incentive (from snapshot). |
| **reason**                | varchar   | —       |                                                      |
| **reported_date**         | date      | —       | When the client report arrived.                      |
| **entered_by**            | uuid      | **FK**  | -> users.id                                         |
| **applied_in_pay_run_id** | uuid      | **FK**  | -> pay_runs.id (nullable).                          |
| **status**                | enum      | —       | pending / applied.                                   |
| **created_at**            | timestamp | —       |                                                      |

## 10. Expenses

**Item-first** expense capture by any user — the expense ITEM is the atomic unit (its own submitter, status, approver, and pay period derived from its `expense_date`). Categories are configurable; receipts are mandatory for all except the kilometre log and upload to object storage (access-controlled URL). KM logs hold multi-stop trips with a single/round-trip deduction; with a Maps key the route distance is re-derived server-side from the stops' coordinates. An approved item pays in the same cycle its `expense_date` falls in.

#### `expense_items`

*One expense line item inside a weekly report (report-as-folder, Meeting 3). Carries its own lifecycle, a personal toggle, custom tags, and a frozen stored-FX fieldset for foreign amounts.*

| **Field**             | **Type**  | **Key** | **Notes**                                                                |
|-----------------------|-----------|---------|--------------------------------------------------------------------------|
| **id**                | uuid      | **PK**  |                                                                          |
| **expense_report_id** | uuid      | **FK**  | -> expense_reports.id (nullable during migration; the **weekly report** the item belongs to — the report is the submission unit, EXP-001). |
| **rep_id**            | uuid      | **FK**  | -> reps.id (nullable; the rep this item is for).                         |
| **submitted_by**      | uuid      | **FK**  | -> users.id (the submitter).                                             |
| **category**          | enum      | —       | km / meals / hotel / flight / rental / gas / other (per-type field sets, EXP-002a; catalogue-extensible). |
| **client_id**         | uuid      | **FK**  | -> clients.id (nullable; which program).                                 |
| **expense_date**      | date      | —       | Governs the payout pay period (EXP-009).                                 |
| **amount**            | decimal   | —       | The reimbursable amount in `original_currency`; for km, computed server-side. |
| **is_personal**       | boolean   | —       | Personal / do-not-reimburse (EXP-012); excluded from the reimbursable total, the pay-run seam, and all client output. Default false. |
| **tags**              | jsonb     | —       | Custom tags (client + channel, EXP-002a). |
| **original_amount**   | decimal   | —       | **Stored-FX (frozen).** The amount as incurred, in `original_currency`.  |
| **original_currency** | varchar   | **FK**  | -> currencies.code (USD/CAD + extensible). Default CAD.                   |
| **fx_rate**           | decimal   | —       | **Frozen at APPROVAL.** original→CAD rate, high precision `Decimal(18,8)`; nullable until approved; 1.0 when already CAD. Never re-converted (#2). |
| **fx_rate_date**      | date      | —       | The rate's day (audit).                                                  |
| **amount_cad**        | decimal   | —       | **Frozen.** `original_amount × fx_rate`, 2 dp half-up. The pay run / reimbursement reads THIS. |
| **description**       | varchar   | —       |                                                                          |
| **receipt_url**       | varchar   | —       | Mandatory except km (nullable); access-controlled storage URL. **Never shared with the client** (EXP-003/014). |
| **status**            | enum      | —       | draft / submitted / approved / rejected / sent_back.                     |
| **approved_by**       | uuid      | **FK**  | -> users.id (nullable).                                                  |
| **approved_at**       | timestamp | —       | Nullable.                                                                |
| **pay_period_id**     | uuid      | **FK**  | -> pay_periods.id (nullable; **derived from `expense_date`** at create). |
| **created_at**        | timestamp | —       |                                                                          |

Indexes: `(rep_id, pay_period_id, status)` (the Pay Run aggregation), `(expense_report_id)`, `(submitted_by)`, `(status)`, `(expense_date)`. Money `Decimal(12,2)`; `fx_rate` `Decimal(18,8)`.

#### `expense_reports`

*The LIVE weekly submission unit (report-as-folder, Meeting 3 — EXP-001). A folder of `expense_items` for one business week; the whole report is submitted, approved, or sent back as one unit. Report-level status + aggregated alert count.*

| **Field**         | **Type**  | **Key** | **Notes**                                            |
|-------------------|-----------|---------|------------------------------------------------------|
| **id**            | uuid      | **PK**  |                                                      |
| **name**          | varchar   | —       | Report label (shown in the report list).            |
| **submitted_by**  | uuid      | **FK**  | -> users.id (any user).                             |
| **rep_id**        | uuid      | **FK**  | -> reps.id (nullable; for rep reporting).           |
| **week_start**    | date      | —       | Business-week start (Sun/Mon confirmed at build).    |
| **week_end**      | date      | —       |                                                      |
| **status**        | enum      | —       | not_submitted / submitted / approved / sent_back (report-level, EXP-001a). |
| **submitted_at**  | timestamp | —       | Nullable; set when the report is submitted as one unit. |
| **alert_count**   | int       | —       | Aggregated Alert/Warning count across items (EXP-013); shown on the header. |
| **reimbursable_total** | decimal | —     | Running Σ `amount_cad` of non-personal items (display; not a money source of truth). |
| **approved_by**   | uuid      | **FK**  | -> users.id (nullable).                             |
| **approved_at**   | timestamp | —       | Nullable.                                            |
| **pay_period_id** | uuid      | **FK**  | -> pay_periods.id (cycle it pays in).               |
| **created_at**    | timestamp | —       |                                                      |

#### `expense_km_logs`

*Kilometre detail for a km expense item (one per day).*

| **Field**           | **Type** | **Key** | **Notes**                       |
|---------------------|----------|---------|---------------------------------|
| **id**              | uuid     | **PK**  |                                 |
| **expense_item_id** | uuid     | **FK**  | -> expense_items.id            |
| **trip_type**       | enum     | —       | single (-30km) / round (-60km). |
| **total_km**        | decimal  | —       | Sum of stop legs.               |
| **deduction_km**    | decimal  | —       | 30 or 60.                       |
| **billable_km**     | decimal  | —       | total - deduction.              |
| **rate_per_km**     | decimal  | —       | Snapshot of the applied REP-reimbursement rate ($0.45 default), sourced from the per-client effective-dated `km_rate_config` (two-stream, #3; the client-bill rate is separate). `Decimal(6,3)`. |
| **computed_amount** | decimal  | —       |                                 |

#### `expense_km_stops`

*Ordered stops within a km log (Google-Maps style).*

| **Field**      | **Type** | **Key** | **Notes**                          |
|----------------|----------|---------|------------------------------------|
| **id**         | uuid     | **PK**  |                                    |
| **km_log_id**  | uuid     | **FK**  | -> expense_km_logs.id             |
| **stop_order** | int      | —       |                                    |
| **address**    | varchar  | —       | Open input (origin not hardcoded). |
| **lat**        | decimal  | —       |                                    |
| **lng**        | decimal  | —       |                                    |

#### `expense_field_configs`

*Super-Admin-defined expense categories/fields.*

| **Field**            | **Type** | **Key** | **Notes**    |
|----------------------|----------|---------|--------------|
| **id**               | uuid     | **PK**  |              |
| **category_key**     | varchar  | **UQ**  |              |
| **label**            | varchar  | —       |              |
| **requires_receipt** | bool     | —       |              |
| **is_active**        | bool     | —       |              |
| **created_by**       | uuid     | **FK**  | -> users.id |

#### `expense_exports`

*A stored record of each generated expense export file.*

| **Field**         | **Type**  | **Key** | **Notes**                                         |
|-------------------|-----------|---------|---------------------------------------------------|
| **id**            | uuid      | **PK**  |                                                   |
| **generated_by**  | uuid      | **FK**  | -> users.id                                      |
| **client_id**     | uuid      | **FK**  | -> clients.id (nullable; client-facing exports). |
| **pay_period_id** | uuid      | **FK**  | -> pay_periods.id (nullable).                    |
| **scope_filters** | jsonb     | —       | Date / rep / client / type filters used.          |
| **format**        | enum      | —       | pdf / excel.                                      |
| **file_url**      | varchar   | —       | Stored export artifact.                           |
| **generated_at**  | timestamp | —       |                                                   |

## 11. Billing & Statements

Per-client, per-period output. The statement recreates the Excel Redwave sends clients: ONE line per customer/household with all products on that line. GST is excluded (handled in QuickBooks). The invoice is an optional one-line PDF of total commission. **Meeting 3:** documents bill in the **client's currency** and freeze a CAD conversion at issue (stored-FX, BILL-011); the client **expense** billing document is a separate numbered artifact (`client_expense_documents`).

#### `client_statements`

*The per-client statement for a period. **IMMUTABLE + gapless-numbered** (Billing batch): a re-generation creates a NEW numbered `issued` version and marks the prior one `superseded` (metadata only — number/total/lines/file are never mutated). — BRD §8*

| **Field**            | **Type**  | **Key** | **Notes**                                              |
|----------------------|-----------|---------|--------------------------------------------------------|
| **id**               | uuid      | **PK**  |                                                        |
| **statement_number** | int       | **UQ**  | Gapless, global per type (STMT-00001); minted on issue. |
| **status**           | enum      | —       | `issued` (current) \| `superseded` (`BillingDocStatus`). |
| **client_id**        | uuid      | **FK**  | -> clients.id                                          |
| **pay_period_id**    | uuid      | **FK**  | -> pay_periods.id                                      |
| **currency**         | varchar   | **FK**  | -> currencies.code — the client's billing currency (Meeting 3). |
| **total_amount**     | decimal   | —       | In `currency`, no GST.                                  |
| **fx_rate**          | decimal   | —       | **Frozen at ISSUE.** currency→CAD, `Decimal(18,8)`; 1.0 when already CAD; never re-converted (#2). |
| **fx_rate_date**     | date      | —       | The rate's day (audit).                                |
| **amount_cad**       | decimal   | —       | **Frozen.** `total_amount × fx_rate`, 2 dp half-up. Reconciliation reads THIS. |
| **file_url**         | varchar?  | —       | Nullable — the Excel is rendered on demand / recorded in billing_exports. |
| **generated_by**     | uuid      | **FK**  | -> users.id                                            |
| **generated_at**     | timestamp | —       |                                                        |
| **superseded_by_id** | uuid?     | **FK**  | -> client_statements.id (the newer version; null if current). |

#### `client_statement_lines`

*One line per customer/household.*

| **Field**            | **Type** | **Key** | **Notes**                 |
|----------------------|----------|---------|---------------------------|
| **id**               | uuid     | **PK**  |                           |
| **statement_id**     | uuid     | **FK**  | -> client_statements.id  |
| **sale_id**          | uuid     | **FK**  | -> sales.id              |
| **customer_name**    | varchar  | —       |                           |
| **products_summary** | varchar  | —       | All products on one line. |
| **line_total**       | decimal  | —       |                           |

#### `client_invoices`

*Optional one-line commission invoice (PDF). Gapless-numbered + immutable like statements.*

| **Field**            | **Type**  | **Key** | **Notes**                                                  |
|----------------------|-----------|---------|------------------------------------------------------------|
| **id**               | uuid      | **PK**  |                                                            |
| **invoice_number**   | int       | **UQ**  | Gapless, global per type (INV-00001); minted on issue.     |
| **status**           | enum      | —       | `issued` \| `superseded`.                                  |
| **client_id**        | uuid      | **FK**  | -> clients.id                                              |
| **pay_period_id**    | uuid      | **FK**  | -> pay_periods.id                                          |
| **currency**         | varchar   | **FK**  | -> currencies.code — the client's billing currency (Meeting 3). |
| **total_commission** | decimal   | —       | In `currency`; = the billing-stream statement total. No GST. |
| **fx_rate**          | decimal   | —       | **Frozen at ISSUE.** currency→CAD, `Decimal(18,8)`; 1.0 when CAD; never re-converted. |
| **fx_rate_date**     | date      | —       | The rate's day (audit).                                    |
| **amount_cad**       | decimal   | —       | **Frozen.** `total_commission × fx_rate`, 2 dp half-up.    |
| **file_url**         | varchar?  | —       | Nullable — PDF rendered on demand.                         |
| **generated_by**     | uuid?     | **FK**  | -> users.id                                                |
| **generated_at**     | timestamp | —       |                                                            |
| **superseded_by_id** | uuid?     | **FK**  | -> client_invoices.id.                                     |

#### `client_expense_documents`  *(Meeting 3 — split billing, BILL-012 / EXP-014)*

*The per-client expense billing document — kilometres + food grouped by type, itemized per rep per day. Gapless-numbered + immutable like statements; rendered in the client's currency; **no receipts, no commission data (#3)**. Priced from the client-bill km rate + food only. Separate PDF, attached separately when invoicing.*

| **Field**             | **Type**  | **Key** | **Notes**                                              |
|-----------------------|-----------|---------|--------------------------------------------------------|
| **id**                | uuid      | **PK**  |                                                        |
| **document_number**   | int       | **UQ**  | Gapless, global per type (CEXP-00001); minted on issue. |
| **status**            | enum      | —       | `issued` \| `superseded`.                              |
| **client_id**         | uuid      | **FK**  | -> clients.id                                          |
| **pay_period_id**     | uuid      | **FK**  | -> pay_periods.id                                      |
| **selection_filters** | jsonb     | —       | The chosen reps / days / clients (dynamic selection, EXP-014). |
| **currency**          | varchar   | **FK**  | -> currencies.code (client's currency).                |
| **total_amount**      | decimal   | —       | In `currency`; km (client-bill rate) + food.           |
| **fx_rate**           | decimal   | —       | **Frozen at ISSUE.** currency→CAD, `Decimal(18,8)`; never re-converted. |
| **fx_rate_date**      | date      | —       | The rate's day (audit).                                |
| **amount_cad**        | decimal   | —       | **Frozen.** `total_amount × fx_rate`, 2 dp half-up.    |
| **file_url**          | varchar?  | —       | Nullable — PDF rendered on demand.                     |
| **generated_by**      | uuid      | **FK**  | -> users.id                                            |
| **generated_at**      | timestamp | —       |                                                        |
| **superseded_by_id**  | uuid?     | **FK**  | -> client_expense_documents.id.                        |

*(Line detail is grouped by expense type × rep × day; the source is the approved non-personal `expense_items` in scope. Receipts are never referenced here.)*

#### `document_sequences`  *(Billing batch)*

*The gapless per-type counter. Incremented atomically inside the issue transaction (row lock → no gaps under concurrency). — BRD §8*

| **Field**         | **Type** | **Key** | **Notes**                          |
|-------------------|----------|---------|------------------------------------|
| **key**           | varchar  | **PK**  | `statement` \| `invoice` \| `client_expense`. |
| **current_value** | int      | —       | Highest number issued so far (next = +1). |

#### `billing_exports`  *(Billing batch)*

*A recorded export artifact (Excel / PDF / QuickBooks CSV / summary), stored by object path — like expense_exports. Downloads render on demand; configured storage also persists + records here.*

| **Field**         | **Type**  | **Key** | **Notes**                                      |
|-------------------|-----------|---------|------------------------------------------------|
| **id**            | uuid      | **PK**  |                                                |
| **kind**          | varchar   | —       | statement \| invoice \| summary \| quickbooks. |
| **format**        | varchar   | —       | excel \| pdf \| csv.                           |
| **statement_id**  | uuid?     | **FK**  | -> client_statements.id.                       |
| **invoice_id**    | uuid?     | **FK**  | -> client_invoices.id.                         |
| **client_id**     | uuid?     | —       | denormalised scope.                            |
| **pay_period_id** | uuid?     | —       | denormalised scope.                            |
| **file_path**     | varchar   | —       | Object-storage path.                           |
| **generated_by**  | uuid      | **FK**  | -> users.id.                                   |
| **generated_at**  | timestamp | —       |                                                |

## 12. Documents & E-Signature

A two-way document-sharing and in-system e-signature system. Either management or a rep can share a document and request one or more signatures; the requester places fields per recipient, recipients sign in the browser (saved/drawn/typed) or upload an externally-signed file, and the server stamps a distinct copy per signer (plus a final all-signatures copy) — the original is never mutated. Covers the compensation agreement, rate-change acknowledgements, equipment agreements, and ad-hoc docs. **`*_file_url` columns hold an object PATH (re-signed on read); files are served via short-TTL access-controlled URLs, never public.**

#### `documents`

*An uploaded document instance available for sharing/signing.*

| **Field**             | **Type**  | **Key** | **Notes**                                                 |
|-----------------------|-----------|---------|-----------------------------------------------------------|
| **id**                | uuid      | **PK**  |                                                           |
| **title**             | varchar   | —       |                                                           |
| **doc_type**          | enum      | —       | compensation_agreement / rate_notice / equipment / other. |
| **owner_user_id**     | uuid      | **FK**  | -> users.id (who uploaded/owns it).                      |
| **original_file_url** | varchar   | —       | Object path of the unsigned original (always retained; **never mutated**, DOC-001/004). |
| **status**            | enum      | —       | draft / shared / partially_signed / completed / declined. |
| **created_at**        | timestamp | —       |                                                           |

#### `signature_requests`

*A request to sign a document, to one or many recipients.*

| **Field**             | **Type**  | **Key** | **Notes**                                   |
|-----------------------|-----------|---------|---------------------------------------------|
| **id**                | uuid      | **PK**  |                                             |
| **document_id**       | uuid      | **FK**  | -> documents.id                            |
| **requested_by**      | uuid      | **FK**  | -> users.id (sender; mgmt or rep).         |
| **message**           | varchar   | —       | Optional note to recipients.                |
| **due_date**          | date      | —       | Nullable.                                   |
| **status**            | enum      | —       | pending / completed / declined / cancelled. |
| **completed_file_path** | varchar | —       | Object path of the final all-signatures copy (set on completion, DOC-005; nullable). |
| **created_at**        | timestamp | —       |                                             |

#### `signature_fields`

*A field the requester places on the PDF for a specific recipient (where/what to sign). Coordinates are normalized 0..1 fractions of the page, top-left origin; the server converts to PDF points at stamp time. Values are filled at signing.*

| **Field**                | **Type**  | **Key** | **Notes**                                            |
|--------------------------|-----------|---------|------------------------------------------------------|
| **id**                   | uuid      | **PK**  |                                                      |
| **signature_request_id** | uuid      | **FK**  | -> signature_requests.id                            |
| **recipient_user_id**    | uuid      | **FK**  | -> users.id (who must fill it).                     |
| **type**                 | enum      | —       | signature / initial / date / text.                   |
| **page**                 | int       | —       | 0-based page index.                                  |
| **x / y / w / h**        | decimal(6,5) | —    | Normalized 0..1 fractions (top-left origin).         |
| **value_text**           | varchar   | —       | Filled for text/date fields at signing (nullable).   |
| **value_image_path**     | varchar   | —       | Filled for signature/initial fields (the applied signature image path; nullable). |
| **created_at**           | timestamp | —       |                                                      |

#### `document_signatures`

*Per-recipient signature record (one row per signer).*

| **Field**                | **Type**  | **Key** | **Notes**                                            |
|--------------------------|-----------|---------|------------------------------------------------------|
| **id**                   | uuid      | **PK**  |                                                      |
| **signature_request_id** | uuid      | **FK**  | -> signature_requests.id                            |
| **recipient_user_id**    | uuid      | **FK**  | -> users.id (the signer).                           |
| **status**               | enum      | —       | pending / signed / declined.                         |
| **signed_file_url**      | varchar   | —       | Object path of the distinct per-signer stamped copy (nullable until signed). |
| **signed_at**            | timestamp | —       | Nullable.                                            |
| **method**               | varchar   | —       | Signature method (drawn / typed / saved / uploaded). |
| **ip_address**           | varchar   | —       | Captured at signing for audit.                       |

#### `user_signatures`

*A user's saved, reusable signature (private + own-scoped). One default per user.*

| **Field**       | **Type**  | **Key** | **Notes**                                            |
|-----------------|-----------|---------|------------------------------------------------------|
| **id**          | uuid      | **PK**  |                                                      |
| **user_id**     | uuid      | **FK**  | -> users.id (owner).                                |
| **label**       | varchar   | —       | Display label.                                       |
| **file_path**   | varchar   | —       | Private object path; served via an own-scoped signed URL. |
| **method**      | enum      | —       | drawn / typed / uploaded.                            |
| **is_default**  | boolean   | —       | One default per user.                                |
| **created_at**  | timestamp | —       |                                                      |

## 13. Reporting & Platform

Cross-cutting: sales targets for the competitiveness leaderboard, in-app system notifications (no automated email), and the integrated Gemini chatbot configuration and conversation logs.

#### `sales_targets`

*Targets for the leaderboard / target tracker.*

| **Field**        | **Type** | **Key** | **Notes**                        |
|------------------|----------|---------|----------------------------------|
| **id**           | uuid     | **PK**  |                                  |
| **rep_id**       | uuid     | **FK**  | -> reps.id (nullable = global). |
| **target_type**  | enum     | —       | daily / weekly / monthly.        |
| **target_count** | int      | —       |                                  |
| **period_start** | date     | —       |                                  |
| **period_end**   | date     | —       |                                  |
| **set_by**       | uuid     | **FK**  | -> users.id                     |

#### `notifications`

*In-app or email system notification.*

| **Field**               | **Type**  | **Key** | **Notes**                            |
|-------------------------|-----------|---------|--------------------------------------|
| **id**                  | uuid      | **PK**  |                                      |
| **user_id**             | uuid      | **FK**  | -> users.id                         |
| **type**                | varchar   | —       | Event type key.                      |
| **channel**             | enum      | —       | in_app / email (per event settings). |
| **title**               | varchar   | —       |                                      |
| **body**                | varchar   | —       |                                      |
| **related_entity_type** | varchar   | —       | Nullable.                            |
| **related_entity_id**   | uuid      | —       | Nullable.                            |
| **is_read**             | bool      | —       |                                      |
| **sent_at**             | timestamp | —       | When email dispatched (nullable).    |
| **created_at**          | timestamp | —       |                                      |

#### `notification_event_settings`

*Super-Admin map of event -> enabled channels.*

| **Field**          | **Type**  | **Key** | **Notes**                                                  |
|--------------------|-----------|---------|------------------------------------------------------------|
| **id**             | uuid      | **PK**  |                                                            |
| **event_type**     | varchar   | **UQ**  | e.g. expense_approved, doc_signature_request, rate_change. |
| **in_app_enabled** | bool      | —       | Default true.                                              |
| **email_enabled**  | bool      | —       | Super-Admin set; rate_change defaults false.               |
| **updated_by**     | uuid      | **FK**  | -> users.id                                               |
| **updated_at**     | timestamp | —       |                                                            |

#### `chatbot_config`

*Provider-configurable chatbot settings.*

| **Field**       | **Type** | **Key** | **Notes**       |
|-----------------|----------|---------|-----------------|
| **id**          | uuid     | **PK**  |                 |
| **provider**    | varchar  | —       | gemini / other. |
| **model**       | varchar  | —       |                 |
| **is_active**   | bool     | —       |                 |
| **config_json** | jsonb    | —       |                 |
| **updated_by**  | uuid     | **FK**  | -> users.id    |

#### `chatbot_conversations`

*A user's chat session.*

| **Field**      | **Type**  | **Key** | **Notes**    |
|----------------|-----------|---------|--------------|
| **id**         | uuid      | **PK**  |              |
| **user_id**    | uuid      | **FK**  | -> users.id |
| **started_at** | timestamp | —       |              |

#### `chatbot_messages`

*Messages within a conversation.*

| **Field**           | **Type**  | **Key** | **Notes**                    |
|---------------------|-----------|---------|------------------------------|
| **id**              | uuid      | **PK**  |                              |
| **conversation_id** | uuid      | **FK**  | -> chatbot_conversations.id |
| **role**            | enum      | —       | user / assistant.            |
| **content**         | text      | —       |                              |
| **created_at**      | timestamp | —       |                              |

## 14. Data Import & Integration

Seamless ingestion of Redwave's own files and client data. Every import runs through a staging + preview step before anything is written to live tables. Covers one-time go-live migration (master data AND opening financial balances) and recurring client report ingestion. Imported rows carry an import_batch_id so any record traces back to its source file.

#### `import_batches`

*One import/migration operation, staged before commit.*

| **Field**            | **Type**  | **Key** | **Notes**                                                        |
|----------------------|-----------|---------|------------------------------------------------------------------|
| **id**               | uuid      | **PK**  |                                                                  |
| **source_file_url**  | varchar   | —       | The uploaded Excel/CSV — a real object-storage path (Supabase).  |
| **source_type**      | enum      | —       | client_report / master_migration / balance_migration.            |
| **import_type**      | enum      | —       | reps / clients / products / billing_rates / sales / holdback / clawback / mixed. |
| **client_id**        | uuid      | **FK**  | -> clients.id (nullable; for client reports).                   |
| **field_mapping_id** | uuid      | **FK**  | -> import_field_mappings.id (nullable).                         |
| **status**           | enum      | —       | staged / committed / failed / cancelled.                         |
| **total_rows**       | int       | —       |                                                                  |
| **matched_rows**     | int       | —       |                                                                  |
| **error_rows**       | int       | —       |                                                                  |
| **reconcile_total**  | decimal   | —       | Imported $ total to reconcile (balances).                       |
| **error_summary**    | jsonb     | —       | Per-row issues for manual resolution.                            |
| **run_by**           | uuid      | **FK**  | -> users.id (Super Admin / Admin only).                         |
| **created_at**       | timestamp | —       |                                                                  |
| **committed_at**     | timestamp | —       | Nullable until committed.                                        |

#### `import_field_mappings`

*Reusable per-client/source column-to-field mapping.*

| **Field**        | **Type** | **Key** | **Notes**                                             |
|------------------|----------|---------|-------------------------------------------------------|
| **id**           | uuid     | **PK**  |                                                       |
| **name**         | varchar  | —       |                                                       |
| **client_id**    | uuid     | **FK**  | -> clients.id (nullable).                            |
| **source_type**  | enum     | —       | client_report / master_migration / balance_migration. |
| **mapping_json** | jsonb    | —       | Source column -> system field map; transforms.       |
| **created_by**   | uuid     | **FK**  | -> users.id                                          |

#### `import_rows`

*Staged rows awaiting validation/commit (transient).*

| **Field**             | **Type** | **Key** | **Notes**                                          |
|-----------------------|----------|---------|----------------------------------------------------|
| **id**                | uuid     | **PK**  |                                                    |
| **import_batch_id**   | uuid     | **FK**  | -> import_batches.id                              |
| **row_number**        | int      | —       | Position in the source file.                       |
| **raw_data**          | jsonb    | —       | Original parsed row.                               |
| **mapped_data**       | jsonb    | —       | After field mapping.                               |
| **match_status**      | enum     | —       | matched / unmatched / duplicate / error / ignored. |
| **matched_entity_id** | uuid     | —       | Resolved target row (nullable).                    |
| **issue**             | varchar  | —       | Reason for manual review (nullable).               |
| **resolved_by**       | uuid     | **FK**  | -> users.id (manual reconciliation, nullable).    |

## 15. Relationship Summary

Key foreign-key relationships across the model (cardinality shown from the child/owning side). These are the lines drawn on the Full ERD page.

| **From (child)**                | **Card.** | **To (parent)**         | **Role**     |
|---------------------------------|-----------|-------------------------|--------------|
| **user_roles**                  | 1:N       | users                   | user         |
| **user_roles**                  | 1:N       | roles                   | role         |
| **role_permissions**            | 1:N       | roles                   | role         |
| **role_permissions**            | 1:N       | permissions             | perm         |
| **permissions**                 | 1:N       | modules                 | module       |
| **roles**                       | 1:N       | users                   | created_by   |
| **audit_log**                   | 1:N       | users                   | actor        |
| **profile_change_requests**     | 1:N       | users                   | subject      |
| **profile_change_requests**     | 1:N       | users                   | reviewed_by  |
| **reps**                        | 1:1       | users                   | login        |
| **reps**                        | 1:N       | users                   | field_mgr    |
| **rep_documents**               | 1:N       | reps                    |              |
| **rep_equipment**               | 1:N       | reps                    |              |
| **clients**                     | N:1       | currencies              | billing currency |
| **km_rate_config**              | 1:N       | clients                 | nullable = global |
| **products**                    | 1:N       | clients                 |              |
| **products**                    | N:1       | product_type_catalogue  | product_type → key |
| **client_custom_fields**        | 1:N       | clients                 |              |
| **commission_flat_rates**       | N:1       | product_type_catalogue  | product_type → key |
| **incentives**                  | N:1       | product_type_catalogue  | scope_product_type → key (nullable) |
| **client_billing_rates**        | 1:N       | clients                 |              |
| **client_billing_rates**        | 1:N       | products                |              |
| **commission_tiers**            | 1:N       | commission_tier_configs |              |
| **incentives**                  | 1:N       | clients                 | scope        |
| **sales**                       | 1:N       | reps                    |              |
| **sales**                       | 1:N       | clients                 |              |
| **sales**                       | 1:N       | users                   | validated_by |
| **sales**                       | 1:N       | pay_runs                | paid_in      |
| **sale_items**                  | 1:N       | sales                   |              |
| **sale_items**                  | 1:N       | products                |              |
| **sale_items**                  | 1:N       | incentives              |              |
| **pay_runs**                    | 1:N       | pay_periods             |              |
| **pay_run_lines**               | 1:N       | pay_runs                |              |
| **pay_run_lines**               | 1:N       | reps                    |              |
| **holdback_ledger**             | 1:N       | reps                    |              |
| **holdback_ledger**             | 1:N       | pay_periods             | origin       |
| **holdback_ledger**             | 1:N       | pay_periods             | release      |
| **holdback_ledger**             | 1:N       | pay_runs                | released_in  |
| **clawbacks**                   | 1:N       | sale_items              |              |
| **clawbacks**                   | 1:N       | sales                   |              |
| **clawbacks**                   | 1:N       | reps                    |              |
| **clawbacks**                   | 1:N       | pay_runs                | applied_in   |
| **expense_reports**             | 1:N       | users                   | submitted_by |
| **expense_reports**             | 1:N       | reps                    |              |
| **expense_reports**             | 1:N       | pay_periods             |              |
| **expense_items**               | 1:N       | expense_reports         | the weekly report folder (submission unit) |
| **expense_items**               | 1:N       | reps                    |              |
| **expense_items**               | 1:N       | users                   | submitted_by / approved_by |
| **expense_items**               | 1:N       | pay_periods             | derived from expense_date |
| **expense_items**               | 1:N       | clients                 |              |
| **expense_items**               | N:1       | currencies              | original_currency |
| **expense_km_logs**             | 1:1       | expense_items           |              |
| **expense_km_stops**            | 1:N       | expense_km_logs         |              |
| **expense_exports**             | 1:N       | users                   | generated_by |
| **expense_exports**             | 1:N       | clients                 |              |
| **expense_exports**             | 1:N       | pay_periods             |              |
| **documents**                   | 1:N       | users                   | owner        |
| **signature_requests**          | 1:N       | documents               |              |
| **signature_requests**          | 1:N       | users                   | requested_by |
| **signature_fields**            | 1:N       | signature_requests      |              |
| **signature_fields**            | 1:N       | users                   | recipient    |
| **document_signatures**         | 1:N       | signature_requests      |              |
| **document_signatures**         | 1:N       | users                   | signer       |
| **user_signatures**             | 1:N       | users                   | owner        |
| **notification_event_settings** | 1:N       | users                   | updated_by   |
| **import_batches**              | 1:N       | clients                 |              |
| **import_batches**              | 1:N       | import_field_mappings   | mapping      |
| **import_batches**              | 1:N       | users                   | run_by       |
| **import_field_mappings**       | 1:N       | clients                 |              |
| **import_rows**                 | 1:N       | import_batches          |              |
| **client_statements**           | 1:N       | clients                 |              |
| **client_statements**           | 1:N       | pay_periods             |              |
| **client_statements**           | N:1       | currencies              | billing currency |
| **client_statement_lines**      | 1:N       | client_statements       |              |
| **client_statement_lines**      | 1:N       | sales                   |              |
| **client_invoices**             | 1:N       | clients                 |              |
| **client_invoices**             | 1:N       | pay_periods             |              |
| **client_invoices**             | N:1       | currencies              | billing currency |
| **client_expense_documents**    | 1:N       | clients                 |              |
| **client_expense_documents**    | 1:N       | pay_periods             |              |
| **client_expense_documents**    | N:1       | currencies              | billing currency |
| **sales_targets**               | 1:N       | reps                    |              |
| **notifications**               | 1:N       | users                   |              |
| **chatbot_conversations**       | 1:N       | users                   |              |
| **chatbot_messages**            | 1:N       | chatbot_conversations   |              |

*End of Data Model & Dictionary v1.0 · companion to Redwave_Data_Model.drawio*
