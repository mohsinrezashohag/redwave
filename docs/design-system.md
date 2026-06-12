# Redwave ERP / HRM — Frontend Design System & UI Specification (v1.0)

> Repo reference copy generated from the approved Design System v1.0 .docx. The Word version is the client-facing deliverable and shows visual colour swatches; this markdown lists every token, hex value, and usage (the colour blocks themselves only render in the Word file). For in-repo use by the dev tooling.

**Prepared by:** Fathom (Development Partner)

**Client:** Redwave Marketing Inc.

**Version:** 1.0 (draft for review) — aligned to SRS v1.0 & Architecture v1.0

**Stack:** React + TypeScript; tokens implemented as CSS variables

**Status:** For client review — visual aesthetic to be fine-tuned on first rendered screens

> **Design intent in one line**
> **A fast, calm, professional operations tool — not a flashy marketing site.** Every day, reps, managers, and admins will spend hours entering sales, validating, approving expenses, and running payroll. The design optimises for clarity, speed, low cognitive load, and trust with money — with a distinctive, considered identity that is unmistakably Redwave’s and never a generic template.

## 1. Design Principles

Seven principles govern every decision in this system. When a design question isn’t answered by a specific spec, resolve it in favour of these.

- **Clarity over decoration.** This is a tool people work in all day. Information hierarchy, legibility, and obviousness beat visual flourish. Decoration only where it aids comprehension or identity.

- **Speed is a feature.** Screens load fast, navigation feels instant, and frequent actions take the fewest clicks. Perceived performance (skeletons, optimistic updates) matters as much as real performance.

- **Trust with money.** Financial figures are presented precisely and unambiguously; destructive or money-moving actions are deliberate, confirmed, and reversible where possible. The UI should feel dependable.

- **Consistency, no improvisation.** Every screen is assembled from the same tokens and components. A developer never invents a one-off colour, spacing, or control. Same problem → same solution everywhere.

- **Distinctive, not generic.** A specific, characterful identity — deliberate colour, real typographic personality, a recognisable layout rhythm. Never the default framework palette or cookie-cutter card grid.

- **Every state designed.** Default, hover, focus, active, disabled, loading, empty, error, success — all specified. Nothing fails silently; every action gives feedback.

- **Accessible & responsive by default.** Keyboard-navigable, sufficient contrast, labelled controls; works from mobile width upward so the future mobile app shares patterns.

## 2. Aesthetic Direction

The chosen direction is “precise operational”: a clean, confident, slightly editorial enterprise look with a strong brand accent and disciplined density. Think a modern financial/operations dashboard — structured, trustworthy, quietly distinctive — rather than a playful consumer app or a flashy landing page.

### 2.1 What this means concretely

- **A dominant deep-navy brand with a single vivid accent.** Navy conveys trust and stability (right for money); one strong accent (a confident blue) drives primary actions and focus. Sharp, intentional — not a timid even spread of pastels, and emphatically not purple-on-white gradients.

- **Real typographic personality.** A characterful but highly legible humanist sans for the UI, paired with a tabular, monospaced face for all numbers and codes (sale IDs, money, rep codes) so financial data aligns and reads cleanly. No Arial/Inter defaults.

- **Structured density.** Operations users prefer seeing more at once over excessive whitespace; the system uses a compact-but-breathable rhythm — dense tables, tight forms, clear grouping — without feeling cramped.

- **Calm surfaces, decisive accents.** Mostly neutral surfaces so data and status colours carry meaning; colour is reserved for state, action, and brand — never noise.

> **Light & dark, both first-class**
> Both a light and a dark theme are specified as co-equal (§3.5). Light is the primary default for dense data legibility in office settings; dark is fully defined for low-light comfort. The token architecture means the two are the same components with swapped token values — no component changes — and users pick Light / Dark / System with the choice saved per-user.

## 3. Foundations — Colour

All colour is referenced through --token CSS variables; components never hard-code hex. Values below are a concrete, buildable starting palette to refine on first render.

### 3.1 Brand & accent

