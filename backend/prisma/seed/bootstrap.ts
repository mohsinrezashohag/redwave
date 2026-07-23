/**
 * Bootstrap seed — the GENESIS catalogue the system needs from day one, idempotent (upserts; an existing
 * Super Admin password is never overwritten). Shared by the demo seed (prisma/seed.ts) and the clean-wipe
 * reset (prisma/reset.ts). — SRS AUTH-004/007, COMM (Schedule C v2), PAY-001
 *
 *   • The full module×action permission grid (MODULE_KEYS × 6 actions) + 2 off-grid perms (reports:business,
 *     notifications:broadcast). Counts are derived — see the closing console.log.
 *   • 4 built-in roles (is_system) with sensible default grants.
 *   • One Super Admin user (credentials from env; placeholder + loud warning if unset).
 *   • Genesis Schedule C v2 commission config (tiers, flat rates, holdback split, release setting).
 *   • The 2026 bi-weekly pay periods, expense-category catalogue, notification settings, chatbot config.
 */
import { PrismaClient, PermissionAction, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  ALL_ACTIONS,
  BUILTIN_ROLES,
  MODULE_KEYS,
  ModuleKey,
} from '../../src/common/rbac/rbac.constants';
import { SCHEDULE_C_V2 } from '../../src/modules/commission/schedule-c-v2';
import { generate2026PayPeriods } from '../../src/modules/payrun/pay-periods.seed-data';
import { generate2026BillingPeriods } from '../../src/modules/billing/billing-periods.seed-data';

const genesisDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const BCRYPT_ROUNDS = 12;

const MODULE_NAMES: Record<ModuleKey, string> = {
  users: 'User Management',
  roles: 'Roles & Permissions',
  profile: 'My Account / Profile',
  hrm: 'HRM / Reps',
  clients: 'Clients & Products',
  billing_rates: 'Client Billing Rates',
  commission: 'Commission Configuration',
  product_types: 'Product Types',
  sales: 'Sales & Validation',
  payrun: 'Pay Run & Holdback',
  clawback: 'Clawback',
  expenses: 'Expenses',
  km_rates: 'KM Rates',
  billing: 'Billing & Statements',
  documents: 'Documents & E-Signature',
  import: 'Data Import & Integration',
  reports: 'Reporting & Dashboards',
  settings: 'System Settings',
  notifications: 'Notifications',
  audit: 'Audit Trail',
};

type Grant = [ModuleKey, PermissionAction];
const g = (key: ModuleKey, ...actions: PermissionAction[]): Grant[] =>
  actions.map((action) => [key, action]);

const ADMIN_GRANTS: Grant[] = [
  ...g('users', 'view', 'create', 'edit'),
  ...g('roles', 'view'),
  ...g('profile', 'approve'),
  ...g('hrm', 'view', 'create', 'edit', 'approve', 'export'),
  ...g('clients', 'view', 'create', 'edit', 'export'),
  ...g('commission', 'view', 'edit', 'approve', 'export'),
  ...g('product_types', 'view', 'edit'), // manage the product-type catalogue (own module row)
  ...g('sales', 'view', 'create', 'edit', 'approve', 'delete', 'export'),
  ...g('payrun', 'view', 'create', 'approve', 'export'),
  ...g('clawback', 'view', 'create', 'export'),
  ...g('expenses', 'view', 'create', 'edit', 'approve', 'delete', 'export'), // delete = remove a not-yet-approved item
  ...g('km_rates', 'view', 'edit'), // manage the per-client km rate config (own module row)
  ...g('billing', 'view', 'create', 'export'),
  ...g('documents', 'view', 'create', 'edit', 'export'),
  ...g('import', 'view', 'create', 'edit', 'approve'),
  ...g('reports', 'view', 'export'),
];

const MANAGER_GRANTS: Grant[] = [
  ...g('sales', 'view'),
  ...g('commission', 'view'),
  ...g('expenses', 'view', 'create', 'edit', 'approve'), // EXP-001/006/007
  ...g('reports', 'view', 'export'),
  ...g('hrm', 'view'),
  ...g('documents', 'view', 'create'), // DOC-002
  ...g('profile', 'approve'),
];

