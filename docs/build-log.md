# Redwave build log — what each batch established

The per-batch record of how the frontend and its supporting endpoints were built, in **build
order (oldest first)**. Each entry is the note written when that batch shipped: what it built, the
decisions and their reasons, the bugs it fixed and why they happened, the migration it needs, and
how it was verified.

## How this relates to `CLAUDE.md`

| Read this | For |
| --- | --- |
| **`CLAUDE.md` §13** | The **durable conventions** — the rules you must follow when writing new code. That is the short, always-loaded file. |
| **This file** | The **history and rationale** — why a convention exists, what a batch changed, which migration it added, what it left deferred. |

`CLAUDE.md` is loaded into context at the start of every session; this file is not. So §13 holds
the rules, and this file holds the reasoning behind them. **When the two disagree, `CLAUDE.md`
wins** — it is maintained; entries here are a point-in-time record and are not rewritten when a
later batch supersedes them.

Read the relevant entry here **before** reworking an area: it usually explains why the obvious
simpler approach was already tried and rejected. Several entries record bugs whose causes are
genuinely non-obvious (the silent Excel export, the `download (5).xlsx` CORS header, the
premature-logout refresh, the double-scroll tables) — those are the most valuable pages here.

## Conventions inside an entry

- **"Verified LOCAL"** = the §2.5 verification gate was run and passed at that commit. It is a
  historical record, not a claim about the current tree.
- **"Operator: `migrate deploy`"** = that batch shipped a migration someone must apply. Migrations
  are cumulative and already listed under `backend/prisma/migrations/`.
- **"Browser pass"** = what a human still needed to check by eye (light/dark, live data, maps,
  real files). Where an entry says a visual pass was *not* done, it was not done at that time.
- **`#N`** refers to the numbered invariants in `CLAUDE.md` §3; **`§N`** to a `CLAUDE.md` section;
  `SALE-001a` / `EXP-014` / `BILL-012`-style ids to requirements in `docs/SRS.md`.

## Entries