| **Token** | **Hex** | **Usage** |
|---|---|---|
| --brand-900  | #13213D | Primary brand navy. App chrome, headers, primary text on light. |
| --brand-700  | #1E335C | Navy mid. Secondary surfaces, sidebar.                          |
| --accent-600 | #2563EB | Primary accent. Primary buttons, active nav, focus, links.      |
| --accent-700 | #1D4FD7 | Accent pressed/hover.                                           |
| --accent-50  | #EAF1FE | Accent tint. Selected rows, subtle highlights.                  |

### 3.2 Neutrals (surfaces & text)

| **Token** | **Hex** | **Usage** |
|---|---|---|
| --surface-0      | #FFFFFF | Page background / cards.                  |
| --surface-1      | #F6F8FB | App background behind cards; table zebra. |
| --surface-2      | #EDF1F6 | Inset panels, disabled fills.             |
| --border         | #D8E0EA | Default borders, dividers.                |
| --text-secondary | #5B6B80 | Secondary/label text, captions.           |
| --text-primary   | #1B2536 | Primary text.                             |

### 3.3 Semantic status (used consistently everywhere)

| **Token** | **Hex** | **Usage** |
|---|---|---|
| --success    | #047857 | Validated, approved, paid, positive deltas.    |
| --success-bg | #E7F5EF | Success badge/row background.                  |
| --warning    | #B45309 | Pending, awaiting action, proposed/flagged.    |
| --warning-bg | #FEF3E2 | Warning background.                            |
| --danger     | #B91C1C | Errors, clawbacks, deletions, negative deltas. |
| --danger-bg  | #FBEAEA | Danger background.                             |
| --info       | #1E66A8 | Informational, neutral notifications.          |

> **Status colour is semantic, not decorative**
> Green always means good/positive/complete; amber always means pending/attention; red always means error/negative/clawback. Never use a status colour for mere decoration — users learn the mapping and rely on it for money decisions. Always pair colour with text or an icon (never colour alone) for accessibility.

### 3.4 Data-visualisation palette

A distinct categorical sequence for charts (kept separate from semantic status so a chart series is never confused with a status). Use in order; ensure colour-blind-safe pairings and always label series directly.

| **Token** | **Hex** | **Usage** |
|-----------|----------|---------------------|
| --chart-1 | #2563EB | Series 1 (primary). |
| --chart-2 | #0E9F8E | Series 2.           |
| --chart-3 | #C026D3 | Series 3.           |
| --chart-4 | #D97706 | Series 4.           |
| --chart-5 | #475569 | Series 5 / ‘other’. |

### 3.5 Dark theme (co-equal)

Dark mode is a first-class theme, not an afterthought. Every token above has a dark-mode value; components reference the token name only, so switching theme swaps values with **no component changes**. The dark surfaces below are tuned for low-light comfort while preserving the same semantic meaning (green=good, amber=pending, red=clawback/error) and AA contrast. Brand navy inverts to a deep near-black surface; the accent blue is lightened slightly so it remains vivid on dark.

| **Token** | **Hex** | **Usage** |
|---|---|---|
| --surface-0      | #0E1525 | (dark) Page background / cards.                   |
| --surface-1      | #151D30 | (dark) App background behind cards; table zebra.  |
| --surface-2      | #1E283D | (dark) Inset panels, disabled fills.              |
| --border         | #2C3850 | (dark) Borders, dividers.                         |
| --text-secondary | #9AA8BD | (dark) Secondary/label text.                      |
| --text-primary   | #E8EDF4 | (dark) Primary text.                              |
| --accent-600     | #3B82F6 | (dark) Primary accent (lightened for dark).       |
| --success-bg     | #1B2D22 | (dark) Success background (status hue preserved). |
| --warning-bg     | #33260F | (dark) Warning background.                        |
| --danger-bg      | #341A1A | (dark) Danger background.                         |

> **Theme selection & persistence**
> Users choose **Light / Dark / System** from a toggle in the top-bar user menu and in My Account › Preferences. **System** follows the OS setting via prefers-color-scheme. The choice is saved per-user server-side (theme_preference on the user record) so it follows the user across devices, and applies instantly with no review and no reload. The very first paint reads the stored/last preference to avoid a flash of the wrong theme.

## 4. Foundations — Typography

Two families. A characterful humanist sans for all UI text, and a tabular monospace for numbers, money, and codes so financial columns align perfectly. (Final font licences confirmed at build; the choices below are the intended character — distinctive and legible, never Arial/Inter defaults.)