const SALES_REP_GRANTS: Grant[] = [
  ...g('sales', 'view', 'create'),
  ...g('clients', 'view'), // SALE-001 (dropdowns)
  ...g('expenses', 'view', 'create'),
  ...g('documents', 'view', 'create'), // DOC-002
  ...g('reports', 'view'), // RPT-001/007
];

const ROLE_DESCRIPTIONS: Record<string, string> = {
  [BUILTIN_ROLES.SUPER_ADMIN]: 'Full access to every module and action.',
  [BUILTIN_ROLES.ADMIN]: 'Broad operational access; no role management or system settings.',
  [BUILTIN_ROLES.MANAGER]: 'Roster-scoped: view sales/commission/reports; submit and approve expenses.',
  [BUILTIN_ROLES.SALES_REP]: 'Own sales and expenses; view documents.',
};

// Per-type field schema (EXP-002a) + soft caps (EXP-013). Seeded as the DEFAULT; SA-editable via PATCH.
type SeedFieldDef = { key: string; label: string; type: string; required: boolean; options?: string[]; soft_cap?: string; multiplies_cap?: boolean };
const EXPENSE_FIELD_CONFIGS: {
  category_key: string;
  label: string;
  requires_receipt: boolean;
  fields: SeedFieldDef[];
  amount_soft_cap?: string;
}[] = [
  { category_key: 'km', label: 'Kilometres', requires_receipt: false, fields: [] },
  {
    category_key: 'meals',
    label: 'Meals',
    requires_receipt: true,
    amount_soft_cap: '30.00', // PER MEAL — over it → a soft Warning (BRD §7.1 dinner cap)
    fields: [
      { key: 'vendor', label: 'Vendor', type: 'text', required: true },
      // The cap is per MEAL, so one item covering lunch AND dinner declares 2 and is judged against $60.
      // Without this, combining a day's meals into one item is flagged while splitting them is not. — EXP-013
      { key: 'meals_count', label: 'Meals covered', type: 'number', required: false, multiplies_cap: true },
      { key: 'city', label: 'City of purchase', type: 'text', required: false },
      { key: 'gratuity', label: 'Gratuity', type: 'money', required: false },
      { key: 'attendees', label: 'Attendees', type: 'text', required: false },
    ],
  },
  {
    category_key: 'hotel',
    label: 'Hotel',
    requires_receipt: true,
    fields: [
      { key: 'hotel_name', label: 'Hotel name', type: 'text', required: true },
      { key: 'location', label: 'Location', type: 'text', required: false },
    ],
  },
  {
    category_key: 'flight',
    label: 'Flight',
    requires_receipt: true,
    fields: [
      { key: 'airline', label: 'Airline', type: 'text', required: false },
      { key: 'route', label: 'Route', type: 'text', required: false },
    ],
  },
  { category_key: 'rental', label: 'Rental', requires_receipt: true, fields: [] },
  { category_key: 'gas', label: 'Gas', requires_receipt: true, fields: [] },
  { category_key: 'other', label: 'Other', requires_receipt: true, fields: [] },
];