1. Brand assets & the `Logo` component (built — real Redwave mark, tokenized + themed)
2. `LoadingSpinner` — the branded loading animation (built; visual-only)
3. Auth / session (built — login flow)
4. Screen patterns (built — Sales cluster is the reference; COPY these for every later screen)
5. Typed responses & the error envelope (built — Batch A #2; the contract now carries response schemas)
6. Dashboards, charting & notifications (built — reporting read-layer; reuses the Sales playbook)
7. Account & Settings (built — Session 1: My Account + Administration hub + profile-change-review)
8. Administration admin CRUD (built — Session 2: Users · Role builder · Notification-settings editor)
9. Expenses (built — ITEM-FIRST: DataTable list, multi-add, KM maps, real receipts, per-item bulk approval, grouped export)
10. Clients & Products + the EFFECTIVE-DATING UI (built — Admin Config Session 1; Commission Config = Session 2)
11. Commission Config + the TIER-BRACKET editor (built — Admin Config Session 2)
12. Pay Run UI (built — the money orchestrator's review-and-commit surface)
13. Clawback UI (built — enter a recovery against a paid/frozen item + list pending→applied)
14. Billing & Statements UI (built — generate + view the client statement & commission invoice per client·period)
15. Documents & E-Signature UI (built — REAL: PDF upload · preview · field placement · in-system signing · download)
16. Data Import & Integration UI (built — REAL upload → map → reconcile → commit wizard + templates)
17. Chatbot UI (built — the FINAL screen; a thin surface over the leak-proof, intent-only assistant)
18. Shared data primitives + the SERVER-SIDE list contract (built — adopt these on every new list/form)
19. Notifications overhaul + SA event management/broadcast + dead-tab fixes (built — Notifications batch)
20. Configurable product types · rate-card CRUD · client custom fields · commission CRUD (built — Config batch)
21. Dashboards & Reporting overhaul (built — Operations queues · Business KPIs · trends · scoped Manager/Rep · greenfield)
22. Holdback release rule · dual-mode incentives · password reset/invite + email · team management (built)
23. Security hardening — cookie/CSRF · helmet/CSP · MFA · sessions · Swagger lock · audit view · rate-limit · PII (built)
24. Billing — gapless numbering · immutability · reconciliation · QuickBooks (built — Billing batch)
25. Bundle-bonus pricing into statement/invoice totals (built — configurable trigger, client-bill only)
26. Client expense billing document — split billing (built — BILL-012 / EXP-014, migration `20260617000000`)
27. Per-type expense fields + Alert/Warning validation (built — EXP-002a / EXP-013, migration `20260618000000`)
28. Report-as-folder expense rework (built — EXP-001, Meeting 3, migration `20260619000000`; SAP Concur folder model)
29. RBAC governance for admin surfaces + system-wide double-scroll fix (built — NO migration; seed-only)
30. Per-client commission rates + the client price chart (built — review items 5/12/19; migration `20260622000000`)
31. Weekly client billing + the wide statement line (built — review items 4/7/8/9; migration `20260623000000`)
32. Export naming, the sales export shape, and sale-detail navigation (built — review items 6/10/11; NO migration)
33. Expense UAT batch — office origin · per-unit caps · one folder per week · category grouping (built — items 13-18; migration `20260624000000`)
34. Import — value vocabulary, multi-type rows, sheet/header detection, dry-run preview, opt-in create-missing (built — items from the UAT file; migration `20260625000000`)

---

### Brand assets & the `Logo` component (built — real Redwave mark, tokenized + themed)
The real two-tone logo (orange wave + "Red" / black "wave marketing") replaced the placeholder "R" marks.
- **`Logo`** (`components/ui/Logo.tsx`, barrel-exported): inlines the SVG via **`svgr`** (`import … from
  '…svg?react'`; added `vite-plugin-svgr` with `svgrOptions:{svgo:false}` + the `vite-plugin-svgr/client`
  type ref in `vite-env.d.ts`). Props: `variant 'full'|'mark'`, `size 'sm'|'md'|'lg'` (heights 20/28/40px),
  `title`, `decorative`. Used in the **Sidebar** (`full`, `mark` when collapsed, `decorative`) and **Login**
  (`full`); **TopBar/AppShell carry no logo** (brand lives in the always-visible sidebar). In the showcase.
- **The dark-theme treatment (the design decision):** the logo "ink" (wordmark + lower wave) is
  **`currentColor`**, so it inherits each placement's text token — light on the navy sidebar (which is navy in
  BOTH themes via `--on-brand`), near-black/near-white on the theme-flipping login card (its `.brand` sets
  `color: var(--text-primary)`). The orange is the **constant** token **`--brand-orange: #ff6600`** (added to
  theme.css `:root`, like `--on-accent`; legible on white, navy, and dark). Two SVGs in
  `assets/brand/` (`redwave-logo.svg` full, `redwave-mark.svg` icon-only) are edited to be themeable: root
  `fill="currentColor"` (ink inherits) + orange paths `style="fill:var(--brand-orange)"` (no `<style>`/`<defs>`;
  svgo off keeps them). **No hard-coded hex anywhere but the brand SVGs + theme.css** (stylelint-clean).
- **Convention:** **`src/assets/brand/`** = themeable in-app brand assets (logo + mark variants; future client
  logos — VF/RF/CTI), consumed via `?react` + `Logo`. **`public/`** = static, fixed-colour browser/OS artifacts:
  `favicon.svg` (square, orange-only mark — reads on any tab bar) + the raster set (`favicon.ico`,
  `apple-touch-icon.png`, `icon-192/512.png`, `site.webmanifest`) **generated by `npm run gen:icons`**
  (`scripts/gen-icons.mjs`, via `@resvg/resvg-js` + `to-ico`; navy tile bg). `index.html` links them + sets
  `theme-color`. Re-run `gen:icons` if the mark changes. **Verified:** stylelint + build (svgr/tsc) + lint green.

### `LoadingSpinner` — the branded loading animation (built; visual-only)
The plain-text/placeholder loading states were replaced by the branded SMIL-animated SVG (`assets/brand/
loading.svg` — a hand + bouncing "LOADING" letters). **`components/ui/LoadingSpinner.tsx`** (barrel-exported):
inlined via svgr (`?react`, the `Logo` convention), props `size 'sm'|'md'|'lg'` (48/96/160px square) + `label`
(a11y, default "Loading", on a `role="status"` wrapper). **Theme-safe:** the gray `#444444` "LOADING" ink was
swapped to `currentColor`, driven by the wrapper's `color: var(--text-secondary)`, so it's legible on BOTH
themes; the blue hand keeps its own colours; the SMIL animation is preserved (svgo off). The art already reads
"LOADING", so callers add NO separate text label. **Used at the two genuine full-area spinner spots only:** the
route-level **Suspense fallback** (`routes/router.tsx`) and the **session boot** (`auth/SessionLoading.tsx`,
which also dropped its stale "R" placeholder + CSS spinner). **Deliberately left as purpose-built indicators:**
table/`Skeleton`/`TableSkeleton` (the `DataState` loading default), the `Button` inline spinner, and the
chatbot "thinking" dots — the big "LOADING" illustration would be wrong in those micro/skeleton contexts. In the
showcase. **Note:** the motion is SMIL, so `prefers-reduced-motion` doesn't gate it (a property of the asset).

### Auth / session (built — login flow)
Login, the session, protected routes, the convenience-only permission gate, and the server theme-sync
are wired (`frontend/src/auth/`, `pages/login/`). Verify: backend up + seeded, `npm -w frontend run dev`,
sign in as `superadmin@redwave.local` / `DevSuperAdmin!123`.

- **UI permission-gating is CONVENIENCE ONLY — the server is the real gate (§5).** `useAuth().permissions`
  (the `effective_permissions` from `/v1/auth/me`) drives routing + `useCan(perm)` / `<Can permission>`,
  which only hide/show UI. The backend RBAC guard rejects any unpermitted call with 403 + audit
  regardless of what the UI renders. Every `useCan`/`<Can>` carries this caveat in-code.
- **Token storage:** access token **in-memory** (`api/auth-store`); refresh token in **`localStorage`**
  (`redwave-refresh`) so a reload silently re-authenticates (`auth/session.ts`). Tradeoff accepted for an
  internal ERP. **`auth/session.ts`** owns: token storage, a **single-flight `refreshAccessToken`**,
  `clearSession`, and the `onSessionExpired` callback (how the non-React client signals React).
- **Refresh = SILENT; only a DEFINITIVE 401/403 logs you out (never a 5xx/network).** `doRefresh()` returns
  a discriminated `RefreshResult` (`{ok,token}` | `{ok:false, expired:true}` | `{ok:false, expired:false}`):
  refresh **200** → new access token, keep session; refresh **401/403** → `clearSession` + `expired:true`;
  refresh **5xx/408/429 or a network throw** → **transient, session KEPT** (`expired:false`). The `onResponse`
  401 interceptor (`api/client.ts`) runs a single-flight refresh and **retries the original request once**
  (raw `fetch`, excludes `/v1/auth/login|refresh|logout`, no loops); only `expired` calls `notifySessionExpired`
  → redirect to `/login`; a transient result **returns the original response without logging out**. On boot
  `AuthProvider` **retries a transient refresh** (~4×2s) to ride a Render cold start before giving up (and even
  then keeps the refresh token, so a later reload recovers). This fixed the "logged out within a minute" report
  — the cause was the old refresh clearing the session on any non-OK response, so a cold-start 503 nuked it; the
  JWT TTLs were fine (see §5 auth-stack note). `session.test.ts` (Vitest) covers 200/401/503/network. **Multi-tab**
  logout/expiry syncs via the `storage` event on the refresh key.
- **`AuthProvider`** (App.tsx order: `ThemeProvider › AuthProvider › QueryClientProvider › Tooltip › Toast
  › Router`) boots by restoring the session (refresh→`/me`, StrictMode-guarded), exposes
  `login`/`logout`/`setTheme`, and holds `{status, user, roles, permissions, isSuperAdmin}`; `logout` calls
  `queryClient.clear()` so the next session starts with no stale cache. **`RequireAuth`** is an element
  guard (loaders can't read context). Routes: `/login` (public) + protected `/` (home), `/showcase`, and
  the Sales cluster (`/sales`, `/sales/new`, `/sales/:id`).
- **Theme server-sync (loop closed):** on login the user's `theme_preference` from `/me` is applied
  locally; changing the theme while authed PATCHes `/v1/account/theme` (`useAuth().setTheme`, used by
  `ThemeToggle`); logged-out = local/System. No-flash boot preserved.
- **DONE (Security batch — see the §13 "Security hardening" subsection + `docs/security.md`):** the refresh
  token is now an **httpOnly, rotating, DB-backed cookie** (no longer in localStorage / the JSON body) with
  double-submit CSRF, `sid`-based immediate revocation, TOTP MFA, and active-session management. The
  password-reset flow is wired (AUTH-002). *(`@ApiResponse` typed responses are DONE, Batch A #2.)*

### Screen patterns (built — Sales cluster is the reference; COPY these for every later screen)
The Sales cluster (`frontend/src/features/sales/`) is the FIRST feature screen and sets the conventions.
Build new screens by copying its shape — don't invent a second pattern.

- **Feature-module folder shape:** `features/<name>/` = `sales.types.ts` (response types **aliased to the
  generated schema** + request DTOs re-exported from it — Batch A #2) · `api/keys.ts` (query-key factory) · `api/use*.ts`
  (queries + mutations + the list hook) · `components/` · `pages/` (one default-export per route). Keep a
  module's code under its folder; cross-module reads go through the typed client, not shared internals.
- **Server-state = TanStack Query** over the existing `openapi-fetch` `api`, via a thin
  **`unwrap<T>(api.GET(...))`** (`lib/query/unwrap.ts`) that ok-checks and casts (responses are
  `never`-typed — see below) and throws **`ApiError`** on failure. Query keys come from a **factory**
  (`salesKeys.list(filters)`); **mutations `invalidateQueries({ queryKey: salesKeys.all })` on success**.
  `queryClient` config: `staleTime 30s`, `retry 1`, no refetch-on-focus (`lib/query/queryClient.ts`).
- **Loading/empty/error = `<DataState>`** (`components/data/DataState.tsx`) wrapping the content — it
  renders the foundation `TableSkeleton`/`TableError`(with retry)/`TableEmpty` from `isLoading/isError/
  isEmpty`. **Errors → toast** via **`useApiErrorToast()`** (`lib/api/apiError.ts`): its handler is
  `(err) => void` so it drops straight into a mutation `onError` (extra RQ args ignored). Mutation
  success → an explicit `useToast()` call by the caller.
- **Forms = react-hook-form + zod** (`zodResolver`) wired to the foundation **`FormField`**: plain inputs
  use **`register`** (forwardRef `Input`/`Textarea`); Radix controls (`Select`/`MultiSelect`/`Checkbox`)
  use a **`Controller`**; `fieldState.error?.message` / `formState.errors.<f>?.message` → `FormField error`.
  Radix `Select` forbids an empty `value` — use a sentinel (`'__all__'`/`'__self__'`) mapped to `undefined`.
  See `SaleForm.tsx` (dependent client→products dropdown; live composite-ID preview).
- **List = server-side FILTERS + client-side sort/paginate**, isolated in one hook (`api/useSalesList.ts`,
  `PAGE_SIZE` 15). This is the **swap-seam**: when the backend adds list pagination, change only this hook.
  **Filter state lives in the URL search params** (page owns it via `useSearchParams`, passes
  `{filters, onChange}` to the filter bar) so a preset like `/sales?status=entered` is a shareable link
  (the sidebar "Validation" item IS that link). Bulk row-select → foundation `BulkActionBar`.
- **Detail = a deep-linkable route `/sales/:id`** (NOT a drawer) — `useParams` → a `*DetailView` that
  fetches + handles its own loading/error/not-found via `DataState`. This is the canonical detail pattern.
- **`useCan` + status gating is CONVENIENCE ONLY (§5).** Call `useCan(perm)` **unconditionally** (rules of
  hooks — never inside `&&` after a status check), then combine: e.g. `canValidate = status==='entered' &&
  useCanApprove`. The server re-authorizes every call; a hidden button is not security. Reads degrade
  gracefully when a permission is absent (e.g. the client column/dropdown only render with `clients:view`).
- **Sidebar routing:** items with a `to` render as `NavLink` (active via a `match(location)` predicate for
  query-param presets); screens not yet built stay disabled placeholders.
- **Breadcrumbs are GLOBAL + route-driven — NEW ROUTES MUST DECLARE CRUMB METADATA.** The shell renders ONE
  `RouteBreadcrumbs` trail (routes/RouteBreadcrumbs.tsx) on every authenticated screen from the registry in
  **`routes/crumbs.ts`** (label / dynamic entity kind / logical `parent` / optional permission per route
  path — the router is flat, so hierarchy comes from `parent` pointers; `withCrumbs` injects `handle.crumb`
  and WARNS in dev for a route without an entry). Adding a route = add its `crumbs.ts` entry; ad-hoc
  per-page breadcrumbs are FORBIDDEN (`PageHeader` no longer takes a `breadcrumbs` prop). Dynamic detail
  labels resolve via the page's OWN query hooks (same key → cache-shared, never a duplicate fetch;
  skeleton → truncated-id fallback in routes/crumbLabels.tsx); unpermitted ancestors render as text (§5).
- **Verified live** (seeded backend): full Sales write path 200/201 (create→`sale_date[-mpu]-client_code`,
  list+filters, get with derived pay period, greenfield toggle, single+bulk validate, soft-delete), 400 on
  a bad payload, and a **Sales-Rep token reads `/v1/clients` → 200** (the seed grant) with `/v1/sales`
  own-scoped. A rep create requires a Manager-role `field_manager_id`; the seed ships only a Super Admin
  (which has **no linked rep**, so it must create sales **on-behalf** with `rep_id`).
- **Backend follow-ups this surfaced:** (1) **`@ApiResponse` response DTOs** across modules so `gen:api`
  emits typed responses — **DONE (Batch A #2)**; every feature's `*.types.ts` now ALIASES the generated
  schema instead of hand-writing response shapes (see "Typed responses & the error envelope" below);
  (2) **server-side list pagination** for `/v1/sales` (returns a plain array today — hence the client-side
  seam) — still open, not blocking.

### Typed responses & the error envelope (built — Batch A #2; the contract now carries response schemas)
The OpenAPI contract used to declare request bodies but **no response schemas**, so `gen:api` emitted
`content?: never` and every feature **hand-wrote** its response types. Batch A #2 added `@ApiResponse`
response DTOs across **all ~22 controllers / ~65 endpoints**, regenerated the client, and re-pointed every
feature onto the generated types. Reuse these conventions for any new endpoint/feature.

- **Backend: one `*.response.ts` per module** (`modules/<m>/dto/*.response.ts`, ~50 DTO classes) — each
  field an explicit `@ApiProperty`. **Money/Decimal → `string` ALWAYS** (`@ApiProperty({ type: String })`;
  #1) — incl. non-money decimals (pct, km). Nullable/enum/nested fields carry an **explicit** `type`/`enum`/
  `type: () => Child` so swagger reflection never degrades them to `Record<string,never>`. **Free-form JSON
  blobs** (`payment_details`, import `raw_data`/`mapped_data`, `error_summary`, expense `scope_filters`) use
  `@ApiProperty({ type: 'object', additionalProperties: true })` (counts map →
  `additionalProperties: { type: 'number' }`); a KNOWN object shape (e.g. `proposed_changes`) is modeled as a
  real nested DTO, NOT a blob. Naming: `<Entity>Response` → `components['schemas']['<Entity>Response']`.
- **Error envelope is now per-endpoint.** `@ApiErrorResponses()` (`common/errors/api-error-responses.decorator.ts`,
  `applyDecorators`) attaches `ErrorEnvelopeDto` to 400/401/403/404/409/422 at the **controller-class level**
  (one line, cascades to every route) — closing the Batch A #1 gap. Success stays per-method
  (`@ApiOkResponse`/`@ApiCreatedResponse`, `isArray: true` for lists; `@ApiNoContentResponse` for 204).
- **Frontend: ALIAS, don't hand-write.** Every `features/*/*.types.ts` now does
  `export type Sale = components['schemas']['SaleResponse']` (type NAME kept → zero call-site churn). Enums
  derive from the contract (`SaleStatus = …['SaleResponse']['status']`). `unwrap<T>` keeps its cast signature
  (responses are now typed at the call site via the alias). **HRM has no frontend feature** → backend DTOs +
  annotations only, no re-point.
- **Request-quirk fixes (also Batch A #2):** `TierBracketDto.max_count` + import `rows`/`mapped_data` no longer
  regenerate as `Record<string,never>`, so the last hand-written request bodies + boundary casts were dropped.
  (Pre-existing `CreateRepDto`/`UpdateRepDto.payment_details` still regenerate as `Record<string,never>` — a
  REQUEST DTO with no frontend consumer; harmless, left as-is.)
- **Verified:** backend 61 suites/305 tests + lint green; `contract:export` (82 paths, +~50 schemas) →
  `gen:api` emits real response types (no field `Record<string,never>` regression); frontend build (tsc, the
  coupling guard) + lint green; live spot-checks across every module = **exact key parity** (money = string,
  nested shapes, JSON blobs, PII redaction, leaderboard money-free). **Deliberately NOT done:** per-endpoint
  `@ApiResponse` already covers success+errors, but a few action endpoints over-declare a field the runtime
  omits (e.g. Pay Run `setBonus` types the line WITH `rep`; the service returns it without — the UI only
  invalidates, never reads it) — acceptable, documented.

### Dashboards, charting & notifications (built — reporting read-layer; reuses the Sales playbook)
The four role-scoped dashboards, the counts-only leaderboard, and the notifications bell compose the
existing leak-proof Reporting endpoints. They REUSE the Sales playbook exactly; the ONE new pattern is
**charting**. Folders: `features/dashboards/` (+ `charts/`) and `features/notifications/`.

- **Charting = Recharts, themed via tokens (THE chart pattern).** Every series colour is a `var(--chart-N)`
  (`charts/chartTheme.ts` `CHART_SERIES`/`seriesColor`), NEVER a hard-coded hex — so charts adapt to
  light/dark for free. **`styles/theme.css` now defines `--chart-1..5` for BOTH themes** (the dark block
  lightens them; the light slate `--chart-5` is invisible on dark otherwise). `charts/ChartContainer.tsx`
  is the chrome shell (title + fixed-height body the recharts `ResponsiveContainer` fills);
  `charts/ThemedBarChart.tsx` is the reusable single-series bar (per-category colour via `<Cell>`, value
  printed on the bar, **series labelled directly — no legend box**, §3.4); `charts/ChartTooltip.tsx` is a
  token-styled tooltip replacing the library default. **Recharts is pinned to v3** — its `dataKey` is a
  strict `TypedDataKey`, so `ThemedBarChart` types `data` as an **open `Record<string,string|number>`**
  (NOT a generic `T`) so plain-string `categoryKey`/`valueKey` are accepted; charts are **lazy-loaded**
  with the dashboard pages so the ~350 kB recharts chunk never loads on other screens.
- **`StatCard` is a foundation component** (`components/ui/StatCard.tsx`, in the barrel): the design-system
  KPI tile (mono `--text-2xl` value + label + optional `Delta`/footnote). Use it for every KPI everywhere.
- **Money is display-only via `lib/format/money.ts`** — pure string grouping ("1234.5"→"$1,234.50"), **no
  float math** (#1). For charts, values are `Number()`-coerced ONLY to plot (never to compute money).
- **Role landing + nav.** `useAuth()` now exposes **`repId`** (from `/me`'s `rep_id`). The index route is
  `features/dashboards/pages/DashboardLanding.tsx` → `<Navigate>` by role: **SA→business · Admin→admin ·
  Manager→manager · linked rep→rep · else reports:view→leaderboard · else module-card home**. The Sidebar
  "Dashboards" group shows items per **access predicate** (Business=`isSuperAdmin`; Operations=admin/SA;
  Team=`reports:view`+admin/manager; My Dashboard=`!!repId`; Leaderboard=`reports:view`). All gating is
  convenience — the **server is the real gate (§5)**: each dashboard page treats a query **403** as a
  graceful `AccessDenied` (helper `isForbidden(error)` in `lib/api/apiError.ts`).
- **Business dashboard is SUPER ADMIN ONLY** (server-enforced); it has a pay-period selector
  (`usePayPeriods`, gated `payrun:view`). The endpoint returns single-period **scalars only**, so the chart
  is a single-period financial breakdown and a `<Banner>` states that **cross-period trend charts await a
  backend aggregation endpoint** (NOT faked by looping). **Leaderboard is counts-only** at the source — the
  UI renders rank/rep/activation_count with **no money column, ever** (smoke asserts no money key).
- **Notifications bell** (`features/notifications/NotificationsBell.tsx`, wired into `TopBar`): a Popover
  list of the caller's OWN notifications (own-scoped server-side); unread dot from `useNotifications({is_read:
  false})`; click an unread row → `PATCH /v1/notifications/{id}/read` → invalidate. **No mark-all** (no
  endpoint). Closes the in-app notification loop (signature events now surface here).
- **Verified live** (seeded backend): SA loads business/admin/manager/leaderboard/notifications/pay-periods
  (all 200, correct shapes), SA→`/v1/dashboards/rep` **403** (no linked rep → `AccessDenied`); the rep
  fixture confirms rep→business **403** (server-enforced) and rep→rep-dashboard/leaderboard **200**; the
  leaderboard JSON carries **no money key**. **Not done (needs a browser):** the light/dark visual pass of
  the charts.
- **Backend follow-up this surfaced:** a **period-aggregation/trend endpoint** for the business dashboard
  (so trend-over-time charts can be built). *(The `@ApiResponse` response-DTO follow-up is DONE — Batch A #2;
  all dashboard/leaderboard/notification responses now alias the generated schema.)*

### Account & Settings (built — Session 1: My Account + Administration hub + profile-change-review)
The personal "My Account" area + the profile-change-review workflow. Reuses the playbook exactly.
Folders: `features/account/` (the tabbed personal area) and `features/admin/` (the Administration area;
Session 1 = hub shell + review queue; Session 2 adds users/roles/notification-settings editors).

- **HR-edit is request-not-live-write (the law here, SRS AUTH-011, design-system §10.6).** The Profile tab
  reads `GET /v1/account/profile` (which carries **`change_pending` + `pending_request`** — NOT
  `useAuth().user`, which lacks the flag). Saving name/phone/avatar POSTs **only the changed fields** to
  `/v1/account/profile-change-requests` → toast "Submitted for review (not saved live)" → invalidate; the
  **live profile is unchanged** and a `PendingChangeBanner` shows the proposed values. While a change is
  pending the edit form is **disabled** (one request at a time). **Theme is the deliberate INSTANT
  exception** — the Preferences tab reuses the wired `<ThemeToggle/>` (`useAuth().setTheme` → instant +
  `PATCH /v1/account/theme`); the UI calls this out explicitly.
- **My Account = foundation `Tabs`** (`features/account/pages/AccountPage.tsx`): Profile · Security
  (change-password RHF+zod, `type="password"`, never echoed/logged) · **Signatures** (manage saved reusable
  e-signatures — draw/type/upload, set default, delete; own-scoped) · Preferences (theme) · Notifications
  (**read-only**). No permission gate — every user manages their own account.
- **Notifications tab degrades by design.** The only channel-config endpoint is `settings:view`-gated
  (Super Admin), so the tab shows the real event×channel list ONLY to an SA (`useCan('settings:view')` gates
  the fetch); everyone else gets a graceful "your administrator controls these" Banner. **There is no
  per-user override** (AUTH-013). A user-facing read endpoint is the §12 follow-up.
- **Profile-change-review queue** (`features/admin/pages/ProfileReviewPage.tsx`, `useCan('profile:approve')`
  + server-scoped): the queue (`GET /v1/profile-change-requests`) is **routed server-side** (SA=all,
  Admin=any rep, field-manager=own reps — AUTH-012); **the UI NEVER filters it**. Each `ReviewRequestCard`
  shows the subject + **current → proposed** per changed field (current from `subject`, proposed from
  `proposed_changes`) + **Approve** (applies to the live user) / **Reject** (confirm Modal → discards). 403 →
  `AccessDenied`.
- **Administration hub** (`features/admin/pages/AdminHomePage.tsx`): a card grid; each `AdminHubCard` is
  gated by reading `useAuth().permissions.has(perm)` (so the page can `.filter` without breaking
  rules-of-hooks — do NOT call `useCan` per item in a loop). Built card → a `Link`; unbuilt → a **"coming
  soon"** card (Users/Roles/Notification-settings = Session 2; Commission/Clients/Expense-categories = their
  own future screens). No admin permission at all → `AccessDenied`.
- **`Avatar` is a foundation component** (`components/ui/Avatar.tsx`, barrelled): initials circle +
  optional `avatar_url` image; `size sm|md|lg`. Used by the profile header + review queue (+ Session-2 user
  list). **Avatar file upload stays stubbed** — `avatar_url` is a text field in the edit-as-request form.
- **Nav:** Sidebar gained an **"Administration"** group ("Administration" `/admin` shown if the caller has
  any admin-card permission; "Profile reviews" `/admin/profile-review` shown with `profile:approve`) and an
  **"Account"** group ("My Account" `/account`, always). The TopBar user-menu "My Account" button now
  `navigate('/account')`.
- **Verified live** (seeded backend, `smoke.rep` fixture so SA creds stay pristine): **request → SA-approve
  → APPLIED** and **request → SA-reject → DISCARDED** (proving the live write is withheld until approval),
  the SA queue contains the rep's request (routing), change-password (wrong current → 400, change → 200,
  restore → 200), read-only notification-settings (200), and the instant theme PATCH (200). **Not done
  (needs a browser):** the light/dark visual pass.
- **Deferred to Session 2:** user management (list/create/edit/roles/deactivate), the role builder
  (module×action matrix; built-in roles `is_system` → rename/delete blocked 409, permissions editable), and
  the notification-settings **editor** (`PATCH /v1/notification-settings`). The read hook + types already
  live in `features/notifications/` for the editor to reuse.

### Administration admin CRUD (built — Session 2: Users · Role builder · Notification-settings editor)
Fills the three Session-1 "coming soon" hub cards. All in `features/admin/` (one administration feature);
the notification-settings WRITE lives in `features/notifications/` next to its read hook. Reuses the playbook.

- **User management** (`features/admin/pages/UsersPage.tsx`, `users:view`): a Table (Avatar, email, role
  Badges, status) + a create/edit **Modal** (`UserFormModal`, RHF+zod). **Create** generates a strong
  **temp password shown once** (`lib/password.generateTempPassword`, Web Crypto; copy + regenerate) → POSTs
  the required `password` (the backend has no invite/reset/must-change — see §12); the user changes it under
  My Account → Security. **Edit** has NO password field (no admin-set-password endpoint); it PATCHes
  name/phone/status and, if roles changed, `PUT /users/{id}/roles` (full replacement). **Soft-deactivate** =
  `PATCH {status:'inactive'}` (immediate revoke; never a hard delete) behind a confirm. **Self-guardrails**
  (the server has NO self-protection): you can't deactivate your own account or change your own roles/status.
- **Role builder** (`RolesPage` + `RoleEditorPage` at `/admin/roles[/new|/:id]`, `roles:view`/`edit`): list
  shows a **"Built-in" Badge** + permission/user counts; the editor is a **deep-linkable route** (the matrix
  is too big for a modal). **`PermissionMatrix`** = rows × 6 action columns (`view/create/edit/approve/
  delete/export`), a Checkbox per existing `(module,action)` permission keyed by **permission id** (empty
  cell where a module lacks an action), with **row + column "select-all"** (indeterminate when partial); the
  selected `Set<permissionId>` is owned by `RoleEditor`, the matrix computes the next set. Save = `PUT
  /roles/{id}/permissions` (+ `PATCH` name/description). **Built-in rules (reflect the backend exactly):**
  rename + delete are blocked (server 409; the UI disables them) but **permissions ARE editable** on built-in
  roles (with a warning) — **EXCEPT Super Admin, which the UI keeps fully read-only** (it holds all 90; the
  server has no self-protection, so neutering it would lock everyone out).
- **Notification-settings editor** (`NotificationSettingsPage`, `settings:view`; save `settings:edit`):
  **reuses `useNotificationSettings()`** (Session 1) for the read + `useSaveNotificationSettings()`
  (`features/notifications/api`) for the write. A per-event in-app/email **Switch** grid, **dirty-tracked**
  vs the loaded settings; "Save changes" PATCHes **only the changed rows**. No per-user override (global).
- **Wiring:** the AdminHomePage cards now link (`/admin/users`, `/admin/roles`, `/admin/notifications`); the
  Sidebar Administration group gained Users/Roles/Notifications NavLinks (each `show`-gated by its permission).
- **Verified live** (seeded backend, SA token, creates-then-cleans-up): user create + role-assign + edit +
  **deactivate → login 401 (immediate revoke)** + reactivate; `GET /modules`=15 + `/permissions`=90; create
  custom role + **edit permissions persists** (re-GET confirms); **built-in rename → 409, delete → 409**;
  custom role DELETE → 204 (cleanup); notification-settings toggle → 200 + restore. The test user is left
  **inactive** (no hard-delete endpoint exists). **Not done (needs a browser):** the light/dark visual pass
  (esp. the matrix). **§12 follow-ups recorded:** AUTH-002 invite/reset + a server-side self-protection check.

### Expenses (built — ITEM-FIRST: DataTable list, multi-add, KM maps, real receipts, per-item bulk approval, grouped export)
The daily expenses workflow, rebuilt item-first. `features/expenses/`. Reuses the playbook (DataTable +
`use{Feature}Table` + bulk + export). SRS §11; design-system §10.4. The **expense item is the unit** — no
weekly report in the UI.

- **Item-first API hooks.** `expenses.types.ts` aliases the generated schema (`ExpenseItem(Page)`,
  `BulkReviewResult`, `ReceiptUpload`). `api/useExpenseItems.ts` = `useExpenseItemsTable(filters)`
  (server page+sort, reset-on-filter), `useExpenseItem(id)`, `useAllExpenseItems`/`fetchAllExpenseItems`
  (export/grouped summary), `useFieldConfigs`, `useExpenseExports`. `api/useExpenseMutations.ts` =
  create-items / update / review / **bulk-review** / delete / export + **`useUploadReceipt`** (raw multipart
  fetch to `POST /v1/expense-receipts`, bearer from the session).
- **List = item DataTable** (`ExpenseItemsTable` on `ExpensesListPage`): server-paginated; filters in the URL
  (status/category/rep/client/date-range/search), **default = current pay cycle** (`payrun:view`). Columns:
  date · category (+ KM badge) · rep/client (gated) · description · status · amount (mono). Row kebab →
  View/Edit/Delete (edit-gating EXP-007; delete only pre-approval, `expenses:delete`). Approvers
  (`expenses:approve`) get row-select → a **bulk approve/reject/send-back** bar (`BulkReviewBar` →
  `/bulk-review`). `ExpenseApprovalsPage` is the same table fixed to `status=submitted`.
- **Add = multi-item** (`ExpenseForm`, RHF+zod+`useFieldArray`): "Add another item" captures several at once →
  `POST /v1/expense-items`; **edit = a single item** → PATCH. `ExpenseItemRow` picks a category →
  `KmItemFields` or `StandardItemFields`. Schema/builders in `components/expenseForm.schema.ts`
  (`buildItemsBody`/`buildItemBody`; km amount omitted).
- **KM amount is SERVER-AUTHORITATIVE; distance via Maps (env-gated).** `KmItemFields` branches on
  `maps.config#mapsEnabled` (`VITE_GOOGLE_MAPS_API_KEY`): with a key → `MapStops` (`@react-google-maps/api`
  Places autocomplete per stop → real lat/lng, a route `GoogleMap` + `DirectionsService` that **auto-derives
  `total_km`**); without → manual address + total-km entry (lat/lng `'0'`). The server re-derives the
  authoritative distance + always computes the amount; `km.ts#kmPreview` is the indicative-only preview.
- **Receipts upload for real** (`ReceiptField`): selecting a file → `useUploadReceipt` → stores the returned
  access-controlled URL; required per category (config-driven, client + server gate). Graceful when storage
  is unconfigured (server returns a reference).
- **Grouping + export (FE-6).** `ExpenseExportControls` = a grouping Select (none/daily/weekly/monthly;
  from/to = custom range) + the Batch-1 `ExportMenu` (per-item rows, or grouped period·count·total buckets) as
  CSV/Excel/PDF; `GroupedSummary` (StatCards) shows the bucket totals. `format.ts#groupItems` buckets via
  `sumMoney` (exact, #1). The server-recorded export (`ExportModal` → `POST /v1/expense-exports`) is kept for
  the per-rep KM-log client submission (stub `file_url`). `ExpenseStatusBadge` unchanged.
- **Nav/routes unchanged:** `/expenses[/new|/approvals|/:id|/:id/edit]` (Sidebar Expenses + Approvals).
  Removed the report-era files (`useExpenses`, `ExpenseReportsTable`, `ExpenseReviewCard`).
- **Verified LOCAL only** (tsc + build + lint + stylelint green). Operator applies `migrate deploy` + re-seeds
  bootstrap, and optionally sets `GOOGLE_MAPS_API_KEY`/`SUPABASE_*`/`VITE_GOOGLE_MAPS_API_KEY`. Light/dark +
  live-data + the map/upload visual pass needs a browser/running backend with the keys.

### Clients & Products + the EFFECTIVE-DATING UI (built — Admin Config Session 1; Commission Config = Session 2)
The deployment-setup config for the **billing stream** (what we charge partners). `features/clients/`. Fills
the "Clients & Products" hub card. Reuses the playbook + the admin list+detail-route shape. SRS §6; CLAUDE
#3 (keep billing rates SEPARATE from commission) + #10 (effective-dating).

- **#3 is structural here:** the feature reads ONLY `/v1/clients*` — **zero path touches `commission_*`**.
  Commission Config is a **separate feature** (Session 2), never one screen/hook joining the two streams.
- **EFFECTIVE-DATING UI = APPEND-NEW-FUTURE-ROW, never edit/delete (#10).** Billing rates have GET + POST
  only. The UI is a **read-only current/pending/past table** (`EffectiveDatedTable`, status badged via
  `RateStatusBadge` — both **domain-agnostic**, written for Session 2 to reuse on tiers/flats/holdback) +
  an **"Add rate" form** (`BillingRateFormModal`). Adding a **future-dated** rate **supersedes the scope's
  pending row + bounds the current** (server-side); the form states this. **The `status` comes from the
  server** (`'current'|'pending'|'past'`) — no client-side date math (just a `todayIso` default + a
  client-side back-date guard that the **server enforces with 422**). Existing rows are NEVER edited.
  `BillingRate.amount` is an exact-decimal string (`MoneyInput` in, `money()` out). The shared table takes
  `EffectiveColumn<T>[]` (caller's leading columns) + auto-renders effective_from/to + status.
- **Clients/Products CRUD = Modals** (`ClientFormModal`, `ProductFormModal`); billing rates live on the
  **client DETAIL route** `/admin/clients/:id` (header+edit · Products · BillingRatesPanel). **Soft-deactivate**
  = `PATCH {is_active:false}` (preserves history; never delete) behind a confirm; reactivate flips it back.
  **`product_type` is IMMUTABLE** — the edit form omits it (shows it read-only as a Badge); the backend
  **rejects** a `product_type` in `UpdateProductDto` with **400** (`forbidNonWhitelisted`) — stronger than
  ignoring. `rate_kind='product'` requires a product (server 422); add-on kinds (tv_addon/…) don't.
- **Nav:** AdminHomePage "Clients & Products" card now links `/admin/clients`; Sidebar Administration group
  gained a "Clients & Products" item (`clients:view`). Routes: `/admin/clients`, `/admin/clients/:id`.
- **Verified live** (seeded backend, SA token; clients/products/rates have no DELETE so they persist — the
  test client is soft-deactivated as cleanup): client create + **dup code → 409** + rename + deactivate/
  reactivate; product create + **product_type-immutable edit → 400** + deactivate; **effective-dating core:**
  rate@today → **current**, rate@+10d → **A bounded (→+9d) + B pending**, rate@+30d → **B superseded/gone, A
  current, C pending**, **back-date → 422**, **product-kind without product_id → 422**, tv_addon without
  product → 201; list rows carry `status`, `?status=current` filters. **Not done (needs a browser):** the
  light/dark visual pass (esp. the effective-dated table). **Session 2 (DONE):** Commission Config — see the
  next subsection.

### Commission Config + the TIER-BRACKET editor (built — Admin Config Session 2)
The deployment-setup config for the **rep-commission stream** (what we pay reps). `features/commission/`.
Fills the "Commission Config" hub card. Reuses the playbook + the promoted effective-dating UI. SRS §7;
CLAUDE #3 (keep commission SEPARATE from clients) + #5 (engine owns tiering; UI only stores) + #10
(effective-dating) + #1 (exact decimal). One scannable page `/admin/commission` (`commission:view`; 403 →
AccessDenied) of stacked Card sections; every Add/Set action gated `commission:edit` (server is the real gate).

- **PROMOTION:** `EffectiveDatedTable` + `RateStatusBadge` (+ the `RateStatus` type) were moved from
  `features/clients/components/` → **`components/ui/`** (barrel-exported) and Session-1 clients re-pointed to
  the barrel. So Commission imports them from the **foundation**, NOT from `features/clients` — there's no
  commission→clients code dependency and **#3 reads cleanly**. (Both features still build/lint/stylelint clean.)
- **#3 is structural here:** the feature's RATE reads are ONLY `/v1/commission/*` + `/v1/incentives`. The
  incentive scope picker's `/v1/clients` read (gated `clients:view`) is a **client reference** the backend
  validates `scope_client_id` against — **never a join of the two rate streams** (no path combines
  `commission_*` with `client_billing_rates`).
- **TIER-BRACKET editor (the custom piece — STORAGE + VALIDATION ONLY, #5).** `TierBracketEditor` is a
  `useFieldArray` of 4 brackets (default Schedule-C-v2 shape); each row = tier_number, min_count, max_count
  + an **"open top" Switch** that nulls max_count, rate (`MoneyInput`); add/remove rows. The pure
  `tiers.logic.ts#validateTierBrackets` is a **client-side MIRROR of the backend** `tier-schedule.logic.ts`
  (≥1 bracket · first min=0 · exactly one open and it's highest · max≥min · **contiguous: each min = prev
  max+1**). It runs live on `useWatch` and **blocks submit** (disabled button) while invalid, showing a
  Banner; a valid set renders a read-only range preview. **It never determines which tier a count falls in
  — the engine does that at runtime (#5).** Shared form types/mappers live in `tierForm.ts` (avoids a
  circular import between the editor + modal). **Batch A #2 fixed** the `TierBracketDto.max_count` swagger
  nullable quirk (explicit `type: Number, nullable: true`), so the generated `CreateTierScheduleDto` is now
  used directly — the hand-written `CreateTierScheduleBody` + boundary cast were **dropped**.
- **Effective-dating = APPEND-NEW-FUTURE-ROW (#10), reusing the shared table.** Tier schedules / flat rates /
  holdback split each render in `EffectiveDatedTable` (server `status`; a future-dated row supersedes the
  scope's pending + bounds the current; **back-date → 422**; closed rows never edited). `TierScheduleModal`,
  `FlatRateModal`, `HoldbackSplitModal` all show the supersession Banner + an `effective_from` ≥ `todayIso()`
  client guard (server re-enforces 422).
- **Flat rates** (`FlatRatesSection`/`FlatRateModal`): product_type Select offers **only greenfield_internet /
  tv / home_phone** (internet omitted — "internet is tiered; set it in the tier schedule"); the server still
  **422s internet** (proven). Amount `MoneyInput`/`money()`.
- **Holdback split** (`HoldbackSplitSection`/`HoldbackSplitModal`): advance_pct + holdback_pct as decimal
  fractions; a **live "Total = 100%" ✓/✗** computed with **exact integer basis points** (`pct.ts`
  `toBasisPoints`/`totalsToHundred` — no float, #1); submit blocked unless they sum to 10000 (server 422s ≠1).
- **Holdback-release** (`ReleaseSettingSection`): **PROPOSED (SRS §17), store-only & sticky** (NOT
  effective-dated) — a `ProposedChip` + an explicit "stored only; Pay Run/Redwave interprets which cycle the
  30% releases into" note; a free-text `release_rule` Set form pre-filled via RHF `values`. (§12.)
- **Incentives** (`IncentivesSection`/`IncentiveModal`): a Table (name · scope client/product · target ·
  window · amount via `money()` · status) with row actions Edit + End (status→ended) and a status filter.
  Create = **per_activation only**; `target_based` is shown but **DISABLED** with a `ProposedChip` + "deferred
  §12 — not engine-applied yet" note (and renders with a `ProposedChip` in the list). Scope client = **All /
  Specific → `useClients` picker** (the #3-safe reference); scope product type = static enum Select, optional.
  Edit = name/amount/status. The created-then-ended incentive persists (no delete endpoint).
- **Nav:** AdminHomePage "Commission Config" card links `/admin/commission`; Sidebar Administration group
  gained a "Commission Config" item (`SlidersHorizontal`, `commission:view`). Route: `/admin/commission`.
- **Verified live** (seeded backend, SA token; effective-dated configs have NO delete → valid future rows are
  written **value-identical** to Schedule C v2 at far-future dates, the release rule is **restored**, the
  incentive **ended** — SA creds untouched): **29/29 smoke checks pass** — seeded Schedule C v2 current
  (110/125/145/160, flats 100/30/30, split 0.70/0.30); a future VALID schedule → **bounds current + pending**,
  a later one **supersedes** the pending; **flat internet → 422**; **holdback 0.60+0.30 ≠1 → 422**; release
  set→read-back→restore; **per_activation → 201**; **target_based without target_count → 422**; **back-dated
  tier schedule → 422**. **Two backend findings (NOT this session's code; flagged):** (1) the API serializes
  Prisma `Decimal` as a **canonical string without trailing zeros** (`"160"`, `"0.7"`) — still a string (#1
  holds) and `money()` pads to 2dp, so display is correct; (2) **tier contiguity violations returned 500, not
  422 — FIXED (Batch A #1, global exception filter).** See "Global exception filter & error envelope" below:
  a global `AllExceptionsFilter` now normalizes every error to the contract envelope `{ error: { code, message,
  details } }`, and `tier-schedule.service` wraps the pure `validateTierBrackets` throw in a framework-free
  `DomainError` → **422 + code `TIER_SCHEDULE_INVALID`** (verified by smoke). **Not done (needs a browser):** the
  light/dark visual pass (esp. the bracket editor + the effective-dated tables).

### Pay Run UI (built — the money orchestrator's review-and-commit surface)
The UI for the Pay Run pipeline (SRS §9). `features/payrun/`. The backend does ALL money logic (engine,
70/30, holdback, snapshots, atomic+idempotent finalize); **this UI computes NOTHING** — every amount is
server-sourced and displayed via `money()` (exact-decimal, tabular-mono, right-aligned) / `sumMoney()`
(integer-cents totals, no float). Reuses the playbook exactly. Two pages under the Money nav group.

- **The line API carries the 7 payout components + net + the RECONCILIATION facts** (`lineData`):
  `commission_70` (70% advance), `holdback_release_30` (released), `incentive_total`, `expense_total`,
  `bonus_amount`/`bonus_note`, `clawback_total`, `net_payout`, **plus `gross_commission` (the 70/30 base),
  `amount_held` (THIS period's 30%), `tier_at_payment`, `internet_tally`, `rate_per_activation`** — all
  copied VERBATIM off the engine's `PeriodResult` at draft **and** finalize (migration
  `20260620000000_payrun_line_reconciliation`, 5 nullable cols; **no money is recomputed**, #1/#5; nullable
  only for pre-migration rows and a 0-tally tier/rate). **The invariant `gross === commission_70 +
  amount_held` holds exactly** (spec-locked, no lost cent), so a "the 70% looks wrong" report is decidable
  on screen: `$287` is 70% of a **$410** gross, not the assumed $420 — rate composition, not a split error.
  The drawer renders the full waterfall `gross − 30% held = 70% advance → + released + incentives +
  expenses + bonus − clawback = net`, above a basis line (`Tier N · tally internet @ rate`); the +/−/=
  glyphs are presentation only.
- **Period-level 30% view — `GET /v1/pay-runs/:id/holdback`** (`payrun:view`, `PayRunHoldbackSummaryResponse`):
  `held_this_period`, `held_release_period` (WHEN it releases), `releasing_this_period`,
  `clawback_setoff_this_period`, `outstanding_total`, `by_origin[]`. **Every total is server-computed** so the
  UI never aggregates the ledger (the reviewer's "no arithmetic in the component"). Reuses `scopeRepIds`, the
  pure `resolveScheduledReleasePeriod`, and the frozen `holdback_ledger`. On a **draft** the current hold +
  release period are a **projection** (`is_projection: true` — nothing hits the ledger until finalize);
  finalized figures are read from the ledger. FE: `HoldbackSummaryPanel` + a "Held this period (30%)" KPI.
- **Period list `/pay-runs`** (`payrun:view`): the pre-loaded 2026 schedule (`usePayPeriods`) **joined
  client-side** with the run headers (`usePayRuns`, latest run per period) to derive each row's run state —
  no run / draft / finalized / exported. Action by state: **no run → "Draft a run"** (`payrun:create`, POSTs
  then routes to the workspace); **draft → "Open draft"**; **finalized/exported → "View"**. `PeriodStatusBadge`
  (open/closed/paid) + `PayRunStatusBadge` (draft/finalized/exported) — **NOT `StatusPill` (sale-only)**.
- **Workspace `/pay-runs/:id`** (`usePayRun`): header + status badge + KPI `StatCard`s (reps, total advance,
  total net via `sumMoney`); a **"Draft — not finalized"** banner vs a **"Finalized — locked"** banner once
  committed. `PayRunLinesTable` = one row per rep (advance · released · incentives · expenses · bonus ·
  clawback · NET), money right-aligned mono, a totals row (`sumMoney`). **`NetPayoutCell` is the one place
  net is shown — a NEGATIVE net (clawbacks > commission) renders in danger colour with the sign, never
  hidden/floored.** Row kebab → "View breakdown" (+ "Set bonus" when draft+approver). The empty period shows
  a graceful "no validated sales" banner.
- **Drill-down** (`LineBreakdownDrawer`): the rep's component **waterfall** straight from the line (advance +
  released + expense + incentive + bonus − clawback = net — the +/−/= are presentation, no math) + that
  rep's **holdback ledger** rows (period labels joined from the schedule). **`HoldbackPanel`** = the same
  ledger run-wide (read-only).
- **Bonus** (`BonusModal`, `payrun:approve` + draft): `MoneyInput` decimal string + note → `useSetBonus`; the
  **server recomputes net**. **Finalize** (`FinalizeConfirmModal`, `payrun:approve` + draft): a deliberate,
  **explained** confirm (lists what it commits: freezes snapshots, sales→Paid, records/releases holdback,
  applies expenses/clawbacks, composes net; "cannot be undone"); the button is **disabled while in flight
  (no double-submit)**; on success the run is **locked/read-only** and finalize is no longer offered
  (re-finalize is a backend no-op). **Export** (`ExportModal`, `payrun:export` + finalized): csv/json →
  `useExportRun` → toast with `line_count`; the run shows **exported**. `useCan` is convenience — the **server
  is the real gate (§5)**; 403 → `AccessDenied`.
- **Nav/route:** the Sidebar **Money** group's "Pay Run" placeholder now links `/pay-runs` (`Wallet`,
  `payrun:view`). Routes: `/pay-runs`, `/pay-runs/:id`.
- **Verified live** (seeded backend, SA token; **a full end-to-end path now exists** — seed the $3,310 case
  via the Sales/HRM/Clients APIs, then draft/finalize here; created users/reps/clients persist, SA creds
  untouched): **25/25 smoke checks pass** — manager→rep→client+products→27-item sale + greenfield sale →
  bulk-validate → **draft: 70% advance = $2,317.00** (the $3,310 fixture) → **idempotent re-draft** → **bonus
  recomputes net (+$100 exactly)** → **finalize: status finalized, period → paid, sales → paid, holdback
  `amount_held` = $993.00, re-finalize no-op** → **export csv (run → exported)** → **empty period draft → 0
  lines** → **NEGATIVE net via the real clawback path** (claw back a paid $145 item, a tiny next-period sale
  → line `clawback_total` 145, `net_payout` < 0). **Not done (needs a browser):** the light/dark visual pass
  (esp. the line table, the breakdown drawer, and the finalize confirm).

### Clawback UI (built — enter a recovery against a paid/frozen item + list pending→applied)
The entry + list surface for cancellation recoveries (SRS §10). `features/clawback/`. The backend does the
clawback CALCULATION (the engine, off the frozen snapshot) and feeds the deduction into Pay Run; **this UI
computes no money and does no date math**. Reuses the playbook; two pages under the Money nav group.

- **The recovery AMOUNT is SERVER-SOURCED (#1/#6) — confirmed UX "blank = server computes".** The entry form's
  amount field is **BLANK by default** (`ClawbackEntryModal`): leaving it blank **omits `amount`** from the
  POST body so the backend defaults it to the engine's `computeClawbackAmount` (rate + incentive off the
  frozen snapshot). The snapshot **components** (`rate_applied`, `incentive_amount`) are shown **read-only**
  for transparency but the **UI never sums them**; a typed value only overrides. The created clawback's
  **server `amount`** is what the list/toast show. (No preview endpoint exists — this is the only invariant-
  pure way to "show the default.")
- **NO date math (#6):** `reported_date` is captured (default `todayIso()`) and **labelled informational** —
  "drives no logic; no window is computed or enforced." Nothing in the UI reads/computes a 30/60-day window.
- **Only PAID/frozen items clawable (#2):** the pure `clawback.logic.ts#isClawable` = `commission_paid != null
  && item_status != 'clawed_back'`. The snapshot is **never edited** — a clawback is a NEW record.
- **Per-item / no re-tier (#5):** the items panel + the entry modal **state** that a clawback recovers ONE
  item and does not touch the internet activation or re-tier the period.
- **Entry `/clawbacks/new`** (`clawback:create` + `sales:view` to search): a **paid-sale finder**
  (`PaidSaleFinder`) — the Sales API has **no text search**, so it fetches **paid + clawed_back** sales
  (`useSalesQuery` from the Sales feature; a sale flips to `clawed_back` when one item is recovered but its
  other paid items stay clawable) and filters CLIENT-side by Sale ID / customer; a "# clawable items" COUNT
  column. Select a sale → **`PaidItemsPanel`** shows its clawable items (frozen `rate_applied` /
  `incentive_amount` read-only) with a "Claw back" action; non-clawable items are greyed with the reason →
  **`ClawbackEntryModal`**. **422 (not paid) / 409 (double)** surface via `useApiErrorToast` (the panel also
  pre-disables non-clawable items, so they're rare).
- **List `/clawbacks`** (`clawback:view`): `useClawbacks({status?})` + a status filter (all/pending/applied).
  Records are **FLAT** (no joins) → `ClawbackListTable` shows reported_date · amount (`money()`) · reason ·
  `ClawbackStatusBadge` (pending→warning, applied→success; **NOT StatusPill** — sale-only) · **Applied run**
  (period # mapped from `applied_in_pay_run_id` via `usePayRuns()` when `payrun:view`, else "—") · **View
  sale** (`sale_id` → `/sales/:id` for context). Connects to Pay Run: a **pending** clawback is deducted →
  shows **applied + the linked run** once a run finalizes.
- **Reuse:** the Sales feature's `useSalesQuery`/`useSaleQuery` + `Sale`/`SaleItem` types power the finder;
  `sales.types.ts#SaleItem` was **extended** with the real frozen-snapshot fields it already returns
  (`tier_at_payment`, `rate_applied`, `commission_paid`, `incentive_id`, `incentive_amount` — additive; the
  Sales feature is unaffected). The create mutation invalidates **both** `['clawback']` and `['sales']` (a
  clawback flips the item + sale to `clawed_back`).
- **Nav/route:** the Sidebar **Money** group's "Clawbacks" placeholder now links `/clawbacks` (`Undo2`,
  `clawback:view`). Routes: `/clawbacks`, `/clawbacks/new`.
- **Verified live** (seeded backend, SA token; seed a paid item via Sales→validate→Pay-Run-finalize; created
  rows persist, SA creds untouched): **16/16 smoke checks pass** — finalize freezes a paid **$30 TV** item →
  **clawback with no amount → server default `amount` = 30.00, status `pending`** → **a $20 incentive →
  default = 50.00** (engine calc, separate client) → **override `12.34` accepted** → **late `reported_date`
  2030-12-31 accepted (no date math)** → **second clawback on the same item → 409** → **non-paid item → 422**
  → list shows the two as `pending` → **finalize the rep's next period → both flip to `applied` + linked to
  that run**. **Not done (needs a browser):** the light/dark visual pass (esp. the finder, the items panel,
  and the entry modal).

### Billing & Statements UI (built — generate + view the client statement & commission invoice per client·period)
The CLIENT-FACING billing surface (SRS §12). `features/billing/`. The backend prices EVERYTHING from
`client_billing_rates` (effective-dated by `sale_date`); **this UI prices nothing and shows NO commission
data (#3)** — it triggers generation and renders the server's numbers. Reuses the playbook; two pages under
the Money nav group.

- **#3 is structural here:** the feature's data reads are ONLY `/v1/statements`, `/v1/invoices`, `/v1/clients`
  (names), `/v1/pay-periods` (labels) — **ZERO path touches `commission_*`/engine/pay-run money**, and no
  commission amount is ever shown on a statement. The invoice `total_commission` IS the **billing-stream**
  statement total (server) — never the rep payout.
- **The UI prices NOTHING (#1):** generate is a backend call; the statement total + line totals are
  server-sourced; `money()` is display only; **no `sumMoney` on the lines** (the total is the server's
  `total_amount`). **NO GST** — no tax line/field anywhere. **ONE LINE PER CUSTOMER** — the backend aggregates;
  `StatementLinesTable` just renders (customer · products_summary · line_total).
- **Generate / regenerate (`GenerateBillingModal`, `billing:create`):** client + period Selects
  (`ClientPeriodPicker`, reusing `useClients`/`usePayPeriods`) → generate the **statement THEN the paired
  invoice**. Generation **PERSISTS + REPLACES** (no preview endpoint), so when a statement already exists for
  the (client, period) the modal shows an explicit **regenerate-confirm Banner**. On success → the statement
  detail page. The UI states "the server prices from billing rates — this screen computes nothing."
- **UNPRICED 422 → helpful (`UnpricedBanner`):** the backend refuses to under-bill (422 with
  `unpriced:[{product_name, sale_date}]`). To surface the per-product detail, the shared **`ApiError` was
  extended with an optional `details`** (the parsed body) and **`unwrap` now threads the response body
  through** (additive; all features inherit). `billing.logic.ts#extractUnpriced` pulls the array → the banner
  lists each product + date with a link to **Clients & Products** (`/admin/clients/{clientId}`) to add the
  rate.
- **Statement detail `/billing/statements/:id`** (`billing:view`): `useStatement(id)` (lines + total) +
  `useInvoiceFor(client_id, pay_period_id)` (the paired invoice). Renders the **total `StatCard`** (server
  `total_amount`, no client sum), `StatementLinesTable` (one line per customer, NO GST note), and the
  **`InvoiceCard`** (one-line `total_commission` = billing-stream statement total). **Regenerate** (explicit,
  `billing:create`) + **Export** (`BillingExportModal`, pdf/excel, `billing:export`) → stub `file_url`.
- **List `/billing`** (`billing:view`): `useStatements({client_id?, pay_period_id?})` + the `ClientPeriodPicker`
  filter (`allowAll`). Columns: client (name via `useClients` map) · period (`#num` via `usePayPeriods` map) ·
  **total** (`money()`) · generated date · View. **No status badge** — the backend has **no status column**
  on statements/invoices (generated vs exported isn't distinguishable; the list shows the generated date).
- **Nav/route:** the Sidebar **Money** group's "Billing" placeholder now links `/billing` (`FileText`,
  `billing:view`). Routes: `/billing`, `/billing/statements/:id`.
- **Verified live** (seeded backend, SA token; seed client + products + `client_billing_rate`s + confirmed
  sales in a **FUTURE** period — billing rates reject back-dating, so they must be effective on the sale_date;
  created rows persist, SA creds untouched): **18/18 smoke checks pass** — generate → **ONE line per customer
  (2 lines)**, **NO GST field**, **effective-dating by sale_date** (internet $50 up to D2-1 vs $60 from D2 →
  Alice $50, Bob $90), **total $140 server-sourced**; **invoice `total_commission` == statement total**;
  **regenerate → same id, exactly one statement (replace-in-place, no duplicate)**; an **unpriced product →
  422 with `unpriced[]`** (product + sale_date) **that does NOT replace the existing statement**; **export
  statement (excel) + invoice (pdf) → stub `file_url`**. **Note:** effective-dating across a rate change needs
  the earlier rate to be **current** (effective today) so the later future rate **bounds** it rather than
  **superseding** a pending row. **Not done (needs a browser):** the light/dark visual pass (esp. the statement
  table, the generate modal, and the unpriced banner).

### Documents & E-Signature UI (built — REAL: PDF upload · preview · field placement · in-system signing · download)
The documents workflow (SRS §13). `features/documents/`. The backend DERIVES the overall status, enforces
ROW-LEVEL sign/cancel auth, scopes visibility (owner-or-recipient; 404 for outsiders), and STAMPS signed
copies server-side; **this UI displays the server's truth, never re-derives status, models signing as
row-level (not a permission), and computes no money/coordinates the server is authoritative for**. Reuses the
playbook. **Upload + signing are now REAL** (storage + pdf-lib stamping). Two pages under the People nav group
+ a **My Account → Signatures** tab. NEW deps (frontend): `pdfjs-dist` (preview, **lazy** — its own ~360 kB
chunk, loads only on document screens) + `signature_pad` (drawing).

- **Signing is ROW-LEVEL, NOT a permission (the law here, §5).** Sign/decline/cancel carry **no
  `@RequirePermission`**; the pure `documents.logic.ts#findMyPendingSignature(doc, userId)` (current user via
  `useAuth().user.id`) decides whether to OFFER Sign/Decline — only when the user has a **`pending` signature
  in a `pending` request**. **No `documents:sign` anywhere.** The server is the real gate: a non-signer → 403,
  an already-closed request → 409 (both surfaced via the error toast). Cancel shows for requester/owner/admin
  on a pending request (`canCancel`).
- **The overall status is SERVER-DERIVED — displayed, never recomputed.** `DocumentStatusBadge` (draft·shared·
  partially_signed·completed·declined) + `SignerStatusBadge`/`RequestStatusBadge` render `doc.status` /
  request / signer statuses straight from the server. **Decline is terminal** (the modal warns; once declined
  nothing more can be signed).
- **Share == request-signature, UNIFIED (DOC-002, confirmed UX).** One **"Request signatures"** action
  (`RequestSignatureModal`): a `MultiSelect` of users (recipients) + optional message/due-date. Recipients
  become BOTH the shared-with/visibility set AND the asked signers — there is no share-without-signing.
- **Visibility is the server's.** The list returns ONLY visible docs (owner/recipient; Admin/Super see all) —
  the UI never filters. A non-visible **detail fetch → 404 → a GRACEFUL not-found** Banner (`isNotFound(err)`;
  `useDocument` uses `retry:false`), **NOT** an `AccessDenied`/permission error.
- **The detail returns raw user IDs only** (no names) — `useUserLookup` (reuses `useUsers`, gated `users:view`)
  builds an id→name/avatar map; the current user resolves to **"You"** (`useAuth`), an unknown id to a short
  id. **There is NO audit-timeline endpoint** — `DocumentTimeline` is **composed** from the detail's nested
  `signature_requests` + `document_signatures` (request created · each sign with `signed_at` · declines); IP +
  full audit_log aren't exposed (a flagged backend follow-up). Declines carry no timestamp in the response.
- **Upload is REAL + PDF-only** (`UploadDocumentModal`, `documents:create`): a multipart PDF + title + doc_type
  via the shared `lib/api/multipartUpload.ts` (bearer from the session) → `POST /v1/documents`; non-PDF guarded
  client-side + the server 422s. The **original is stored once + never mutated** (DOC-001/004).
- **Preview + download = pdf.js + access-controlled URLs.** `PdfDocumentView` (lazy) renders all pages to
  canvases + exposes each page's display size for overlays; `DocumentPreview` wraps a `…/file-url` query.
  Every file (original / per-signer copy / final copy / saved signature) is fetched via a **short-TTL signed
  URL** from an RBAC/visibility-gated endpoint (`useDocumentFileUrl`/`useCompletedFileUrl`/`useSignatureFileUrl`);
  `DownloadLink` is the download/open anchor. The object path is never exposed.
- **Field placement** (`FieldPlacer`, in `RequestSignatureModal` behind a Switch): the requester places
  signature/initial/date/text fields per recipient on the PDF (drag to move, corner to resize), stored as
  normalized 0..1 fractions (top-left) sent with the request. No fields → a simple click-to-sign.
- **In-system signing** (`SignDeclineModal`): preview the document with the signer's fields highlighted, apply
  a signature (**a saved one, drawn via the `SignaturePad` ui primitive, or typed → PNG**), fill text fields
  (dates auto server-side) → the server stamps a per-signer copy. A **"sign outside the app"** path uploads an
  externally-signed PDF (`/sign-upload`, method=uploaded). The signature image goes up as `signature_id` (saved)
  or `signature_image` (inline data-URL).
- **Saved signatures** (`features/account` → Signatures tab): list (image thumbnails via own-scoped file-url),
  create by **draw / type / upload**, set default, delete — own-scoped, no permission. Shared helpers in
  `lib/signature.ts` (`dataUrlToFile`/`typedSignatureDataUrl`).
- **Nav/route:** the Sidebar **People** group's "Documents" item links `/documents` (`FileSignature`,
  `documents:view`). Routes: `/documents`, `/documents/:id`.
- **Verified LOCAL only** (tsc + build + lint + stylelint green; `PdfDocumentView` is its own lazy chunk;
  backend 74 suites / 394 tests green incl. real pdf-lib stamping on an in-memory PDF + the `original never
  mutated` assertion). The operator applies `migrate deploy` (the `documents_esign_real` migration) + sets the
  Supabase creds; the **live + light/dark + real preview/stamp visual pass needs a browser** with storage
  configured. The earlier 18-check smoke predates the storage/stamping rewrite (the workflow assertions still
  hold; re-run against Supabase to exercise the real files).

### Data Import & Integration UI (built — REAL upload → map → reconcile → commit wizard + templates)
The import wizard (SRS §15). `features/import/`. The backend does ALL pipeline work (parse/clean/classify, the
reconcile-before-commit GATE, the ATOMIC + idempotent commit, the 7 handlers); **this UI uploads a file,
adjusts the mapping, reconciles, and commits — it does NO matching/commit logic**. Reuses the playbook +
`lib/api/multipartUpload`. Three pages + a templates panel under the Administration nav group.

- **STAGE = a REAL file upload** (`NewImportPage`, `import:create`): kind Select (the **8 targets** in `KINDS`,
  `import.types.ts`) + client / reconcile_total (when needed) + an optional **saved-mapping** picker
  (`useImportMappings`) + a real `FileUpload` (xlsx/xls/csv/tsv) → multipart `useStageImport` → the batch
  detail. The historical kind shows a clear **reference-only** note. (The old JSON `RowsEditor`/`parseRows` are
  **gone**.)
- **MAP** (`MappingEditor`, while staged, `import:edit`): system fields (from the target's `templates.ts`
  field defs) → a Select of the parsed source columns (pre-filled with a client-side guess); **Apply** →
  `remap` (re-map/clean/classify the stored `raw_data`, no re-upload); **Save** → a reusable mapping (mapping
  CRUD, IMP-002). The server already auto-suggested a mapping at upload.
- **DOWNLOADABLE TEMPLATES** (`TemplatesPanel` on the import home, `templates.ts`): Excel + CSV for every
  target — clients · products/rates · billing rates · reps · historical sales · opening holdback · the
  **VF / RF Now / CTI** client-report formats — each with the exact columns, example rows, and a column
  data-dictionary (generated client-side via `exportRows`). VF/RF/CTI are **sensible defaults** (refine from a
  real file; import is mapping-driven).
- **REVIEW + RECONCILE** (`ImportDetailPage`): `StepIndicator` + count `StatCard`s + `ImportRowsTable` (per-row
  status + cleaned mapped data + matched target + **issue**); per-row **Match / Edit / Ignore** (the existing
  modals); a **Download error report (CSV)** button surfaces the outstanding rows. The **Commit** button is
  disabled while `outstandingCount > 0` (the **server 422 is the real gate**, incl. the holdback
  `reconcile_total` check the UI never computes).
- **COMMIT** (`CommitConfirmModal`): now a **typed confirmation** (`ConfirmDialog requireTyped="COMMIT"`) that
  explains the per-kind atomic apply; double-submit-safe. On success the batch is **committed + locked**;
  re-commit is a backend no-op and is NOT offered.
- **Nav/route:** Sidebar Administration "Import" → `/import`; routes `/import`, `/import/new`, `/import/:id`.
  `StatusPill` gained the `historical` status (muted). **Verified LOCAL only** (tsc + build + lint + stylelint
  green). Operator applies `migrate deploy` + Supabase creds; the live + light/dark visual pass needs a browser.

### Chatbot UI (built — the FINAL screen; a thin surface over the leak-proof, intent-only assistant)
The natural-language assistant (SRS RPT-011). `features/chatbot/`. The backend is **structurally leak-proof**:
the (stubbed) LLM returns an **intent only** (no ids/SQL) and the entitlement-gated tools take **only the
AuthUser**, so a user can only ever get their own-scope data. **This UI is a THIN SURFACE** — it sends a prompt
and renders the server's scoped text answer; it does **NO data access of its own** and enforces **NO scope**.
Reuses the playbook. One page under the Dashboards nav group.

- **THIN SURFACE (the law here, §5).** The feature's ONLY network call is `POST /v1/chatbot/query`
  (`useChatQuery`). **ZERO other data fetch** — no path reads sales/commission/holdback/etc. to "help" the
  bot. The UI renders the answer text and applies no scope logic; the backend is the guarantee.
- **Authenticated-only — no permission gate.** The endpoint carries no `@RequirePermission`, so the page has
  **no `useCan`/`AccessDenied`** and the Sidebar item (`show: () => true`) is shown to **every** signed-in
  user. Per-user scope is enforced **server-side** in the tool layer (`isToolAllowed` + tools that take only
  the AuthUser): self tools need a linked rep, roster needs manager/admin, business needs Super Admin — a
  disallowed tool returns the **refusal** text.
- **Text-only response** `{ conversation_id, intent, answer }` — `answer` is a string the server already
  formatted (no structured data). **Refusals / unrecognized prompts come back as a normal 200** → rendered as
  ordinary assistant bubbles (graceful "I can't answer that"), NOT errors. Only a **400** (empty / >500-char)
  or a network failure is a real error → `useApiErrorToast` (the typed prompt is kept).
- **SESSION-ONLY conversation.** There is **no history endpoint** (conversations persist server-side for audit
  only), so the thread lives in **component state** — navigating away/reloading clears it (the banner says so).
  No invented persistence.
- **HONEST stub framing (§12).** The stubbed LLM recognises **5 keyword intents** (`my_sales_count`,
  `my_commission`, `my_holdback`, `roster_summary`, `business_summary`; else `unknown`). A `Banner` frames it
  as a **preview with limited capability**, and `SuggestionChips` (the 5 example prompts) make it usable + show
  what it can answer. Assistant bubbles show a **subtle intent chip**; the `MessageBubble`/`ChatMessages`/
  `ChatInput` (Enter sends, Shift+Enter newline; auto-scroll; a "thinking" indicator) are hand-built from
  foundation components (no chat lib).
- **Nav/route:** the Sidebar **Dashboards** group gained an **"Assistant"** item (`Sparkles`, `/chatbot`,
  shown to all). Route: `/chatbot`.
- **Verified live** (seeded backend; a rep fixture — a Sales-Rep user **linked** to a rep — proves per-user
  scoping; created user/rep persist, SA creds untouched): **10/10 smoke checks pass** — **SA (no linked rep)**:
  `business_summary` **allowed** (real answer), `my_commission` **refused** (no rep), `unknown` refused,
  **>500-char → 400**, **empty → 400**; **rep**: `my_commission` **allowed** (own scope), `roster_summary`
  **refused** (not a manager), `business_summary` **refused** (not SA) — same prompts, different allow/deny per
  user, proving the server's leak-proof scoping while the UI just renders. **Also fixed:** a corrupted
  `components/ui/Breadcrumbs.tsx` (a missing interface `}` — an IDE truncation) restored so the build passes.
  **Not done (needs a browser):** the light/dark visual pass (the conversation + input).

### Shared data primitives + the SERVER-SIDE list contract (built — adopt these on every new list/form)
A batch of shared primitives + an app-shell pass. **New screens MUST reuse these** rather than reinventing.

- **SERVER-SIDE list contract (arch §5.1) — `{ data, meta }`.** List endpoints accept `?page=&limit=&sort=field:dir&search=` (+ their filters) and return `{ data: [...], meta: { total, page, limit, pageCount } }`. **`page` is 1-based**, `limit` default 20 / **max 100**. Shared backend primitives in **`common/pagination/`**: `PaginationQuery` (base DTO feature query DTOs `extends`), pure `paginate.ts` (`toSkipTake`/`buildPage`/`resolveOrderBy(sort, allowlist, fallback)` — the **allowlist is the orderBy-injection guard**), `PageMetaResponse`. A service builds `where` (preserving `ScopeService` scoping + filters + a `search` OR-filter), then `Promise.all([findMany({where,orderBy,skip,take}), count({where})])` → `buildPage`. Each list has a per-entity `*PageResponse` DTO (`@ApiProperty({ type: () => [X] })` + `@ApiOkResponse`). **Done on `/v1/sales` + `/v1/clients`; new `GET /v1/products` (cross-client, `clients:view`)**; the nested `/v1/clients/{id}/products` stays a plain array. **Indexes** added (`sales` status + `client_id,sale_date`; `clients` is_active; `products` client_id,is_active + product_type) via the hand-authored `add_list_pagination_indexes` migration (CREATE INDEX only — applies with `migrate deploy`, no shadow DB).
  - **Ripple:** moving an endpoint to `{data,meta}` breaks every dropdown/finder that unwrapped it as an array. The fix pattern: keep the array-returning hook (`useClients`, `useSalesQuery`) but **unwrap `.data` with a capped `limit` (100)**; add a SEPARATE paginated hook (`useClientsPage`/`useSalesPage`) for the management DataTable. (Finder/dropdown reads cap at 100 until a typeahead combobox lands.)
- **`<DataTable>`** (`components/data/DataTable.tsx`) — the enterprise list surface over the `Table` primitives: `DataColumn<Row,SortKey>[]` (header/align/numeric/`sortKey`/`render`), server `sort`+`onSortChange`, pager (`page/pageCount/total/limit/onPageChange`), controlled selection (`selectedIds`/`onSelect`/`isRowSelectable`/`onToggleAll`, tri-state select-all), `rowActions`+`bulkActions` slots, and a **dedicated FORBIDDEN state** (`isForbidden(error)` → friendly panel, **not** "Failed to load"). The server-driven list hook (`useSalesList`/`useClientsTable`/`useProductsTable`) owns page+sort state and resets to page 1 on a filter/sort change. **Reference adoptions: Sales, Clients, Products** — copy their shape.
- **`<ConfirmDialog>`** (`components/ui`) — confirm on `Modal` that restates the consequence; **`requireTyped`** gates irreversible/financial actions (type a phrase to enable). Used for bulk soft-delete; **finalize/clawback can adopt it**.
- **`exportRows` + `<ExportMenu>`** (`components/data`, `lib/export/`) — CSV (hand-rolled), Excel (**`write-excel-file`**) + PDF (**`jspdf`+`jspdf-autotable`**) **dynamically imported** (load only on export). Caller passes `getRows()` (a paged `fetchAll*` respecting filters, OR the selection). **Print** = browser dialog + a print stylesheet (`#main-content` only; `.no-print` opt-out in `base.css`). Chose `write-excel-file` over SheetJS `xlsx` (parse-side CVEs) / `exceljs` (pulls `jimp→request`).
- **`<DatePicker>`** (`components/ui`) — a custom token-styled calendar in a Radix Popover; value/onChange **always `'YYYY-MM-DD'`**, opens to today, optional min/max. **Replaced every native `<input type=date>`** (OS-locale bug). **`<PayPeriodSelect>`** (`components/data`) — effective-dated config selects a **pay period** (`Period N · start–end`), emitting the period's start (`effective_from`) or end (`effective_to`, with open-ended); future-only (server rejects back-dating). Used in the billing-rate + commission config modals (BRD §9.4 / SRS §6.2).
- **`<SelectWithOther>`** (`components/ui`) — a Select that reveals a text input on "Other" → `{ value, other_text }`. Available wherever free entry is needed.
- **Overlays + z-index + responsive shell.** Radix menus already portal; the clip fixes were (a) `max-height: var(--radix-*-content-available-height)` + `overflow-y:auto` on the Select/DropdownMenu/Popover viewports, and (b) **reordering the z-index ladder so floating menus (dropdown/select/popover = 1300) sit ABOVE modal/drawer content (1200)** — a Select opened inside a Modal was rendering behind it (both portal to `<body>`; z-index decides). The shell is now responsive on the design-system §8 breakpoints (`--bp-mobile 640` / `--bp-tablet 1024`, `lib/useMediaQuery`): **<640px** sidebar → off-canvas drawer (hamburger); **640–1024** icon rail; **>1024** full. `.sr-only` helper in `base.css`.
- **Global search** (`GET /v1/search?q=`, `modules/search/`) — authenticated; the SERVICE scopes each group to the caller's perms (reps→`hrm:view`, clients→`clients:view`, sales→`ScopeService`). **No new RBAC permission** (the role-permission matrix is unchanged). FE: `features/search/GlobalSearch` is the real top-bar box (debounced, grouped results, deep-links).
- **Verified LOCAL only** (build + lint + stylelint + 329 backend tests green; the `add_list_pagination_indexes` migration is applied by the operator with `migrate deploy`). The light/dark + live-data visual pass needs a browser/running backend.

### Notifications overhaul + SA event management/broadcast + dead-tab fixes (built — Notifications batch)
A real, Super-Admin-manageable notification system + the previously dead Reps/Reports/`/users` tabs fixed.
The architecture below is durable — reuse it; don't reinvent.

- **The emitter seam is PROMOTED to `common/notifications/`** (`notification-emitter.ts`: `NOTIFICATION_EMITTER`
  token + `NotificationEmitter {emit, emitMany, emitRole}` interface + `NotificationEvent` with optional
  `variables`). `NotificationsModule` (`modules/reporting/`) is **`@Global()`** and binds it via
  `NotificationEmitterAdapter`, so **any** domain module injects `@Inject(NOTIFICATION_EMITTER)` with no
  import + no cycle (NotificationsService depends only on Prisma/Audit/`EMAIL_DISPATCHER`). Emits are
  **post-commit, best-effort** (never inside a `$transaction`, never throw to the originating action); rep
  `user_id` is nullable → **`emitMany` centralizes the null-skip**. `emitRole(event, roleName, payload)`
  targets active users in a role. **Templates render in `notify`** via the pure
  `common/notifications/render-template.ts#renderTemplate(tpl, vars, fallback)` — `{var}` substitution that
  **falls back to the complete call-site text if ANY token is unfilled** (never shows a raw `{placeholder}`).
- **Catalogue (bootstrap, idempotent):** **17 automatic events** + `broadcast`, each with `label` +
  `title_template` + `body_template` (new nullable `NotificationEventSetting` columns). The upsert `update`
  refreshes label/templates but **never clobbers** the SA's channel toggles. The documented
  **recipients + variables per event** live in `frontend/src/features/notifications/eventCatalogue.ts`
  (mirrors the emit sites) — shown read-only in the editor. **A genuinely NEW automatic trigger needs a code
  change** (a new emit call); the SA manages wording/channel, not trigger logic.
- **API (own-scoped, paginated):** `GET /v1/notifications` → `{data, meta}` (PaginationQuery: page/limit/
  sort/search + `is_read`); `GET /unread-count`; `PATCH /:id {is_read}` (replaced `/:id/read`);
  `POST /mark-all-read`; `POST /mark-read {ids, read}`; `POST /broadcast` gated
  **`@RequirePermission('notifications','broadcast')`**. Settings GET/PATCH carry label/title/body templates.
- **Frontend:** the bell shows a **numeric unread-count badge** (`useUnreadCount`, `refetchInterval 60s` +
  `refetchOnWindowFocus`); **`lib/notifications/resolveLink.ts`** deep-links a notification to its record by
  `related_entity_type`; clicking marks read + navigates. **Notification Center** `/notifications` (DataTable:
  unread/all filter + search, bulk mark read/unread, row click-through). **SA event management** extends the
  settings editor (per-event channels + title/body template inputs + read-only recipients). **Broadcast
  composer** `/admin/broadcast` (audience everyone/role/specific-users, gated `notifications:broadcast`).
- **Dead-tab fixes:** `features/reps/` (server-paginated roster on DataTable, `/admin/reps`, `hrm:view`);
  `features/reports/ReportsLandingPage` (hub of dashboard cards, `/reports`, `reports:view`); router gained
  `/users`→`/admin/users` + `/reps`→`/admin/reps` redirects and a friendly **catch-all `NotFoundPage`** so no
  path dead-ends. Sidebar Reps/Reports items now carry a `to`.
- **Paginated `GET /v1/reps`** (`buildPage`, sort allowlist `rep_code/full_name/status/hire_date/created_at`,
  PII redaction preserved) — the contract was regenerated.
- **Verified LOCAL only** (backend build + affected specs green; frontend build + lint + stylelint green). The
  **operator applies the migration (`migrate deploy`) + re-seeds bootstrap** (idempotent) against Supabase to
  add `notifications:broadcast` + the 17-event catalogue/templates. Light/dark + live-data visual pass needs a
  browser.

### Configurable product types · rate-card CRUD · client custom fields · commission CRUD (built — Config batch)
The deployment-config surfaces are now runtime-managed. Reuse these patterns; the invariants below are load-bearing.
- **Product-type catalogue (the engine's behaviour seam).** `product_type_catalogue` (key PK · label ·
  `behaviour` enum `tiered|greenfield|standard_addon` · `is_system` · `is_active`) replaced the fixed Prisma
  `ProductType` enum (dropped); `products`/`commission_flat_rates`/`incentives.scope_product_type` are String
  FKs → `catalogue.key`, `sale_items.product_type` is a plain snapshot (no FK, #2). **CRUD lives in the
  COMMISSION module** (it's an engine-config concept): `GET /v1/product-types` (authenticated reference) +
  `POST`/`PATCH /:key` (**`product_types:edit`** — its own RBAC module; originally `commission:edit`, re-pointed
  in the RBAC-governance batch so the catalogue is grantable independently of Commission Config). **A new type is FORCED `standard_addon`** (behaviour never
  client-supplied) so it can NEVER change tally/greenfield logic (#5/#9); the 4 core types are `is_system`
  (behaviour immutable, non-deletable, non-deactivatable). **Q2: create may carry an inline COMMISSION flat
  rate** written to `commission_flat_rates` in the same `$transaction` (the catalogue row stores no rate — #3
  holds; this is the commission stream, distinct from the product inline CLIENT-BILLING rate). FE:
  `features/productTypes/` (DataTable manager at `/admin/product-types`) + `useProductTypes()`; the hard-coded
  `PRODUCT_TYPES` arrays were replaced by the live catalogue in the product / flat-rate / incentive / filter
  dropdowns; `productTypeLabel` humanizes unknown SA keys.
- **`billing_rates` module (SA-only).** The 17th RBAC module — its 6-action grid gates the client rate cards,
  granted to **Super Admin only** by default (Admin/Manager/Rep lose default rate visibility; a custom
  Business-Partner role can be granted `billing_rates:view`). The nested `/v1/clients/:id/billing-rates`
  endpoints were re-gated (`view`/`create`) and gained **`PATCH`/`DELETE .../:rateId`** (`edit`/`delete`).
- **Rate-card + commission CRUD honour #10 (pending-only edit/delete).** `billing-rates.service` +
  `tier-schedule`/`flat-rate`/`holdback` services gained `update`/`remove` restricted to **pending** rows
  (current/past → 422, supersede instead); edit re-runs `planSupersession`, delete re-opens any predecessor it
  had bounded (no gap). Shared `commission/effective-edit.util` (`assertPending`/`resolveEditWindow`).
  Incentives gained `remove` (only if no `sale_item` references it — else end it, #2). FE: `EffectiveDatedTable`
  grew an optional `rowActions` slot; the clients `BillingRatesPanel` (gated `billing_rates:view`, hidden
  otherwise) + the commission sections offer pending-row Edit (reusing the create modals in an edit mode) +
  Delete (`ConfirmDialog`); tier-edit = delete + re-add (the bracket editor is the create surface).
- **Product create inline CLIENT-BILLING rate** — `CreateProductDto.initial_billing_rate` (rate_kind
  `product`) written with the product in one tx; providing it additionally requires `billing_rates:create`.
- **Client custom fields** — `client_custom_fields` (name/value + display_order, no cascade); Create/Update
  client accept a `custom_fields[]` REPLACED in a tx; the detail GET includes them. FE: a `useFieldArray` on
  `ClientFormModal` (edit fetches the detail first so existing fields load before a save — never wiped) +
  display on `ClientDetailPage`.
- **Two hand-authored migrations** (`product_type_catalogue`, `client_custom_fields`) — operator runs
  `migrate deploy` + re-seeds bootstrap (idempotent: 4 core types `is_system`, the `billing_rates` grid).
  **Verified LOCAL only** (backend 68 suites/350 tests + build green; contract regen; frontend build + lint +
  stylelint green). Light/dark + live-data visual pass needs a browser.

### Dashboards & Reporting overhaul (built — Operations queues · Business KPIs · trends · scoped Manager/Rep · greenfield)
The read-layer is now real end-to-end. **Money invariant holds throughout: dashboards are READ-ONLY aggregation
over frozen tables — no commission is recomputed, no new money logic.** Reuse these patterns.
- **`reports:business` (off-grid, SA-only)** — a `business` `PermissionAction` value (migration
  `reports_business_action`) seeded off-grid; gates `GET /v1/dashboards/business` + `…/business/trends`. The
  `SalesTarget`/`sales_targets` entity ALREADY existed (original 48-entity schema / init migration) — no new
  table; BE-4 wired its CRUD.
- **Business dashboard (`dashboards.service#business`)** — period-aware (default = current period). KPIs READ
  from frozen tables: revenue (`client_statements.total_amount`), payout (`pay_run_lines.net_payout`), net
  margin $/% (display), holdback {held/scheduled `holdback_ledger`, released `pay_run_lines.holdback_release_30`},
  clawback total + **rate** (= clawback ÷ `commission_70`), expense km/other (`expense_items` by category),
  activations by product/client + internet + greenfield $ (`sale_items.commission_paid`), validation funnel,
  tier distribution (all active reps bucketed via `countToTier`), client mix, and PoP growth. One bounded
  confirmed-items `findMany` reduces the count breakdowns in JS.
- **Trends (`#businessTrends`, `GET …/business/trends?periods=N`)** — last N periods (≤24) reduced from single
  `findMany` passes; returns headline series + `by_product` / `by_client_revenue` / `tier_distribution` over
  time. **Bounded in-app aggregation; materialized views stay deferred.**
- **Manager (`#manager`)** — roster AGGREGATE money (payout/holdback) + top performers by activation count +
  target-vs-actual ALWAYS; **per-rep payout + money-ranking only when the caller holds `hrm:edit`** (the
  payment_details gate), built/omitted server-side (`can_see_rep_money`). **Rep (`#rep`)** — adds own target +
  recent sales. **Targets** (`targets.{service,controller}`): `GET /v1/sales-targets` (scoped) + `PUT`
  (`hrm:edit` + roster-scope check).
- **FE** — `features/dashboards/`: business page rebuilt (KPI `StatCard`s + funnel + by-product/tier/client
  bars + `BusinessTrends`); new token-themed `ThemedLineChart` / `ThemedStackedAreaChart` + `SeriesTooltip`
  (colours from `--chart-N`, lazy-loaded). Manager/Rep pages scoped (roster aggregates, `SetTargetsModal`,
  rep target + recent-sales). **Operations queues** are all live (`AdminQueueCard` `to` for every card; a
  `/documents?queue=awaiting-signatures` preset + the `pending_signatures` documents filter, with the admin
  count counting those DOCUMENTS so count==queue); **expense approvals gained bulk-approve** (`BulkActionBar`).
- **Greenfield** — `Switch` gained `tone="success"` (grey off / green on); `SaleForm` uses it; `GreenfieldBadge`
  is now green "Greenfield" / muted "Standard", shown across the sales list/detail/validation queue.
- **Verified LOCAL only** (backend 69 suites/358 tests + build green; contract regen — 2 enum migrations
  `reports:business` only; frontend build + lint + stylelint green). Operator: `migrate deploy` + re-seed
  bootstrap to add `reports:business`. Light/dark + live-data visual pass needs a browser.

### Holdback release rule · dual-mode incentives · password reset/invite + email · team management (built)
The confirmed-rules batch — all CONFIRMED rules + a new feature, money/security paths.
- **Holdback release (CONFIRMED).** `holdback-release.logic#resolveScheduledReleasePeriod` parses the sticky
  structured rule `cycles:N` / `days:N` (`next_cycle_after_30_days`=`days:30` alias). The SA picks it once in
  Commission Config (`ReleaseSettingSection` — mode + N, future-holds-only). Pay Run finalize applies a
  **clawback set-off**: a rep's pending clawback reduces the due release first (records
  `holdback_ledger.clawback_applied`, lowers `amount_released`), remainder hits net — recovered once, net
  unchanged. Surfaced in `HoldbackPanel`/`LineBreakdownDrawer` (a "set-off" column). Specs: both modes + the
  set-off.
- **Dual-mode incentives (CONFIRMED).** Enum `target_based` → **`one_time`** (rename migration). The engine
  applies both threshold-relative: `per_activation` pays beyond `target_count` (null/0 = all), `one_time` pays
  one bonus at the threshold-crossing activation; period-level pass, separate from the 70/30 base (#1), frozen
  in the snapshot (#2). FE `IncentiveModal` has both modes + a threshold field + per-mode help (ProposedChip
  gone). Fixtures for both modes + boundary.
- **AUTH-002 (Resend wired).** `common/email` `MailerService` (Resend, env-gated graceful) + the notification
  `EMAIL_DISPATCHER` rebound to it. **Invite** (`CreateUserDto.password` optional → set-password link),
  **forgot** (`@Public`, non-enumerating) + **reset** (`@Public`) via single-use hashed `PasswordResetToken`,
  **admin reset** (`POST /v1/users/:id/reset-password` link|temp — admin never sees the password). **Policy**
  (`auth/password-policy.ts`) + **lockout** (`failed_login_attempts`/`locked_until`, 5/15 default) +
  `must_change_password` (login + `/me`; FE `RequirePasswordChange` gate → `/change-password`). FE pages:
  `features/auth` (forgot/reset/set-password) + the invite/reset UI in User Management. **DNS for
  `app.redwavemarketing.ca`** is operator-set in Namecheap (records in `docs/external-services.md` §2; the
  DKIM value comes from the Resend dashboard).
- **Team management.** `POST /v1/reps/bulk-assign-manager` (`hrm:edit`) + the `?fieldManagerId=` manager-team
  filter (the roster scope `ScopeService.getRepScope` already reads `field_manager_id`). FE: the reps roster
  `DataTable` gains bulk-select + an "Assign manager" action + a manager filter.
- **No new permission** (release/incentive = `commission:edit`; team = `hrm:edit`; invite/reset =
  `users:create`/`users:edit`; forgot/reset = `@Public`). New env: `RESEND_API_KEY`/`EMAIL_FROM`/
  **`APP_BASE_URL`** + `LOCKOUT_*`/`*_TTL_MINUTES`. **`APP_BASE_URL` is the SINGLE source for every
  user-facing email link** (`common/email/app-link.ts`: trailing-slash-normalized, proper URL joining;
  legacy `APP_URL` honored, deprecated): dev defaults to `http://localhost:5173`; **in production there is
  NO default** — unset → a loud startup error and the mailer **REFUSES to send link-bearing emails**
  (fail-safe; this fixed the prod bug where reset/invite/temp-password emails linked to localhost). Migrations: `incentive_one_time` (enum rename) + `auth_reset_lockout` (User
  cols + `password_reset_tokens`). **Verified LOCAL** (backend 80 suites/456 tests + build green; contract
  regen; frontend build+lint+stylelint green). Operator: `migrate deploy` + set the Resend env + DNS;
  light/dark + live-email visual pass needs a browser + a configured Resend domain.

### Security hardening — cookie/CSRF · helmet/CSP · MFA · sessions · Swagger lock · audit view · rate-limit · PII (built)
The security batch. Authoritative posture doc: **`docs/security.md`**. Server-side RBAC is still the real
gate; the audit trail is append-only.
- **Refresh → httpOnly rotating cookie + double-submit CSRF.** `refresh_sessions` table; the cookie value is
  opaque `<sid>.<secret>` (only the secret HASH stored), **rotated** each `/v1/auth/refresh` — replaying an
  old secret is **reuse → the session is revoked** (breach detection). `rw_refresh` (httpOnly) + `rw_csrf`
  (readable) cookies; `Secure`+`Domain=COOKIE_DOMAIN` in prod only (dev host-only via the Vite proxy). Access
  tokens carry `sid`; `JwtAuthGuard` rejects revoked sessions → **immediate** force-logout. `TokenService.
  verifyAccess` accepts `JWT_ACCESS_SECRET` or `*_OLD` (zero-downtime secret rotation). A **global**
  `CsrfGuard` checks `X-CSRF-Token == rw_csrf` on mutating cookie-session requests (skips safe methods,
  `@CsrfExempt` pre-auth routes, and Bearer/API requests with no csrf cookie). **Duplicate-cookie safe (prod
  403 fix):** the guard matches the header against EVERY `rw_csrf` value in the raw Cookie header — a stale
  HOST-ONLY cookie from a pre-`COOKIE_DOMAIN` deploy sorts first and shadowed the fresh domain cookie for
  cookie-parser (403 on every mutation); cookie ISSUE also expires the host-only variant of both auth cookies
  first, so affected browsers heal on the next login/refresh (`cookie.util.ts#allCookieValues`). FE: the
  refresh token is NO LONGER in localStorage / the JSON body — `doRefresh()` POSTs with `credentials:'include'`
  + the CSRF header; the client + multipart uploads send both on every request (locked by `api/client.test.ts`);
  multi-tab logout via a localStorage ping.
- **MFA (TOTP + recovery codes), policy-driven.** `user_mfa` + `mfa_recovery_codes` (otplib; 10 hashed
  one-time codes, shown once). Enroll/disable from **My Account → Security** (`/auth/mfa/{setup,enable,
  disable}`); login is two-step when enrolled (`mfa_token` challenge → `/auth/mfa/verify`, no session until
  verified). Policy: `roles.mfa_required` (SA seeded true) + singleton `security_settings.mfa_enforced`
  (**default OFF** so testers aren't locked out) at `/admin/security` (`settings:view/edit`); when ON, a
  required-role un-enrolled user is routed to `/setup-mfa` (RequireMfaEnrollment; `/me` carries
  `mfa_enrollment_required`). SA force-logout + disable-MFA on `/v1/users/:id` (`users:edit`); active-session
  list/revoke at `/v1/auth/sessions` (self) + the My-Account sessions panel.
- **Headers.** Helmet on the API (HSTS prod, frame-ancestors none, nosniff, referrer, strict API CSP; relaxed
  CSP on `/docs`). SPA security headers in `frontend/vercel.json` (CSP with `script-src 'self'` — the theme
  boot is externalised to `public/theme-boot.js`; `worker-src blob:` for pdf.js; `connect-src` = API origin +
  Maps + Supabase — **operator sets the real API origin**). **Swagger `/docs` is disabled in prod** unless
  `ENABLE_SWAGGER=true` + HTTP Basic (`SWAGGER_USER`/`SWAGGER_PASSWORD`).
- **Audit (append-only).** `audit_log.ip_address` stamped from an `AsyncLocalStorage` request context.
  New `audit` RBAC module (`audit:view`/`export`, **SA only**). `GET /v1/audit-logs` (filter actor/entity/
  action/date + pagination) → the SA **Audit log** page (`/admin/audit`) with a before→after drawer; the same
  endpoint filtered by entity powers the reusable **`<HistoryTab entityType entityId/>`** (the Batch-1
  deferred per-record history), wired into the Sale detail as the reference adoption. **No write/update/delete
  path — the trail stays immutable.**
- **Chatbot rate-limit/cost-cap.** Per-user 60s window (`CHATBOT_RPM`, in-memory) + daily cap from the
  persisted conversation count (`CHATBOT_DAILY_CAP`); over the limit → a **graceful 200** (`intent:
  'rate_limited'`, a normal assistant bubble), never an error. (Dropped the unused `@nestjs/throttler`.)
- **PII / exports.** Pay-run + expense exports now scope to the caller's reps (manager=roster, rep=own,
  admin/SA=all) — the pay-run export previously leaked every rep's pay. PIPEDA stance + secrets-rotation
  runbook in `docs/security.md`.
- **Migration** `20260610170000_security_hardening` (additive: 4 tables + `roles.mfa_required` +
  `audit_log.ip_address`). New env (see `.env.example` / `docs/security.md`): `NODE_ENV`, `COOKIE_DOMAIN`,
  `CORS_ORIGIN`, `ENABLE_SWAGGER`, `SWAGGER_USER`/`PASSWORD`, `MFA_ISSUER`, `MFA_CHALLENGE_TTL`,
  `CHATBOT_RPM`/`CHATBOT_DAILY_CAP`, `JWT_ACCESS_SECRET_OLD`. **Verified LOCAL** (backend 84 suites/489 tests
  + build + contract regen green; frontend build + lint + stylelint + tsc + session test green). Operator:
  `migrate deploy` + re-seed bootstrap (adds the `audit` perms + SA `mfa_required` + `security_settings`) +
  set the env + the Vercel CSP `connect-src` origin. Live cookie/CSP round-trip + a real MFA enrol + the
  light/dark visual pass need a browser.

### Billing — gapless numbering · immutability · reconciliation · QuickBooks (built — Billing batch)
The client-billing surface is now accounting-grade. Reuse these; the invariants are load-bearing. Posture
unchanged: priced SOLELY from `client_billing_rates` (#3, `billing.no-commission.spec` still green), ONE LINE
PER CUSTOMER, **NO GST**, single-currency **CAD**.
- **Gapless sequential numbers.** `document_sequences` (key `statement`/`invoice`, `current_value`) is the
  per-type counter, incremented **atomically inside the issue `$transaction`** (`SequenceService.next(tx,key)`
  → row lock → gapless, concurrency-safe). Display `STMT-00001` / `INV-00001`. Numbers are minted ONLY on
  issue (never on preview). Scheme = **global per document type** (issuer-side register).
- **Immutability = append-only versions.** A generate CREATES a NEW numbered `issued` statement/invoice and
  marks the prior current one `superseded` + `superseded_by_id` (metadata only — number/total/lines/file are
  **never** mutated; lines are never deleted). A correction is just another generate → a new numbered doc.
  Replace-in-place is GONE. "Current" = the issued version; the list shows every version (audit trail).
- **Preview.** `POST /v1/clients/:id/statements/preview` (`billing:create`) returns the one-line-per-customer
  draft + total, **not persisted, no number minted** (422 on an unpriced product, like generate).
- **Real files, rendered on demand from the FROZEN record.** `statement-excel.renderer` (exceljs),
  `invoice-pdf.renderer` (pdf-lib), `quickbooks-csv.renderer` (QB-mappable CSV, no tax, CAD). `GET
  /v1/{statements,invoices}/:id/download` (`billing:view`, `?format=excel|quickbooks` for statements) STREAMS
  the bytes (works with storage off); `POST …/export` (`billing:export`) additionally records a
  `billing_exports` row + uploads via `common/storage` when configured, then streams. FE downloads use
  `lib/api/downloadFile` (raw fetch + bearer + CSRF → blob).
- **Reconciliation (`modules/reconciliation/`, NOT in billing/ — keeps the #3 scan clean).** `GET
  /v1/reconciliation/statements` (`billing:view`): statement total = Σ lines = Σ **live re-priced** confirmed
  sales (a drift = stale → flag). `GET /v1/reconciliation/pay-runs/:id` (`payrun:view`): each line's net =
  `computeNet(components)` (reused from payrun), run total = Σ net → flags mismatches. **Two INDEPENDENT
  checks; never joins the two rate streams.** FE: `/admin/reconciliation` (Money nav + Admin hub card).
- **Central rounding policy = `common/money`** (`roundMoneyHalfUp`/`formatMoney`/`sumMoney`): exact decimal
  in storage, **2dp HALF_UP at the presentation boundary only**, CAD. Used by billing + exports +
  reconciliation; the FE authority is `lib/format/money#money`. (The isolated Commission Engine keeps its own
  identical helper to preserve §6 purity — same rule, separate stream.)
- **Single-currency CAD (CONFIRMED).** No FX/multi-currency code anywhere; on-screen `$`, exports labelled CAD.
- **No new permission** — `billing:view/create/export` (Admin + SA) cover everything; pay-run tie-out reuses
  `payrun:view`. Migration `20260611120000_billing_numbering_immutability` (additive: numbers/status/
  superseded + `document_sequences` + `billing_exports`; `file_url` nullable; invoices gain `generated_by`;
  bootstrap seeds the counters idempotently — **never resets** an existing one). **Verified LOCAL** (backend
  88 suites/511 tests + build green; contract regen 131 paths; frontend build+lint+stylelint+tsc green).
  **Excel/PDF layout is a faithful GENERIC default — refine against Redwave's real client template** (same
  stance as the import templates). Operator: `migrate deploy` + re-seed bootstrap + set Supabase storage; the
  real-file/visual pass needs a browser + the real template.

### Bundle-bonus pricing into statement/invoice totals (built — configurable trigger, client-bill only)
`bundle_bonus` billing rates are now **applied** to client statement/invoice line totals (previously only
`rate_kind='product'` priced; add-on **products** were already billed). Still **client-bill only** (#3 — the
commission engine/stream is untouched; `billing.no-commission.spec` stays green). Reuse this shape.
- **The trigger is configurable, not special-cased.** `client_billing_rates.bundle_product_types String[]`
  (migration `20260616000000_bundle_trigger`, additive `TEXT[] DEFAULT '{}'`) lists the product-type
  catalogue keys that must ALL be present on a sale for the bundle to apply (e.g. `{home_phone,tv}` for RF
  Now's $35 HP+TV). Stored **SORTED** so it keys the effective-dating scope deterministically; empty for
  every non-bundle rate.
- **Validation (`billing-rates.service#resolveBundleTypes`):** a `bundle_bonus` needs **≥2 distinct active
  catalogue types** and **no `product_id`** (client-wide; 422 otherwise); any other kind must carry an empty
  set (422 if given). The trigger is part of the bundle's identity (set at create, immutable like
  `rate_kind`).
- **Effective-dating scope keyed by the trigger set.** `create`'s `existing` query, `update`'s `others`
  query, `remove`'s predecessor `updateMany`, and `groupByScope`'s key all include the sorted trigger for
  `bundle_bonus` rows (`${product_id??'null'}|${rate_kind}|${trigger}`), so **distinct bundles supersede only
  their own history** — HP+TV and Internet+TV don't collide (#10).
- **Application (`StatementService.priceClientPeriod`):** after product pricing, load the client's
  `bundle_bonus` rates grouped by trigger; for each sale whose `sale_item.product_type`s cover a bundle's
  trigger, `selectEffectiveRate` on the **sale_date** and append a **synthetic `PricedItem`**
  `{product_id:null, product_name:"<A + B> bundle", rate}` (once per sale per bundle) — `buildStatement`
  (pure; `PricedItem.product_id` widened to `string|null`) sums it into `line_total`/`total_amount` and shows
  the label in `products_summary`. Bundles are **additive/optional** (a missing bundle rate is simply not
  applied — no 422; the unpriced-422 stays for base **products** only). Clawed-back items are already
  excluded, so a re-issue drops a bundle whose component was clawed back (correct).
- **Frozen-FX is automatic (#12).** The bundle adds to `draft.total_amount` in the **client's currency**;
  `generate`'s `resolveIssueFx` converts the fuller total to `amount_cad` **once** at issue — no FX code
  change. A **USD** client's `(internet + add-on + bundle) USD × frozen rate = amount_cad`; reconciliation
  reads the same frozen figure and re-prices via the same `priceClientPeriod` (consistent by construction).
- **FE:** `BillingRateFormModal` shows a **product-type MultiSelect** (from `useProductTypes`, ≥2) when
  `rate_kind='bundle_bonus'` (hides the product picker; edit shows the trigger read-only as Badges);
  `BillingRatesPanel`'s "Product / trigger" column renders a bundle's trigger (e.g. "Home Phone + TV").
- **No new permission** (`billing_rates:*` gates rate CRUD, `billing:*` gates statements). **Verified LOCAL**
  (backend **642 tests** incl. the USD add-on+bundle statement freeze `385 USD × 1.365 = 525.53 CAD`; tsc +
  contract regen 136 paths; FE gen:api + build + lint + stylelint + tsc green). Operator: `migrate deploy`
  (stacks on the currency migration) — no re-seed needed. Browser pass: add a bundle_bonus trigger HP+TV on
  RF Now, a sale with HP+TV, generate → the line total includes +$35 and the summary shows the bundle; a USD
  client's bundle rolls into `amount_cad` at issue.

### Client expense billing document — split billing (built — BILL-012 / EXP-014, migration `20260617000000`)
The per-client EXPENSE billing document (kilometres + food) — a SEPARATE client-facing document from the
commission statement/invoice, built by REUSING the billing doc machinery. Lives in `modules/billing/`
(intra-module reuse; no cross-module DI). Still **client-bill only** (#3 — reads ONLY `expense_items` +
`km_rate_config(client_bill)`, NEVER a commission table; a `no-commission` structural spec locks it).
- **New entity `client_expense_documents`** (mirrors `ClientStatement`): gapless `document_number` (**CEXP-**,
  minted on issue via the shared `SequenceService` key `'client_expense'`), `status` (issued|superseded,
  self-referential `superseded_by`), the frozen-FX quintet, `selection_filters` jsonb (the rep/day selection),
  and **`line_detail` jsonb** — the FROZEN grouped snapshot (the data-model keeps line detail grouped/derived
  with no sub-table, so it's frozen as jsonb → a re-render is byte-stable even if expenses change). `BillingExport`
  gained `client_expense_document_id`; `kind='expense_bill'`.
- **Pricing (`ClientExpenseDocService.priceExpenseDoc`):** approved, **non-personal** (EXP-012) `km`+`meals`
  items for the client/period (narrowed by the rep/day selection). **km is RE-PRICED** = `roundHalfUp(km_log.
  billable_km × client-bill rate)` — the stored `amount`/`computed_amount` are REP-priced and NEVER reused;
  the client-bill rate resolves via `km_rate_config(stream=client_bill)` + the pure `selectKmRate`, and a km
  item with **no client-bill rate → 422** (never the $0.45 default — decision). **Food = NATIVE currency:** a
  meal is billed at its `amount` only if `original_currency == client.currency`; a mismatch is **excluded +
  surfaced** (`excluded[]`), never converted. The pure `expense-doc.logic.ts#buildExpenseDoc` groups one line
  per **type × rep × day**. Receipts are never referenced (EXP-003).
- **FX + immutability:** `generate` reuses `StatementService.resolveIssueFx` (FX frozen ONCE at issue, #12 —
  CAD→rate 1, foreign→override ?? BoC ?? 422) and the `$transaction { sequence.next → create(issued) →
  supersede prior }` pattern; **preview mints nothing**. A USD doc: `(km@client-bill + native food) USD ×
  frozen rate = amount_cad`.
- **Real PDF + export:** `ExpenseDocPdfRenderer` (pdf-lib) renders from the frozen `line_detail` (grouped km/
  food sections, per rep/day, total, CAD-equivalent if foreign, no receipts); `BillingExportService.
  {render,export}ExpenseDoc` + `record()` (kind `expense_bill`). Endpoints under **`/v1/clients/:id/expense-
  documents[/preview]`** (billing:create) + **`/v1/expense-documents[/:id[/download|/export]]`** (billing:view
  / billing:export) — **no new permission** (reuses the billing grid). FE: `features/expenseDocs/` (generate
  modal with rep/day MultiSelects + preview + excluded banner + FX-override; list; detail; PDF download) under
  the **Money** nav.
- **Verified LOCAL** (backend **665 tests** incl. km re-price ≠ rep amount, km-no-rate 422, currency-mismatch
  exclude, immutability/supersede, the USD freeze `100 USD × 1.365 = 136.50 CAD` + the half-up boundary
  `123.45 × 1.365 = 168.51`; tsc + contract regen 142 paths; FE gen:api + build + lint + stylelint + tsc).
  Operator: `migrate deploy` (stacks on the bundle migration) + re-seed bootstrap (adds the `client_expense`
  sequence key). Browser pass: at `/admin/km-rates` add a **client-bill** km rate; approve a km + a meal for a
  client in a period; generate at `/billing/expense-documents` → a `CEXP-00001` PDF (km + food per rep/day);
  for **CTI (USD)** enter the km client-bill rate + a USD meal → the doc totals in USD and freezes `amount_cad`;
  a km item with no client-bill rate → 422; a CAD meal on the USD client → excluded. **Still deferred:** the
  expense doc is NOT in the reconciliation tie-out scope (statements + pay-runs only); server-side export
  artifacts upload only when Supabase is configured (else a `pending://` record + on-demand download).

### Per-type expense fields + Alert/Warning validation (built — EXP-002a / EXP-013, migration `20260618000000`)
Config-driven per-expense-type CAPTURE fields + a two-level (Alert/Warning) validation engine. Sets up — but
does NOT include — the report-as-folder rework (own sub-plan); alerts aggregate to an interim home (the
approvals/list header) until the report folder lands.
- **Storage (additive):** `expense_field_configs.fields Json` (the per-type field schema — an array of
  `{key,label,type,required,options?,soft_cap?}`) + `amount_soft_cap Decimal(12,2)?` (category-level cap →
  Warning); `expense_items.field_values Json?` (the captured values, like `tags`). No `expense_reports` change.
- **Fields are METADATA ONLY (#1):** the rep enters the total `amount` (authoritative); gratuity/vendor/etc.
  are **never summed** into any total. The pay-run seam + client-expense-doc read `amount`/`amount_cad`
  exactly as before (a money-invariant spec asserts field_values never perturb the reimbursement).
- **Validation is DERIVED / stateless** — the pure `modules/expenses/validation.logic.ts#validateExpenseItem`
  (mirrors `km.logic` purity) recomputes `{alerts, warnings}` from the item + its category schema on every
  read. **Alerts BLOCK save** (missing required amount/receipt/field → the service `assertNoAlerts` throws
  422 with `alerts[]`, folding the old scattered throws into one engine); **Warnings never block** (over a
  soft cap; a **km trip the commute deduction zeroed** → `km_zero_claim`) — the item saves already "flagged".
  Approval is NOT gated by validation (approver judgement, EXP-008). `buildItemContent` also `pickFieldValues`
  (drops unknown/blank keys → schema-enforced jsonb).
- **Read + aggregate:** every `ExpenseItemResponse` carries a derived `validation` block (list + detail);
  `GET /v1/expense-items/validation-summary` aggregates flagged/alert/warning counts over the same filters as
  the list (the approvals-queue header). `field-schema.logic.ts#assertFieldDefs` validates a def array
  (unique snake_case keys, valid type, select→options); `FieldConfigService.update` + **`PATCH
  /v1/expense-field-configs/:key`** (`expenses:edit`) make the schema SA-editable — **no admin editor UI this
  track** (config is API-editable; seed is the default). **No new permission** (`expenses:*` covers it).
- **Seed:** bootstrap seeds default field sets (Meals `vendor*`/city/gratuity/attendees + `amount_soft_cap
  30.00`; Hotel `hotel_name*`/location; Flight airline/route; km/rental/gas/other none) — populated on first
  seed (empty → set), **never clobbering** an SA-customized schema (notification-settings pattern).
- **FE:** `ExpenseItemRow` renders a config-driven **`DynamicFields`** (text/textarea/number/money/date/select)
  for non-km + a live **warnings** Banner; `expenseForm.schema` is schema-aware (required fields → zod errors
  block submit). A pure `features/expenses/validation.ts` mirrors the engine (Alerts block submit, Warnings
  "save anyway"; exact-cents money compare, no float). `ExpenseValidationBadge` (alert→danger/warning→warning,
  Tooltip) in the list cell + detail; `ValidationSummaryBanner` (via `useValidationSummary`) on the approvals
  + list headers; the detail shows captured field_values + the alert/warning banners.
- **Verified LOCAL** (backend **692 tests** incl. the pure engine + field-schema + save-blocking + the
  money-invariant `gratuity never touches amount/amount_cad` + summary aggregation + field-config PATCH; tsc +
  contract regen 144 paths; FE gen:api + build + lint + stylelint + tsc + a validation.test.ts vitest). Operator:
  `migrate deploy` (stacks on `20260617000000`) + re-seed bootstrap (adds the field schemas + soft caps,
  idempotent). Browser pass: a Meals item with no vendor → an Alert blocks save; amount $45 → a Warning (over
  the $30 cap) shows but saves; the item shows a warning badge in the list/detail + the Approvals header shows
  the flagged count; a km trip under 30 km → the "$0 reimbursable" warning; `PATCH .../meals` to add a required
  field → new items enforce it. **Still deferred:** the SA field-schema editor UI; new categories beyond the
  7-value `ExpenseCategory` enum (need an enum migration). *(The interim approvals/list aggregation now also
  lifts onto the folder header — see the "Report-as-folder" §13 build note.)*

### Report-as-folder expense rework (built — EXP-001, Meeting 3, migration `20260619000000`; SAP Concur folder model)
The expense module moved from item-first to **report-as-folder**: a rep CREATES a named report (folder) and
adds items into it; the whole folder is submitted + reviewed as a unit. Built ON TOP of the prior tracks
(validation engine, frozen-FX, per-type fields) — none rebuilt. **The folder is a PURE grouping layer** — a
structural spec (`folder-agnostic.spec.ts`) locks that the pay-run seam, client-expense-doc, and dashboards
NEVER reference `expense_report_id`, and `pay_period_id` stays derived from the item's own `expense_date`, so
every money read counts an item once exactly as before (#1/#12 untouched — no regression).
- **Data model:** `expense_reports` (the dormant wrapper) becomes the live folder — **added `name`**, **dropped
  the vestigial `status`/`approved_by`/`approved_at`/`pay_period_id`** (folder status is DERIVED, not stored);
  **`expense_items.expense_report_id` → NOT NULL**; a **backfill** wraps any report-less items into
  `(submitter, rep, business-week Mon–Sun)` folders (`date_trunc('week', expense_date)`). Keep `name`,
  `submitted_by`, `rep_id`, `week_start`/`week_end` (a **label only** — never overrides an item's pay period).
- **Item state machine:** item create now lands in **`draft`** (was `submitted`) and **requires a folder**;
  `POST /v1/expense-reports/:id/submit` transitions the folder's `draft|sent_back` items → `submitted` (+ the
  approver notification, moved off create). Pure `folder-status.logic.ts#deriveFolderStatus` → `empty →
  needs_attention → draft → pending → approved → rejected` (aggregate of item statuses).
- **RBAC edit rule (§5, server-side):** the owner-capable writes floor at **`expenses:create`** with service
  authorization — the **OWNER** edits/deletes while **unapproved**; once **approved**, only **Admin/Super
  Admin** may correct (a Manager with `expenses:edit` is refused). Field-config CRUD stays `expenses:edit`.
- **Folder API** (`modules/expenses/`, new `ExpenseReportsService` + `folder-status.logic`, reuses
  `bulkReview` + the validation engine): `/v1/expense-reports` create/list(paginated, scoped, derived
  status+total+aggregated validation; `?awaiting_review=true` = the approval queue = folders with a submitted
  item)/detail(+items with per-item validation)/rename/**delete-cascade** (422 if any approved)/**submit**/
  **review** (bulk over items). No new permission.
- **FE** (`features/expenses/`): `/expenses` is a **SegmentedControl "Folders | All items"** (folders =
  `FoldersTable` with derived status + total + flagged count + admin row quick-actions; "All items" = the
  kept flat table + export). **New report** modal (Mon–Sun week pre-filled, pure `businessWeek`). The
  **workspace** `/expenses/reports/:id` = header (status + aggregated validation + Submit/Approve-all/Return-
  all/Reject-all/Rename/Delete) + **collapsible item rows** (hand-rolled per the `audit/HistoryTab` pattern —
  one expands at a time; inline Edit via the now edit-only `ExpenseForm`; per-item Review) + a full-width
  **"Add expense"** control that stays open for fast multi-add (`InlineItemForm`). Approvals page = the
  folder queue. Item creation is folder-only now, so `/expenses/new` + `ExpenseForm` create-mode were removed.
- **Verified LOCAL** (backend **716 tests** incl. `folder-status`, `ExpenseReportsService`, the folder-agnostic
  regression lock, and the owner/Admin+SA edit rules; tsc + contract regen 148 paths; FE gen:api + build +
  lint + stylelint + tsc + `businessWeek` vitest). Demo seed rewritten to create → submit → approve folders.
  Operator: `migrate deploy` (stacks on `20260618000000` — runs the backfill + NOT-NULL alter) + re-seed
  (`SEED_DEMO=yes`). Browser pass: create a report (week pre-filled) → add several items via the repeated Add
  control → the header shows the flagged count + derived status → Submit → it appears in the approver's folder
  queue → Approve-all (or open + per-item, incl. a foreign FX item) → an approved item edits only for Admin/SA,
  unapproved for the owner → delete cascades unapproved (422 if approved) → the pay run + a client expense doc
  read the same approved items unchanged. Verify at 360px. **Deferred:** a per-item "Add expense here" button
  between rows (the below-list control + fast multi-add covers the need); no `paid`-lock on an approved item
  (an Admin/SA correction never alters a FINALIZED pay run's frozen line — only not-yet-frozen reads).

### RBAC governance for admin surfaces + system-wide double-scroll fix (built — NO migration; seed-only)
A browser pass showed a **Sales Rep seeing Administration-area tabs** and the **Roles matrix unable to govern
some tabs**. Root cause: those surfaces were gated on **read** perms reps legitimately hold (`clients:view`,
`expenses:view`, `reports:view`), and two admin surfaces had **no permission of their own**. Fixed by proper
governance; the server was always the real gate (§5 — this was a visibility leak, not a security hole).
- **Two new RBAC modules — `km_rates` + `product_types` (seed-only; NO Prisma migration; the 6 grid actions
  already exist).** Added to `common/rbac/rbac.constants.ts#MODULE_KEYS` (18 → **20**) + `bootstrap.ts`
  `MODULE_NAMES`; the grid loop auto-creates their 6 perms; `ADMIN_GRANTS` gains `km_rates:{view,edit}` +
  `product_types:{view,edit}` (Super Admin auto). **Re-pointed** `km-rate.controller` (`expenses:view/edit` →
  `km_rates:view/edit`) and `ProductTypesController` writes (`commission:edit` → `product_types:edit`); the
  `GET /v1/product-types` reference read stays **permission-free** (form dropdowns). **Managers intentionally
  lose km-rate management** (they held `expenses:edit`; km rates are org config).
- **Off-grid perms are now controllable in the Roles matrix.** `PermissionMatrix.tsx` renders an **"Additional
  permissions"** section for every permission whose action ∉ the 6 grid columns (`reports:business`,
  `notifications:broadcast`, generic), each its own checkbox; the module-row "select-all" (`idsForModule`) now
  covers **grid actions only** (kills the old indeterminate leak where the row toggle secretly swept them). The
  two new modules appear as normal rows automatically (no FE change).
- **Sidebar / hub re-gated so reps stop seeing admin config** (`Sidebar.tsx`, `AdminHomePage.tsx`):
  `ADMIN_CARD_PERMS` drops `clients:view`; Clients/Products → `clients:create`; Product Types →
  `product_types:view`; KM Rates → `km_rates:view`; **Reports moved to the Dashboards group** (reps keep it
  via `reports:view`, so the Administration group is now truly admin-only and vanishes for reps). The two admin
  pages' `useCan` gates re-pointed to the new perms (`KmRatesPage`, `ProductTypesPage` — the latter now
  view-gates the page + edit-gates Add/row-Edit). Clients/Products pages + backend unchanged (`clients:view`).
- **Double-scroll / footer fix (system-wide).** The shell is a correct single-scroller with a pinned footer;
  wide/tall **tables** were the culprit (`overflow-x:auto` → a phantom both-axes scroll container with sticky
  headers anchored to it, colliding with the footer). Fix = **bounded self-scrolling panes**: `PermissionMatrix
  .scroll` → `overflow:auto` + `max-height:72vh`; the shared `Table` gained an opt-in **`maxHeight`** prop
  (adds `.pane { overflow:auto }` + inline max-height) threaded through `DataTable` with a **default `'72vh'`**,
  so every full-page list is contained (sticky header works, footer never overlapped) while short lists stay
  under the cap (unchanged) and modal/embedded `Table`s (no `maxHeight`) are untouched.
- **No migration** (modules/perms are seeded rows). **Operator: re-seed bootstrap** (idempotent — adds the 2
  module rows + 12 perms + Admin grants; SA auto). **Verified LOCAL:** backend 716 tests + build + contract
  regen (148 paths; description-only diff); FE gen:api + build + lint + stylelint green. Browser pass: a rep
  no longer sees the Administration group (deep-link `/admin/km-rates` → AccessDenied); the SA Roles matrix
  shows KM Rates + Product Types rows + the Business/Broadcast toggles; the matrix + long lists scroll within
  their own pane with the footer clean (360px + light/dark).

### Per-client commission rates + the client price chart (built — review items 5/12/19; migration `20260622000000`)
Commission tier schedules and flat rates can now be scoped to ONE CLIENT, effective-dated by the same
supersession as everything else, with the **global row as the fallback**. Reuse this shape; the invariant
framing below is load-bearing.
- **Not a #3 violation.** Scoping commission rates *by* client reads nothing from `client_billing_rates` —
  it stays the rep-commission stream, scoped by client exactly like `incentives.scope_client_id` and
  `km_rate_config`. A `Client` back-relation on a commission table *looks* like #3 on review; it is not.
- **#5 is preserved absolutely — the TALLY stays client-blind.** `commission-engine.service.ts` counts every
  internet activation across all clients into ONE number (the line is commented as forbidden to filter by
  client), then resolves the bracket via a memoised `bracketFor(clientId)` = `determineTier(internetTally,
  tiersByClient[clientId] ?? tiers)`. Per-client means a per-client **rate**, never a per-client tally.
  A regression spec (`#5 REGRESSION: the tally ignores clientId entirely`) locks it.
- **Schema (additive):** `commission_tier_configs.client_id` + `commission_flat_rates.client_id`, both
  nullable UUID FK → `clients` (RESTRICT) + an index. **No unique constraints** (supersession is procedural;
  Postgres treats NULLs as distinct). **`HoldbackConfig` stays GLOBAL** — a per-client split would need
  per-client rounding and would break the derived `advance + holdback === gross`. Deliberately out of scope.
- **Resolution** = the pure `commission/client-scope.logic.ts` (`scopeWhere`, `scopeKeyOf`, `selectForClient`,
  `selectEffectiveByScope`), generalising `selectKmRate`. Scopes key on `client_id ?? 'GLOBAL'` (spec mocks omit
  the field, so `=== null` would drop the global row). `common/effective-dating.ts` needed **zero changes** —
  it is scope-agnostic; only the `where` clauses and grouping keys changed.
- **`EngineConfig` keeps `tiers`/`flatRates` as the GLOBAL fallback** and ADDS optional `tiersByClient` /
  `flatRatesByClient`. Leaving the existing fields untouched is what lets all 14 original engine fixtures
  pass verbatim. `getEngineConfig(date)` **keeps its `(date)` signature** — ONE call per run, as-of close; a
  `clientId` parameter would let a single run straddle effective dates.
- **`PeriodResult.tierNumber` / `ratePerActivation` are now "the UNIFORM value, else null"** — the honest
  representation once clients can differ. Per-item `tierAtPayment`/`rateApplied` stay exact, so the frozen
  snapshot (#2) loses nothing; the pay-run drawer says *why* the line scalars are blank ("Mixed client rates").
- **THREE latent bugs this surfaced and fixed** (all would have corrupted other scopes): (1) the provider and
  `dashboards#effectiveTierBrackets` handed **ungrouped** headers to `selectEffectiveRate`, so a per-client
  row with a later `effective_from` would have become the GLOBAL schedule for everyone — the provider now
  groups by scope first, and dashboards read `client_id: null` explicitly (the indicative tier-progress
  ladder); (2) both `remove` paths re-opened bounded predecessors with **no client filter**, resurrecting
  another scope's superseded row — now scope-bound. Bootstrap idempotency guards gained `client_id: null`.
- **Engine purity is now ASSERTED, not just documented** (`engine/engine.purity.spec.ts`, modelled on
  `billing.no-commission.spec.ts`): a source scan bans Prisma/DB/sibling imports, Prisma delegates, and any
  clock/randomness; behavioural tests assert zero constructor deps, identical output across instances, and
  that neither the config (incl. the per-client maps) nor the activation list is mutated.
- **`client_id` is immutable on edit** (like `rate_kind`/`product_type`); an unknown/inactive client is a 422
  from the shared `client-scope.util#resolveClientScope` — never a silent global write. List endpoints take
  `?client_id=` (a client id, the literal `global`, or omit for every scope). **No new RBAC**
  (`commission:view`/`edit`).
- **FE:** `features/commission/` gained a page-level **`ScopeSelector`** (All scopes / Global / one client)
  threaded to the tier + flat-rate sections; **`commissionKeys.tiers()/flatRates()` now carry the clientId**
  (without it the cache serves one client's schedule to another). Both modals share a **`ClientScopeField`**
  (mirroring `IncentiveModal`'s scope_mode radio) and pre-select the page scope; the "All scopes" view gains
  an "Applies to" column; an empty client scope reads "no schedule of its own — paid at the global rates".
- **Review #12 needed NO code (rejected a speed column).** Speeds are PRODUCTS: the sale-entry picker maps a
  client's products unconditionally, does not dedupe by `product_type`, and `Product` has no
  `@@unique(client_id, product_type)` — so `Internet 500Mbps` / `Internet 1Gbps` appear as separate options
  with no deploy. Client BILLING rates are per-product (per-speed pricing already works); commission rates
  are per-product_type, so all speeds of a client earn that client's tier rate.
- **Review #19 — the price chart** (`features/clients/priceChart.ts` + `PriceChart.tsx`): the rates panel is
  now a SegmentedControl "Current prices | Rate history". The chart is a **pure selection projection** (no
  arithmetic, #1; server-derived statuses, no date math) — one row per product with today's rate + the next
  scheduled change, then one row per client-wide rate (each bundle trigger its own row). **A product with no
  current rate stays visible and is flagged** — that is exactly the condition that 422s a statement as
  unpriced. Same `billing_rates:view` gate; both views share one query key so there is no second fetch.
- **Verified LOCAL** (backend **773 tests** — 19 engine incl. 5 per-client fixtures + the purity guard, the
  provider scope-grouping specs, and the service isolation specs; build + contract regen 149 paths; FE
  gen:api + build + lint + stylelint + 61 vitest incl. `priceChart.test.ts`). Operator: `migrate deploy`
  (additive — existing rows keep `client_id = NULL` = global, so behaviour is **unchanged** until a
  per-client row is added). Browser pass: Commission Config → scope to a client → add a tier schedule + flat
  rate → a rep selling for that client AND another is paid each client's rate off ONE shared tally (the
  drawer shows "Mixed client rates"); the client record shows the current price chart; adding
  `Internet 1Gbps` under a client makes it selectable on sale entry with no deploy.

### Weekly client billing + the wide statement line (built — review items 4/7/8/9; migration `20260623000000`)
The client statement now reproduces the workbook Redwave actually sends (`docs/uat/billing-target-format.md`,
verified against `docs/uat/Sample Billing for Client.xlsx`). Three defects, one cause: the line was too narrow
and only ONE rate kind was priced. Still **client-bill only** (#3 — `billing.no-commission.spec` green, and it
now scans the two new files automatically).
- **`billing_periods` — billing has its OWN calendar.** Weekly **Mon–Sun**, sequential `period_number` =
  "Bill 17", seeded for 2026 by the pure `modules/billing/billing-periods.seed-data.ts` (anchor Mon
  `2026-01-05`). Deliberately NOT the pay period: pay periods run **Sun–Sat biweekly**, so a bill straddles
  two of them. Statements + invoices gained `billing_period_id`; **`pay_period_id` relaxed to nullable** so
  documents issued before the change keep theirs. `GET /v1/billing-periods` (`billing:view`, read-only +
  seeded, like pay periods). **No new RBAC permission.**
- **Every rate kind is applied now** (`statement.service#priceClientPeriod`, ONE rate read split by kind):
  internet = the product rate on the internet product (per speed); **TV/HP = the client-wide `tv_addon` /
  `hp_addon` if in force, ELSE the TV/HP product rate** — the add-on WINS, they never stack, so today's
  product-rate data (per `docs/rate-grid.md`) bills identically and a client migrates by simply adding an
  add-on rate; `bundle_bonus` unchanged; **`spiff`** is client-wide + date-bounded by its own
  `effective_from`/`to`, and that window is FROZEN on the statement (`spiff_from`/`spiff_to`) so the column
  header reproduces on a re-render. Everything else priced lands in **`other_total`** (never dropped).
  **A product priced by no kind at all is still a 422** with `unpriced[]`.
- **The line is the client's row** (`client_statement_lines`, all new columns nullable + `sort_order`):
  sale_date · rep_code · rep_name · customer first/last · address · channel · product_name ·
  has_internet/tv/home_phone · internet_rate · tv_rate · hp_rate · bundle_bonus · spiff · other_total ·
  line_total. **`line_total` is the EXACT sum of the six components** (spec-locked over many compositions).
  `statement.logic.ts` stays pure; it gained `splitCustomerName` as the LEGACY fallback only.
- **`sales.customer_first_name` / `customer_last_name`** — the bill prints them as separate columns. Captured
  on the sale form + the `sales_entry` import target; **`customer_name` is DERIVED** from the pair in ONE
  helper (`sales.service#customerNameFields`) so the two can never drift. Sales entered before the split are
  split at generation.
- **The Excel IS the target format** (`statement-excel.renderer`): 17 columns, header on row 2, **summary
  strip on row 1** as live `COUNTIF` / `SUBTOTAL(9,…)` over an **autofiltered** range — so the client's
  filtering updates the totals, exactly as the source workbook does. Real Date + Boolean cell types (so
  `COUNTIF(…,TRUE)` matches). An **"Other" column appears only when a row carries one**, keeping the default
  output at exactly 17 columns. Read-back assertions in `renderers.spec` lock the layout.
- **The UI still computes nothing.** A server-computed `summary` (counts + column totals via
  `statement-summary.logic`, summed from the FROZEN lines — never re-priced) drives the detail page's strip
  and the preview banner. `StatementLinesTable` is the wide row-per-sale table; the pickers, list, preview and
  reconciliation all moved to billing weeks (`useBillingPeriods`, `Bill 27 · Jun 29 – Jul 5`).
- **Forward-only, per the immutability rule.** Nothing rewrites an issued document: legacy statements keep
  `pay_period_id` + narrow lines and still download as issued; **regenerate** to get the new format (a new
  gapless number supersedes the prior version). The business dashboard attributes a bill to the pay period
  containing its **Monday** (`stmtIn`), so revenue trends keep working across both shapes.
- **Verified LOCAL** (backend **805 tests** incl. the add-on-wins/product-fallback pair, the spiff window, the
  six-component sum, the 17-column + summary-strip + autofilter read-back, and the billing-week generator;
  build + contract regen 150 paths; FE gen:api + build + lint + stylelint + 61 vitest). Operator:
  `migrate deploy` (additive; stacks on `20260622000000`) + **re-seed bootstrap** (adds the 2026 billing
  weeks). Browser pass: add a VF `spiff` for the week + confirm the TV/HP rates → enter sales across
  Mon 2026-06-29 → Sun 2026-07-05 with mixed TV/HP → generate that bill → the detail shows the strip + wide
  lines → download the Excel and compare with the sample; a sale on the following Monday falls into the NEXT
  bill even though the pay period has not rolled.

### Export naming, the sales export shape, and sale-detail navigation (built — review items 6/10/11; NO migration)
A UAT pass on the exports. Two of the three were latent bugs with non-obvious causes; record them so they
are not reintroduced.
- **`lib/export/exportFilename.ts` is THE naming convention** — `redwave-<source>[-<period>]-<generated>`
  (e.g. `redwave-sales-2026-07-01_2026-07-23-20260723`). Pure, deterministic (the caller passes
  `generatedOn`, so it never reads a clock), slug-safe. **Every** client-generated file goes through it:
  sales · clients · products · reps · expenses (+ grouped) · import templates · report exports. The reports
  feature keeps its thin `exportFilename(type, today)` wrapper but now DELEGATES to the shared one.
  `exportRows`/`ExportMenu` still take a plain `filename` string — one seam, callers build it.
- **BUG 1 — client-side Excel export produced NO file.** `write-excel-file` **v4** removed the `fileName`
  option: the call now returns `{ toBlob, toFile }` and downloads ONLY via **`.toFile(name)`**.
  `exportRows` still passed `{ fileName }` **behind a hand-written cast that defeated the real types**, then
  `await`ed the returned object — not a thenable, so nothing happened, silently, with no error. Fixed by
  calling `.toFile()`; the cast is now narrowed to the matrix argument ONLY so the real return type still
  applies and the next breaking change fails the build instead of the user.
- **BUG 2 — `download (5).xlsx`.** `enableCors` in `main.ts` had **no `exposedHeaders`**. The browser hides
  every response header from JS cross-origin, so `downloadFile`'s `Content-Disposition` read was always
  null in production (FE on `app.` → API on `api.`) and it fell through to its literal `'download'`
  fallback. Fixed with `exposedHeaders: ['Content-Disposition']` on **both** branches. This affected EVERY
  server-rendered file (statements, invoices, expense documents, import error reports, signed PDFs) — it
  only manifests in production, never through the dev proxy, so keep the header when touching CORS.
- **The sales export uses the CLIENT BILL's column shape** (`features/sales/saleExport.ts`, pure +
  unit-tested): Sale ID · date · customer · Channel · Client · **Product (the internet speed)** ·
  Internet/TV/Home Phone flags · a rate per component · Other · Total · greenfield · status — replacing one
  `"Internet, TV, Home Phone"` cell. Same component split the statement renderer uses (internet =
  catalogue behaviour `tiered`/`greenfield`; TV/HP = the `is_system` keys; everything else → **Other**), so
  a sales export reads beside a bill. **The money is the FROZEN COMMISSION snapshot** (`rate_applied`) — it
  is deliberately **BLANK on an unpaid sale** (a zero would read as "earned nothing") and **no client
  billing rate is read here** (#3): a rep's export never reveals what the client is charged. Summed with
  `sumMoney` (integer cents, #1). `saleExportRowAccessor` caches per sale identity so the ~9 component
  columns project each row once. **The on-screen table is unchanged** — this is the export only.
- **`SaleItemResponse` gained `product { name }`** (`SALE_INCLUDE` now nests the product) — the type key
  alone cannot name a speed. Also used on the Sale detail, which showed only a type label.
- **Sale detail gained header NAVIGATION** — "Enter sale" (`sales:create`) + "All sales", so entering one
  sale leads straight into the next. The actions that act on THAT sale (validate/greenfield/delete) stay
  with the record.
- **Verified LOCAL** (backend 805 tests + build + contract regen 150 paths; FE gen:api + build + lint +
  stylelint + **76 vitest** incl. `exportFilename` and `saleExport`). **No migration, no new permission.**
  Operator: redeploy the API for the CORS header. Browser pass: Sales → Export Excel actually produces a
  file named `redwave-sales-….xlsx` (it produced nothing before) with the component columns — a paid sale
  shows rates, an entered one shows blanks; Billing → download a statement → `STMT-00001.xlsx`, not
  `download (n).xlsx`; Sale detail → "Enter sale".

### Expense UAT batch — office origin · per-unit caps · one folder per week · category grouping (built — items 13-18; migration `20260624000000`)
Six findings from an expenses UAT pass. Reuse the patterns; the framings below are the load-bearing part.
- **#14 — "Invalid input" on empty OPTIONAL fields (a form-state bug, not a DTO one).** RHF registers a
  `field_values.<key>` the moment its control MOUNTS, so an untouched optional field held `undefined` while
  the zod schema demanded `z.record(z.string(), z.string())` → the whole record failed. Fixed on the FORM
  side, per the finding: `DynamicFields` now registers with `defaultValue=""`, and the record accepts
  `string | undefined` (required-ness is enforced by the superRefine, which reports against the FIELD with
  its label — never by the record's value type). `pickNonBlank` already strips blanks from the payload.
- **#17 — the meals soft cap is PER MEAL, so ONE item may cover a day's meals.** A $30 per-item cap flagged
  a combined lunch+dinner item, pushing reps to split what is one receipt into two rows. A field def may now
  declare **`multiplies_cap`** (number fields, at most one per category — `assertFieldDefs` enforces both):
  its value SCALES `amount_soft_cap`, so a `meals_count` of 2 is judged against $60. Bootstrap seeds
  `meals_count` on meals. **A blank / non-numeric / <1 count falls back to 1**, so a malformed entry can
  never LOWER the bar. Config-driven — no category is special-cased, and a category without a multiplier is
  bit-for-bit unchanged. Mirrored in the FE engine (`validation.ts`, exact integer cents).
- **Seeding now MERGES a field schema instead of skipping it.** The old rule ("never clobber a customized
  schema") meant an already-seeded deployment could NEVER receive a default added later — `meals_count`
  would never arrive. Bootstrap now appends only seed-default fields the stored schema lacks (matched by
  key), preserving SA fields, their order and the SA's cap.
- **#16 — one folder per rep + week.** `ExpenseReportsService.create` RESOLVES to the caller's existing
  folder for the same `(submitted_by, rep_id, week_start)` (oldest first — the ORIGINAL, not the newest
  duplicate) and returns it with its LIVE aggregates + **`reused: true`**, rather than minting a duplicate.
  A week is one container by design; two folders is how items get submitted twice or missed at review. No
  migration, no unique constraint — a null-rep folder and an admin creating on behalf keep working.
- **#15 — km trips DEFAULT to the office origin.** New singleton **`expense_settings`** (office address +
  optional lat/lng, all nullable) mirroring the `SecuritySetting` lazy-row pattern. `GET /v1/expense-settings`
  is **authenticated with NO permission** (every rep's km form reads it — it is an org address); `PATCH` is
  `settings:edit`. `KmItemFields` fills stop 0 in a SEPARATE effect (the settings fetch can resolve after
  mount) and **only when blank**, so editing an existing km log never rewrites its origin. It is a default,
  not a lock. Admin surface: an `OfficeOriginCard` on `/admin/km-rates` — origin and rate answer the same
  question. **No new RBAC module.**
- **#18 — grouping gained a CATEGORY dimension.** `GroupMode` += `'category'`; `groupItems` takes optional
  `configs` to label the bucket (humanized-key fallback) and sorts category buckets by label while date
  buckets stay newest-first. The grouped export's first column follows the dimension ("Category" vs "Period").
- **#13 — the km-rate refusal now links to its fix.** The 422 is CORRECT (the server will not invent a price,
  and deliberately will not fall back to the rep rate — #3), so the UI stops burying it in a toast:
  `MissingKmRateBanner` lists the unpriced DATES (deduped — a rate covers a date, not an item) and links to
  `/admin/km-rates`. Mirrors the billing `UnpricedBanner`; the structured `missing_km_rate[]` is read off
  `ApiError.details`.
- **Verified LOCAL** (backend **817 tests** incl. the per-unit cap + its fallbacks, the multiplier guards and
  folder resolution; build + contract regen 151 paths; FE build + lint + stylelint + **85 vitest** incl.
  `format.test.ts`). Operator: `migrate deploy` (additive singleton table) + **re-seed bootstrap** (merges
  `meals_count` into the meals schema), then set the office at `/admin/km-rates`.

### Import — value vocabulary, multi-type rows, sheet/header detection, dry-run preview, opt-in create-missing (built — items from the UAT file; migration `20260625000000`)

**The bug.** An admin uploading `docs/uat/Sales Upload.xlsx` (16 historical sales) got a batch where **all
16 rows were `error`**, so the reconcile gate refused the commit. Parsing, auto-mapping and cleaning were
all correct — 9/9 headers mapped, dates → `2026-06-01`, money → `400.00`. The failure was entirely in
CLASSIFICATION: the `Product type` column reads `Internet` (11×), `Internet, TV` (3×) and
`Internet, TV, Home Phone` (2×), while `classifyHistoricalSaleRow` compared the raw cell to a catalogue key
with exact, case-sensitive `Set.has()`. So `Internet` ≠ `internet` failed on capitalisation alone, and a
multi-type cell failed twice over. The message — `no Internet, TV product for client VF — import products
first` — was actively misleading: the products existed, the *string* didn't match, and it sent operators
off to re-import their product master for nothing.

**Cause.** The pipeline normalised **column names** (aliases → mapping) and **cell formats** (dates, money,
codes) but never normalised **cell values** against the system's own vocabularies. The live-sales target had
half-solved this locally with `splitProductTypes` (comma-split + lowercase), which is why `sales_entry:sales`
would have accepted the same file — proof the fix belonged in a shared layer, not one classifier.

**What was built.**
- **`value-vocabulary.logic.ts`** (new, pure) — the missing layer. Resolution is layered because `/` is both
  a separator and a legal label character: the WHOLE cell is matched exactly first (so a custom
  `TV/Streaming` type survives), then split on `,;|`⏎, and only a fragment that still fails is split on
  `/` `+`. Vocabularies are **catalogue-driven** (`buildProductTypeVocab` from `product_type_catalogue`), so
  an SA-added `standard_addon` — "Protection Plan" → `protection_plan` — resolves with no code change.
  An ambiguous or unrecognised value stays **unknown rather than guessed** (`Internet TV` → unknown,
  `Fibre Optic` → unknown): a wrong guess silently mis-files a sale.
- **`normalize.ts`** — the single `normalizeToken` fold, now shared by header matching and value matching so
  the two can never drift.
- **Historical sales take a multi-type row.** `product_type` → **`product_types`** on
  `master_migration:sales`; one row becomes ONE sale with N `sale_items`. `loadMapping` carries a rename
  shim so an existing saved mapping doesn't silently lose the column. SALE-001a is deliberately NOT applied
  here — it is an entry rule, and history may record a TV-only household.
- **The money rule.** A row's `billed_amount` is ONE household figure, so it is recorded **exactly once, on
  the base item** (tiered/greenfield, else the first) with the rest NULL. Never divided: splitting would
  invent an attribution the file never stated and couldn't round cleanly ($350 over 3 items). Σ therefore
  equals the file's own column total, which is what the Business dashboard sums.
- **Every other target** got the same treatment via its own vocabulary (`market`, `rate_kind`, rep/sale
  `status`, a product's `product_type`), plus a **`bool` FieldType** (`coerceBool`/`isTrue`) replacing the
  per-handler regexes.
- **Parser tolerance** — sheet selection and header-row detection, both SCORED against the target's own
  aliases rather than guessed positionally, so an Instructions tab or a title banner no longer becomes the
  header row. An explicit `sheet` always wins; with no expected fields the old behaviour is unchanged.
- **Dry-run preview** — `POST /v1/imports/preview` (rides `import:create`, writes nothing). The
  parse → map → clean → classify sequence was extracted from `stage` into a shared private `analyze()`, so
  the preview can never disagree with what staging actually produces.
- **Grouped issues** — `group-issues.logic.ts` collapses identical problems (folding out quoted values and
  codes) so 16 rows failing one way read as ONE fixable thing. Stored in `error_summary` (already JSON — no
  migration) and surfaced by `IssueGroupsBanner`, following the `UnpricedBanner` pattern.
- **Mapping assignment is globally scored**, not first-come-first-served — a field declared early could
  previously capture a column a later field matched far better (`client_code`'s "code" alias swallowing a
  `Rep code` column).

**Verified LOCAL:** **909 backend tests** (113 suites, up from 817) + lint + build + contract regen; FE
build + lint + stylelint + 85 vitest — all green. `uat-sales-file.spec.ts` rebuilds the real file's exact
shape (its verbatim product/amount pairs, including the one $280 row) and locks the outcome: **16 rows → 23
sale_items → Σ 5880.00**, gate open; and with an unknown type, ONE grouped error that does *not* say "import
products first". **Operator: `migrate deploy`** (one additive boolean, defaulting to today's behaviour).

**Opt-in auto-creation of referenced master data (`create_missing`, migration `20260625000000`).** A real
go-live file references clients/reps/products that don't exist yet, so a second pass added an OPT-IN:
`create_missing` on `master_migration + sales` turns a missing client / rep / product from an `error` into a
MATCHED row carrying a `will create …` note, and the commit creates the record inside the same transaction.
The lines that matter:
- **Migration only.** The service returns **422** if the flag is set on any other target — above all LIVE
  sales, where an invented rep or product would flow straight into the tier tally and the pay run (#5).
- **The catalogue is never extended.** An unresolvable product TYPE stays an error with or without the flag:
  `product_type_catalogue` is Super-Admin-governed configuration (#10), not something a file may add to.
- **Nothing priced is invented.** A created product gets NO `client_billing_rate` (#3) and no money field;
  records are minimal and obviously provisional (named after their own code) so an admin completes them in
  Clients & Products / HRM afterwards. A created rep's hire date is the row's own `sale_date` — the only
  defensible value in the file — and rep codes are still never reused (#11).
- **The flag is PERSISTED on the batch** (hence the migration): classification re-runs on remap and on a
  single-row reconcile edit, and without it those re-runs would judge rows under the opposite rule and
  silently flip an opted-in batch back to `error`.
- **The preview warns before anything is staged**, listing the exact clients / reps / products by code. With
  the flag OFF the same list is shown as information ("these don't exist yet"), which beats leaving the
  operator to decode N identical error rows. A matched row's note is styled as information, not danger.

**Deferred.** The `mixed` import_type is still unsupported.