| **Role**           | **Family (intended)**                             | **Use**                                                                                |
|--------------------|---------------------------------------------------|----------------------------------------------------------------------------------------|
| UI / body          | A humanist sans (e.g. ‘Figtree’/‘Geist’-class)    | All labels, body, buttons, nav, table text.                                            |
| Display / headings | Same family, heavier weights                      | Page titles, section headers, KPI numbers.                                             |
| Numeric / mono     | A tabular monospace (e.g. ‘JetBrains Mono’-class) | Money, counts, sale IDs, rep codes, dates in tables — tabular figures so digits align. |

### 4.1 Type scale (rem, 16px base)

| **Token**   | **Size** | **Weight** | **Use**                                                                         |
|----------|------------|---------------------------------------------------------------------------------|
| --text-xs   | 12px     | 500        | Captions, table meta, badges.                                                   |
| --text-sm   | 13px     | 400/500    | Dense table cells, secondary text, form help.                                   |
| --text-base | 14px     | 400        | Default body and form inputs (14px is the operations default — denser than 16). |
| --text-md   | 16px     | 500        | Emphasised body, card titles.                                                   |
| --text-lg   | 20px     | 600        | Section headers.                                                                |
| --text-xl   | 26px     | 700        | Page titles.                                                                    |
| --text-2xl  | 34px     | 700        | Dashboard KPI numbers (mono, tabular).                                          |

- **Line-height:** 1.4–1.5 for body, 1.2 for headings and KPI numbers.

- **Tabular figures:** all numeric/money/code uses the mono family with tabular figures so columns align and totals are scannable.

- **Never centre long text;** left-align body and table text. Right-align numeric columns (money, counts).

## 5. Foundations — Spacing, Grid, Radius, Elevation, Motion

### 5.1 Spacing scale (4px base)

--space-1=4 --space-2=8 --space-3=12 --space-4=16 --space-5=24 --space-6=32 --space-8=48 --space-10=64. All margins, padding, and gaps use these tokens — no arbitrary pixel values.

### 5.2 Layout grid

- **App shell:** a fixed left sidebar (collapsible) + top bar + scrollable content region. Content max-width ~1440px on large screens; full-bleed tables allowed.

- **Content grid:** 12-column fluid grid, 24px gutters; forms typically span 6–8 columns, dashboards use responsive KPI/chart tiles.

- **Density:** compact-but-breathable. Table row height 40px default / 32px ‘dense’ toggle; form field height 38px.

### 5.3 Radius & elevation

--radius-sm=6 --radius-md=10 --radius-lg=14. Cards and inputs use md; pills/badges use full. Elevation is restrained: --shadow-1 (subtle, cards), --shadow-2 (dropdowns/popovers), --shadow-3 (modals). Avoid heavy drop shadows — borders carry most separation.

**Z-index ladder (the ONE source of truth — `styles/theme.css`).** A single ordered scale so floating layers never collide: `--z-sticky 100 < --z-overlay 1100 (modal/drawer scrim) < --z-modal 1200 (modal/drawer content) < --z-dropdown 1300 = --z-popover 1300 (dropdown/select/popover menus — ABOVE modal so a menu opened inside a modal isn't clipped behind it) < --z-toast 1400 < --z-tooltip 1500`. Menus are portaled to `<body>` and capped to the available height (`max-height: var(--radix-*-content-available-height)` + scroll), so a long list (e.g. 13 pay periods) scrolls instead of rendering off-screen.

### 5.4 Motion

- **Fast and purposeful:** 120–180ms for hovers/toggles, 200–260ms for panels/modals, with an ease-out curve. Motion confirms an action or guides attention — never decorative delay.

- **Respect reduced-motion:** honour prefers-reduced-motion; disable non-essential animation.

- **One orchestrated load, not scattered jitter:** a brief staggered reveal on first dashboard load is fine; avoid animating every row on every render.

### 5.5 Iconography

A single consistent line-icon set (one library, one stroke weight). Icons always accompany a label for primary actions; icon-only buttons must have an accessible tooltip/label. Consistent sizing: 16px inline, 20px buttons, 24px nav.