// The COMPREHENSIVE event catalogue (RPT-009 / SRS §14). Each carries a display label + title/body templates
// (with {var} placeholders the emitter fills; null → call-site text). All default in-app on, email off (the
// SA flips email; rate_change stays email-off, RPT-010). Recipients are INTRINSIC to each trigger (documented),
// never re-routed here; free targeting is the manual broadcast.
type EventSetting = {
  event_type: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  label: string;
  title_template: string | null;
  body_template: string | null;
};
const NOTIFICATION_EVENT_SETTINGS: EventSetting[] = [
  { event_type: 'sale_validated', in_app_enabled: true, email_enabled: false, label: 'Sale validated', title_template: 'Sale {sale_code} validated', body_template: 'Your sale for {customer_name} has been validated.' },
  { event_type: 'expense_submitted', in_app_enabled: true, email_enabled: false, label: 'Expense submitted', title_template: 'New expense report from {submitter_name}', body_template: 'An expense report for week {week_start} needs your review.' },
  { event_type: 'expense_approved', in_app_enabled: true, email_enabled: false, label: 'Expense approved', title_template: 'Expense report approved', body_template: 'Your expense report for {week_start} was approved.' },
  { event_type: 'expense_rejected', in_app_enabled: true, email_enabled: false, label: 'Expense rejected', title_template: 'Expense report rejected', body_template: 'Your expense report for {week_start} was rejected. {note}' },
  { event_type: 'expense_sent_back', in_app_enabled: true, email_enabled: false, label: 'Expense sent back', title_template: 'Expense report needs changes', body_template: 'Your expense report for {week_start} was sent back. {note}' },
  { event_type: 'signature_requested', in_app_enabled: true, email_enabled: false, label: 'Signature requested', title_template: 'A document needs your signature', body_template: '{requester_name} asked you to sign {document_name}.' },
  { event_type: 'signature_signed', in_app_enabled: true, email_enabled: false, label: 'Document signed', title_template: 'A recipient signed your document', body_template: '{signer_name} signed {document_name}.' },
  { event_type: 'signature_declined', in_app_enabled: true, email_enabled: false, label: 'Signature declined', title_template: 'A recipient declined to sign', body_template: '{signer_name} declined to sign {document_name}.' },
  { event_type: 'document_completed', in_app_enabled: true, email_enabled: false, label: 'Document completed', title_template: 'Your document is fully signed', body_template: '{document_name} is complete — all recipients signed.' },
  { event_type: 'pay_run_finalized', in_app_enabled: true, email_enabled: false, label: 'Pay run finalized', title_template: 'Your pay is ready', body_template: 'Pay period {period_number} is finalized. Net payout {net_payout}.' },
  { event_type: 'holdback_released', in_app_enabled: true, email_enabled: false, label: 'Holdback released', title_template: 'Holdback released', body_template: '{amount} of holdback was released in period {period_number}.' },
  { event_type: 'clawback_applied', in_app_enabled: true, email_enabled: false, label: 'Clawback applied', title_template: 'A clawback was applied', body_template: 'A clawback of {amount} was applied: {reason}.' },
  { event_type: 'profile_change_requested', in_app_enabled: true, email_enabled: false, label: 'Profile change requested', title_template: 'Profile change to review', body_template: '{subject_name} requested a profile change.' },
  { event_type: 'profile_change_decided', in_app_enabled: true, email_enabled: false, label: 'Profile change decided', title_template: 'Profile change {outcome}', body_template: 'Your requested profile change was {outcome}.' },
  { event_type: 'statement_ready', in_app_enabled: true, email_enabled: false, label: 'Statement ready', title_template: 'A statement is ready', body_template: 'The statement for period {period_number} is available.' },
  { event_type: 'rate_change', in_app_enabled: true, email_enabled: false, label: 'Rate change', title_template: 'Billing rate changed', body_template: 'A {rate_kind} rate for {client_code} changed.' }, // RPT-010 — email off
  { event_type: 'import_committed', in_app_enabled: true, email_enabled: false, label: 'Import committed', title_template: 'Import committed', body_template: 'An {import_type} import was committed ({committed_count} rows).' },
  { event_type: 'broadcast', in_app_enabled: true, email_enabled: false, label: 'Broadcast announcement', title_template: null, body_template: null }, // SA supplies title/body
];