## 6. Component Library

Every screen is built from these components. Each lists its variants and required states. “All states” = default, hover, focus (visible ring), active/pressed, disabled, and where data-bound: loading, empty, error, success.

### 6.1 Buttons

| **Variant**         | **Use & spec**                                                                                                     |
|---------------------|--------------------------------------------------------------------------------------------------------------------|
| Primary             | Accent fill, white text. One primary action per view (e.g. Save, Run Pay Run). Loading shows a spinner + disabled. |
| Secondary           | Outline/neutral fill. Secondary actions (Cancel, Back).                                                            |
| Tertiary / ghost    | Text-only with hover tint. Low-emphasis inline actions.                                                            |
| Destructive         | Danger colour. Delete, clawback entry; always paired with a confirm dialog.                                        |
| Icon button         | Square, icon-only, tooltip required. Row actions, toolbar.                                                         |
| Split / menu button | Primary action + dropdown of related actions (e.g. Export ▾).                                                      |

**Sizes:** sm (28px), md (38px default), lg (44px). **States:** all states required; disabled is non-interactive with reduced contrast; loading replaces label with spinner and blocks re-click.

### 6.2 Form controls

| **Control**                 | **Spec & behaviour**                                                                                                                                   |
|-----------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| Text / number input         | Label above, optional helper below, 38px height. Number/money inputs use mono tabular, right-aligned, with currency prefix. Inline validation on blur. |
| Textarea                    | Auto-grow to a max; character counter when limited.                                                                                                    |
| Select / dropdown           | Native-feeling custom select; search filter when \>8 options; keyboard navigable; clear selected state. Used for client, product, field manager, etc.  |
| Multi-select / tags         | Chips for selected values; removable; used for filters and role/module grants.                                                                         |
| Combobox / autocomplete     | Type-ahead with async results; used for customer/address lookup and import reconciliation matching.                                                    |
| Radio group                 | For mutually exclusive small sets (e.g. Single trip / Round trip). Large hit target; selected state obvious.                                           |
| Checkbox                    | Single (e.g. greenfield request) and multi; indeterminate state for ‘select all’ in tables.                                                            |
| Toggle / switch             | Boolean settings (e.g. email channel on/off per event). Immediate effect with toast confirmation.                                                      |
| Date / date-range picker    | Calendar; presets (this pay cycle, last cycle, custom). Defaults to current pay cycle in expense/sales filters.                                        |
| Stepper / segmented control | For discrete modes (e.g. dense/comfortable table, dashboard period).                                                                                   |

**Validation pattern:** inline, specific, and adjacent to the field (“Rep code already in use”, not “Invalid input”). Error state = danger border + message + icon. Success/confirmed fields may show a subtle check. Forms never submit silently — disabled until valid or show errors on attempt.

### 6.3 File upload

- **Drag-and-drop zone + browse button;** shows accepted types/size. Used for receipts, rep documents, signable documents, and import files.

- **Per-file progress,** thumbnail/preview for images and PDFs, remove/retry per file, and clear error states (wrong type, too large, failed upload).

- **Receipt capture:** on mobile width, offer camera capture; receipts are mandatory for all expense categories except the km log (enforce in UI).

### 6.4 Tables & CRUD (the workhorse)

Tables are the most-used surface (sales, expenses, clawbacks, ledger, imports). One powerful, consistent table component.

- **Columns:** sortable; numeric/money right-aligned in mono; status as badges; sticky header on scroll; optional pinned first column.

- **Filtering:** a filter bar (date-range, rep, client, type, status) with active-filter chips; default filters per screen (e.g. current pay cycle).

- **Bulk actions:** row checkboxes + ‘select all’ (indeterminate); a contextual action bar appears when rows are selected (e.g. bulk validate).

- **Pagination:** server-side, page size selector; large lists virtualised for speed.

- **Row actions:** inline icon buttons + an overflow menu (view, edit, delete, etc.), gated by permission.

- **Inline editing** only where safe (never on frozen/paid financial snapshots); otherwise open a detail drawer/page.

- **Empty, loading, error states:** skeleton rows while loading; a helpful empty state with a primary action; a clear retry on error.

> **Implemented as `<DataTable>` (the shared list surface).** One component over the Table primitives delivers all of the above plus: **server-side** pagination/sort/filter/free-text search (the `?page=&limit=&sort=&search=` → `{ data, meta }` contract; lists never load whole tables client-side), controlled bulk-select + a contextual action bar (RBAC-gated), per-row view/edit/delete actions, and a dedicated **forbidden** state (a restricted role sees a friendly panel, never "Failed to load"). Adopted on Clients, Products, and Sales as the reference. Date inputs are the controlled token-styled **DatePicker** (always `YYYY-MM-DD`); effective-dated config uses a **pay-period selector** (§ BRD 9.4). Lists export to CSV/Excel/PDF + Print, respecting the active filters/selection.

### 6.5 Containers & overlays

| **Component**         | **Use**                                                                                                                                                      |
|-----------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Card / panel          | Groups related content; subtle border + --shadow-1. KPI tiles are cards.                                                                                     |
| Tabs                  | Within a detail view (e.g. Rep: Profile / Documents / Equipment).                                                                                            |
| Modal / dialog        | Focused tasks and all confirmations (delete, clawback, finalize pay run). Traps focus; Esc + explicit buttons; destructive confirms restate the consequence. |
| Drawer / side panel   | Detail or quick-edit without leaving the list (e.g. sale detail, expense item).                                                                              |
| Popover / menu        | Row overflow actions, column settings, quick filters.                                                                                                        |
| Toast / snackbar      | Transient success/error feedback (‘Expense approved’, ‘Pay run finalized’). Never for critical errors that need a decision — use a dialog.                   |
| Banner / inline alert | Persistent context (e.g. ‘This sale is paid — snapshots are locked’, ‘Proposed rule — confirm with Redwave’).                                                |
| Tooltip               | Icon-button labels, truncated text, definitions (tier, tally).                                                                                               |

### 6.6 Navigation & chrome

- **Left sidebar:** module navigation, grouped, with icons + labels; collapsible to icons; shows only modules the role can access (RBAC-driven). Active item uses accent.

- **Top bar:** global search, current pay-cycle indicator, notifications bell (in-app), user menu, environment badge (staging/prod).

- **Breadcrumbs:** GLOBAL and route-driven — the shell renders one `<nav aria-label="Breadcrumb">` trail on every authenticated screen (below the top bar, above the page title), built from route metadata in `frontend/src/routes/crumbs.ts` (label + logical `parent` + optional permission per route path). A NEW ROUTE registers its crumb by adding an entry there (a dev console warning fires otherwise); pages never hand-assemble breadcrumbs. Detail routes resolve entity names from the page's own query cache (skeleton while loading, truncated id on failure); unpermitted ancestors render as text; long labels truncate with a title tooltip; narrow widths collapse middle segments to "…".

- **Header (page):** title + primary action(s) + contextual tabs/filters.

- **Footer (app):** minimal — version, environment, support link; not a marketing footer.

### 6.7 Status, badges & indicators

Status badges use the semantic palette + a label (never colour alone): Entered (neutral), Validated (success), In Pay Run (info), Paid (success-strong), Clawed Back (danger), Deleted (muted), Pending (warning). Deltas show ▲/▼ with success/danger. A consistent ‘Proposed — confirm’ chip marks the SRS-flagged rules in config screens.

## 7. States, Feedback & Edge Cases

Every data-bound view specifies five states. This is non-negotiable — the most common UX failure is shipping only the ‘happy path’.

| **State**         | **Treatment**                                                                                                                                            |
|-------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| Loading           | Skeleton placeholders matching the eventual layout (not a bare spinner) for lists, tables, dashboards; inline spinners for button actions.               |
| Empty             | A purposeful empty state: a one-line explanation + a primary action (e.g. ‘No sales this cycle yet — Enter a sale’). Never a blank screen.               |
| Error             | Clear, human message + a retry; preserve user input; never lose a half-filled form. Distinguish validation (fixable) from system errors (retry/support). |
| Success           | Toast for transient confirmations; inline confirmation for in-context actions; navigate or refresh data as appropriate.                                  |
| Partial / pending | Show in-progress clearly (e.g. import staging, pay-run draft, signature pending) with what’s outstanding and the next step.                              |