/** Seed the genesis catalogue. Idempotent. Returns the Super Admin user id (used by the demo seed). */
export async function seedBootstrap(prisma: PrismaClient): Promise<{ superAdminUserId: string }> {
  // 1. Modules.
  for (const key of MODULE_KEYS) {
    await prisma.module.upsert({
      where: { key },
      update: { name: MODULE_NAMES[key] },
      create: { key, name: MODULE_NAMES[key] },
    });
  }
  const modules = await prisma.module.findMany({ select: { id: true, key: true } });

  // 2. Permissions: every module × action.
  for (const m of modules) {
    for (const action of ALL_ACTIONS) {
      await prisma.permission.upsert({
        where: { module_id_action: { module_id: m.id, action } },
        update: {},
        create: { module_id: m.id, action },
      });
    }
  }
  // 2b. Off-grid actions — kept OUT of the module×action grid so they don't cross-product onto every module.
  //     notifications:broadcast (manual broadcast) + reports:business (business dashboard + trends). SA only.
  const notificationsModuleId = modules.find((m) => m.key === 'notifications')!.id;
  await prisma.permission.upsert({
    where: { module_id_action: { module_id: notificationsModuleId, action: 'broadcast' } },
    update: {},
    create: { module_id: notificationsModuleId, action: 'broadcast' },
  });
  const reportsModuleId = modules.find((m) => m.key === 'reports')!.id;
  await prisma.permission.upsert({
    where: { module_id_action: { module_id: reportsModuleId, action: 'business' } },
    update: {},
    create: { module_id: reportsModuleId, action: 'business' },
  });
  const permissions = await prisma.permission.findMany({
    select: { id: true, action: true, module: { select: { key: true } } },
  });
  const permId = (key: ModuleKey, action: PermissionAction): string => {
    const found = permissions.find((p) => p.module.key === key && p.action === action);
    if (!found) throw new Error(`Missing permission ${key}:${action}`);
    return found.id;
  };
  const grantIds = (grants: Grant[]): string[] => grants.map(([k, a]) => permId(k, a));

  // 3. Initial Super Admin user.
  const email = process.env.SEED_SUPERADMIN_EMAIL || 'superadmin@redwave.local';
  let password = process.env.SEED_SUPERADMIN_PASSWORD;
  if (!password) {
    password = 'ChangeMe!SuperAdmin1';
    console.warn(
      '\n⚠️  SEED_SUPERADMIN_PASSWORD is not set — seeding the Super Admin with a PLACEHOLDER ' +
        'password. CHANGE IT IMMEDIATELY via POST /v1/account/change-password.\n',
    );
  }
  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const superAdminUser = await prisma.user.upsert({
    where: { email },
    update: {}, // never overwrite an existing user's password on re-seed
    create: { email, password_hash, full_name: 'Super Admin', theme_preference: 'system', status: 'active' },
  });

  // 4. Built-in roles + their grants.
  const roleGrants: Record<string, string[]> = {
    [BUILTIN_ROLES.SUPER_ADMIN]: permissions.map((p) => p.id), // every permission (grid + off-grid)
    [BUILTIN_ROLES.ADMIN]: grantIds(ADMIN_GRANTS),
    [BUILTIN_ROLES.MANAGER]: grantIds(MANAGER_GRANTS),
    [BUILTIN_ROLES.SALES_REP]: grantIds(SALES_REP_GRANTS),
  };
  for (const [name, permissionIds] of Object.entries(roleGrants)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { is_system: true, description: ROLE_DESCRIPTIONS[name] },
      create: { name, is_system: true, description: ROLE_DESCRIPTIONS[name], created_by: superAdminUser.id },
    });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { role_id: role.id } }),
      prisma.rolePermission.createMany({
        data: permissionIds.map((permission_id) => ({ role_id: role.id, permission_id })),
        skipDuplicates: true,
      }),
    ]);
  }

  // 5. Assign the Super Admin role to the Super Admin user.
  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { name: BUILTIN_ROLES.SUPER_ADMIN } });
  await prisma.userRole.upsert({
    where: { user_id_role_id: { user_id: superAdminUser.id, role_id: superAdminRole.id } },
    update: {},
    create: { user_id: superAdminUser.id, role_id: superAdminRole.id },
  });

  // 5a2. Currency catalogue — the allowed set (USD + CAD primary; admin-extensible). Idempotent; never
  // clobbers is_active. FK target for clients.currency + expense/billing FX columns. — Meeting 3, CLAUDE §12
  const CURRENCIES = [
    { code: 'CAD', name: 'Canadian Dollar', symbol: '$' },
    { code: 'USD', name: 'US Dollar', symbol: '$' },
  ];
  for (const c of CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: c.code },
      update: { name: c.name, symbol: c.symbol },
      create: { code: c.code, name: c.name, symbol: c.symbol, is_active: true },
    });
  }

  // 5b. Product-type catalogue — the 4 core types with their LOCKED commission behaviour (#5/#9).
  // is_system=true → behaviour immutable, non-deletable, non-deactivatable. New SA types are standard_addon.
  const CORE_PRODUCT_TYPES = [
    { key: 'internet', label: 'Internet', behaviour: 'tiered' as const },
    { key: 'greenfield_internet', label: 'Greenfield Internet', behaviour: 'greenfield' as const },
    { key: 'tv', label: 'TV', behaviour: 'standard_addon' as const },
    { key: 'home_phone', label: 'Home Phone', behaviour: 'standard_addon' as const },
  ];
  for (const t of CORE_PRODUCT_TYPES) {
    await prisma.productTypeCatalogue.upsert({
      where: { key: t.key },
      update: { label: t.label, behaviour: t.behaviour, is_system: true }, // behaviour is locked for core types
      create: { key: t.key, label: t.label, behaviour: t.behaviour, is_system: true, is_active: true },
    });
  }

  // 6. Genesis Schedule C v2 commission config (back-dated genesis so it is always the current config).
  const effectiveFrom = genesisDate(SCHEDULE_C_V2.effectiveFrom);
  // client_id: null pins these guards to the GLOBAL scope — otherwise a per-client row would suppress
  // re-seeding the global genesis config.
  let tierConfig = await prisma.commissionTierConfig.findFirst({
    where: { client_id: null, effective_from: effectiveFrom },
  });
  if (!tierConfig) {
    tierConfig = await prisma.commissionTierConfig.create({
      data: {
        effective_from: effectiveFrom,
        created_by: superAdminUser.id,
        tiers: { create: SCHEDULE_C_V2.tiers.map((t) => ({ ...t })) },
      },
    });
  }
  // Greenfield internet is flat $100 and EXCLUDED from the tier tally (#9). Tiers cover internet only.
  for (const [productType, amount] of Object.entries(SCHEDULE_C_V2.flatRates)) {
    const existingFlat = await prisma.commissionFlatRate.findFirst({
      where: { client_id: null, product_type: productType, effective_from: effectiveFrom },
    });
    if (!existingFlat) {
      await prisma.commissionFlatRate.create({
        data: { product_type: productType, amount, effective_from: effectiveFrom, created_by: superAdminUser.id },
      });
    }
  }
  const existingHoldback = await prisma.holdbackConfig.findFirst({ where: { effective_from: effectiveFrom } });
  if (!existingHoldback) {
    await prisma.holdbackConfig.create({
      data: {
        advance_pct: SCHEDULE_C_V2.holdback.advance_pct,
        holdback_pct: SCHEDULE_C_V2.holdback.holdback_pct,
        effective_from: effectiveFrom,
      },
    });
  }
  const existingRelease = await prisma.holdbackReleaseSetting.findFirst();
  if (!existingRelease) {
    await prisma.holdbackReleaseSetting.create({
      data: { release_rule: SCHEDULE_C_V2.releaseRule, set_by: superAdminUser.id, effective_from: effectiveFrom },
    });
  }

  // 7. Pay periods — the 2026 bi-weekly schedule (idempotent, by period_number). — PAY-001
  const payPeriods = generate2026PayPeriods();
  for (const p of payPeriods) {
    const existingPeriod = await prisma.payPeriod.findUnique({ where: { period_number: p.period_number } });
    if (!existingPeriod) {
      await prisma.payPeriod.create({
        data: {
          period_number: p.period_number,
          start_date: genesisDate(p.start_date),
          end_date: genesisDate(p.end_date),
          payday: genesisDate(p.payday),
          status: 'open',
        },
      });
    }
  }

  // 7b. Billing periods — the 2026 WEEKLY (Mon–Sun) client-billing schedule (idempotent, by period_number).
  //     Separate from pay periods on purpose: a bill straddles two of them. — docs/uat/billing-target-format.md
  for (const b of generate2026BillingPeriods()) {
    const existingBillingPeriod = await prisma.billingPeriod.findUnique({
      where: { period_number: b.period_number },
    });
    if (!existingBillingPeriod) {
      await prisma.billingPeriod.create({
        data: {
          period_number: b.period_number,
          start_date: genesisDate(b.start_date),
          end_date: genesisDate(b.end_date),
          status: 'open',
        },
      });
    }
  }

  // 8. Expense-category catalogue + per-type field schema — idempotent by category_key. — EXP-002a/009/013
  //    MERGE, never clobber: an SA-customized schema keeps its fields, their order and its soft cap, but any
  //    NEW seed-default field (matched by key) is APPENDED. Without the merge a deployment that has already
  //    seeded would never receive a default added later — which is how `meals_count` reaches an existing DB.
  for (const cfg of EXPENSE_FIELD_CONFIGS) {
    const existing = await prisma.expenseFieldConfig.findUnique({
      where: { category_key: cfg.category_key },
      select: { fields: true, amount_soft_cap: true },
    });
    const storedFields = Array.isArray(existing?.fields) ? (existing!.fields as { key?: unknown }[]) : [];
    const alreadyCustomized = storedFields.length > 0;
    const missingDefaults = cfg.fields.filter((d) => !storedFields.some((f) => f?.key === d.key));
    const seedSchema = alreadyCustomized
      ? // Keep what the SA has; only append defaults they've never seen. The cap stays theirs.
        missingDefaults.length > 0
        ? { fields: [...storedFields, ...missingDefaults] as unknown as Prisma.InputJsonValue }
        : {}
      : { fields: cfg.fields as unknown as Prisma.InputJsonValue, amount_soft_cap: cfg.amount_soft_cap ?? null };
    await prisma.expenseFieldConfig.upsert({
      where: { category_key: cfg.category_key },
      update: { label: cfg.label, requires_receipt: cfg.requires_receipt, ...seedSchema },
      create: {
        category_key: cfg.category_key,
        label: cfg.label,
        requires_receipt: cfg.requires_receipt,
        is_active: true,
        fields: cfg.fields as unknown as Prisma.InputJsonValue,
        amount_soft_cap: cfg.amount_soft_cap ?? null,
        created_by: superAdminUser.id,
      },
    });
  }

  // 9. Notification event settings — idempotent by event_type. — RPT-009/010
  //     update refreshes the label/templates (the default copy) but NEVER the SA's channel toggles.
  for (const s of NOTIFICATION_EVENT_SETTINGS) {
    await prisma.notificationEventSetting.upsert({
      where: { event_type: s.event_type },
      update: { label: s.label, title_template: s.title_template, body_template: s.body_template },
      create: {
        event_type: s.event_type,
        in_app_enabled: s.in_app_enabled,
        email_enabled: s.email_enabled,
        label: s.label,
        title_template: s.title_template,
        body_template: s.body_template,
        updated_by: superAdminUser.id,
      },
    });
  }

  // 9b. Document sequences — the gapless statement/invoice/client-expense-doc counters. Idempotent: NEVER
  //     reset an existing counter (that would repeat/gap numbers); only create it if missing. — BRD §8
  for (const key of ['statement', 'invoice', 'client_expense']) {
    await prisma.documentSequence.upsert({
      where: { key },
      update: {}, // preserve the current value on re-seed
      create: { key, current_value: 0 },
    });
  }

  // 10. Chatbot config — Gemini provider row, inactive until a key is wired + manually activated. — RPT-011
  const existingChatbot = await prisma.chatbotConfig.findFirst();
  if (!existingChatbot) {
    await prisma.chatbotConfig.create({
      data: {
        provider: 'gemini',
        model: 'gemini-3.1-flash-lite', // current GA flash-lite id (ai.google.dev); 1.5/2.x retired
        is_active: false,
        config_json: {},
        updated_by: superAdminUser.id,
      },
    });
  }

  console.log(
    `Bootstrap: ${MODULE_KEYS.length} modules, ${permissions.length} permissions, 4 roles, ` +
      `Super Admin "${email}", Schedule C v2, ${payPeriods.length} pay periods, ` +
      `${EXPENSE_FIELD_CONFIGS.length} expense configs, ${NOTIFICATION_EVENT_SETTINGS.length} notification settings.`,
  );
  return { superAdminUserId: superAdminUser.id };
}