> **Money & destructive actions get extra care**
> Finalising a pay run, entering a clawback, deleting a sale, and committing an import all use a confirmation dialog that **restates the consequence in plain language** (e.g. “This will deduct $145 from — ’s next pay run”) and, for the heaviest actions, a typed or explicit confirm. Optimistic UI is fine for low-risk actions, never for money-moving ones — those wait for server confirmation.

## 8. Responsiveness & Mobile

Built mobile-first in behaviour even though primary use is desktop, so the future mobile app shares patterns and field reps can work on phones.

| **Breakpoint**      | **Behaviour**                                                                                                                                                                                 |
|---------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Mobile (\<640px)    | Sidebar becomes a drawer; tables become stacked cards or horizontally scroll with a pinned key column; forms single-column; primary action as a sticky bottom button; camera receipt capture. |
| Tablet (640–1024px) | Collapsible icon sidebar; two-column forms; tables scroll with pinned column.                                                                                                                 |
| Desktop (\>1024px)  | Full sidebar + multi-column dashboards and dense tables; the primary working environment.                                                                                                     |

> **Implemented (app shell).** Breakpoints are `--bp-mobile: 640px` / `--bp-tablet: 1024px` (read in JS via `lib/useMediaQuery`). The shell is responsive: **>1024px** full sidebar (user-collapsible); **640–1024px** auto-collapsed icon rail; **<640px** the sidebar is hidden and the top-bar hamburger opens it as an off-canvas drawer (focus-trapped, scrim, Esc) that auto-closes on navigation; data tables get horizontal scroll. Resolves the prior sidebar-overlaps-content defect at narrow widths.

- **Touch targets ≥ 44px on mobile;** hover-only affordances always have a tap equivalent.

- **The rep flows** (enter sale, submit expense with receipt photo, view dashboard, sign a document) are fully usable on a phone — these are the field-use cases.

## 9. Accessibility

| **Area**             | **Requirement**                                                                                                                         |
|----------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| **Contrast**         | Text meets WCAG AA (4.5:1 body, 3:1 large); status never conveyed by colour alone — always with text/icon.                              |
| **Keyboard**         | Every interactive element reachable and operable by keyboard; logical tab order; visible focus ring (accent) on all focusable elements. |
| **Labels**           | All inputs have associated labels; icon-only buttons have aria-labels; tables have proper headers.                                      |
| **Focus management** | Modals/drawers trap focus and restore it on close; skip-to-content link.                                                                |
| **Announcements**    | Toasts and async results announced to screen readers (aria-live); form errors associated with fields.                                   |
| **Motion**           | Honour prefers-reduced-motion.                                                                                                          |

## 10. Key Screen Blueprints

How the system and components compose into the highest-traffic screens. These are layout intents, not pixel mockups — the rendered designs are refined from here.

### 10.1 Dashboards

- **Rep dashboard:** a row of KPI tiles (sales by product, current tier + ‘N to next tier’ progress bar, estimated commission, pending holdback), a recent-activity table, and the leaderboard position. Calm, motivational, own-data only.

- **Manager dashboard:** roster KPI tiles (team sales, pending validations, expenses awaiting approval, team-vs-target) with drill-down lists scoped to the manager’s reps.

- **Business/Executive dashboard (Super Admin):** revenue, payout, net margin, holdback liability, clawback totals as KPI tiles; trend and breakdown charts (by client/product/rep/period) using the chart palette; date/client/product/rep filters; export. Dense but readable.

- **Admin operational home:** action queues, not charts — ‘pending validations’, ‘expenses to approve’, ‘cycle status’, ‘statements due’, each a count + a jump-in link.

### 10.2 Sale entry & validation

- **Entry:** a focused form — client dropdown, product selector (per-client), customer/address, MPU ID, sale date, greenfield checkbox — with a live Sale ID preview and inline validation. Fast keyboard flow for high-volume entry.

- **Validation queue:** a dense table with bulk-select, status badges, greenfield confirm toggle, client-report match indicators, and inline approve/edit/delete; the bulk-validate action opens the import-match flow.

### 10.3 Pay run

- **Run view:** period selector → a per-rep table of computed lines (70% advance, released 30%, expenses, bonus, clawback, net), with a clear total and a prominent, guarded Finalize action; line drill-down drawer.

- **Finalize:** confirmation dialog restating totals and the irreversible snapshot-freeze; idempotent on the server.

### 10.4 Expenses (item-first)

- **Add expense:** category picker → per-category form (km log with Places-autocomplete map stops + auto distance + single/round toggle; meals/hotel/flight/rental/gas/other with amount + mandatory receipt **upload**). “Add another item” captures **several items at once** — no weekly report to fill in first. Sensible defaults (date = today, rep = self). Where no Maps key is set, the km form falls back to manual address + total-km entry.

- **List, group & approval:** a paginated **DataTable** of items (default current cycle) with filters (status/category/rep/client/date/search) and a **grouping** control (daily/weekly/monthly/custom) that drives an at-a-glance summary strip + the export. Approvers get row-select → a **bulk** approve/reject/send-back bar (and a per-item Approvals queue); per-row View/Edit/Delete via a kebab (edit-gating EXP-007). Export to PDF/Excel/CSV (per-item or grouped buckets) plus a server-recorded export for the per-rep KM-log client submission. Money is right-aligned mono; the KM amount is server-authoritative (the on-form preview is indicative only).

### 10.5 Data import & documents

- **Import:** upload → mapping → staging preview table (matched/unmatched/error counts + per-row issues) → reconciliation → guarded commit with the reconcile check. A wizard-style stepper.

- **Documents/e-sign:** document list with status; PDF upload; an **in-browser PDF preview** (pdf.js, lazy-loaded) of the original + signed copies, with download. The share/request dialog (one or many recipients) lets the sender **place fields** (signature/initial/date/text) per recipient on the document (drag to move, corner to resize). A clean **in-system signing view** previews the document with the signer's fields highlighted and applies a signature (a saved one, drawn on a signature pad, or typed) — or uploads an externally-signed file. Per-signer status with audit metadata; a fully-signed copy on completion. Saved reusable signatures are managed under **My Account → Signatures**.

### 10.6 Settings, My Account & profile review

Two distinct areas, clearly separated so personal settings are never confused with org-wide administration.

- **My Account (every user):** a tabbed area — Profile, Security, Preferences, Notifications. Profile shows the user’s details with editable HR fields (name, phone, avatar) that, on save, submit a change request rather than editing live: the field shows its current value with a ‘change pending review’ chip until approved. Security holds password change and active-session sign-out. Preferences holds the Light/Dark/System theme toggle (applies instantly) plus other personal preferences. Notifications is a read-only list of what the user receives.

- **Profile-change review (reviewers):** a queue showing each pending request with current-vs-proposed values side by side and Approve / Reject actions; routed to the rep’s Field Manager/Admin, or to Super Admin for everyone else. Approving applies the values and notifies the user.

- **Administration / System Settings (role-gated):** a single home that groups the org-wide configuration — roles & permissions, users, commission tiers/rates, holdback release, incentives, clients/products, expense categories, notification routing, chatbot — each as a clearly labelled card linking to its editor. Visible only to roles granted access.

- **The theme toggle** also appears in the top-bar user menu for quick access; both entry points write the same per-user preference.

> **Profile edit = request, not direct write (UX rule)**
> When a user edits an HR profile field, the UI must make clear the change is **submitted for review**, not saved live: a confirmation that the request was sent, the field showing the old value with a ‘pending review’ indicator, and a way to see the request’s status. The theme preference is the deliberate exception — it applies immediately with no review, and the UI should reflect that instant change.

## 11. Implementation Notes

- **Tokens as CSS variables;** a single theme file is the source of truth. Components consume tokens only — no hard-coded hex, px, or font names.

- **One component library,** built once and reused (consider a headless-accessible base for behaviour + the design tokens for styling). The SRS screen specs map onto these components.

- **Typed API client** generated from the OpenAPI contract; loading/error/empty states wired to real request states.

- **Performance budget:** code-split by route/module; virtualise large tables; lazy-load charts; target fast first paint and instant navigation.

- **This document is v1 for review.** The aesthetic (exact colours, fonts, density) is finalised by reviewing the first rendered screens against these specs and adjusting tokens — not by rebuilding components.

*End of Frontend Design System & UI Specification v1.0 (draft for review)*
