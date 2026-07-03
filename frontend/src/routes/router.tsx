/**
 * Router — public /login + the protected app shell. `RequireAuth` redirects unauthenticated users to
 * /login (UX routing; the server still authorizes every request — CLAUDE §5). Feature routes are added
 * with their screens. Pages are code-split with React.lazy (§13 performance budget).
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { RequireAuth } from '../auth/RequireAuth';
import { RequirePasswordChange } from '../auth/RequirePasswordChange';
import { RequireMfaEnrollment } from '../auth/RequireMfaEnrollment';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { withCrumbs } from './crumbs';
import { LoadingSpinner } from '../components/ui';

const LoginPage = lazy(() => import('../pages/login/LoginPage'));
const ShowcasePage = lazy(() => import('../showcase/ShowcasePage'));
const SalesListPage = lazy(() => import('../features/sales/pages/SalesListPage'));
const SaleEntryPage = lazy(() => import('../features/sales/pages/SaleEntryPage'));
const SaleDetailPage = lazy(() => import('../features/sales/pages/SaleDetailPage'));
const DashboardLanding = lazy(() => import('../features/dashboards/pages/DashboardLanding'));
const RepDashboardPage = lazy(() => import('../features/dashboards/pages/RepDashboardPage'));
const ManagerDashboardPage = lazy(() => import('../features/dashboards/pages/ManagerDashboardPage'));
const BusinessDashboardPage = lazy(() => import('../features/dashboards/pages/BusinessDashboardPage'));
const AdminDashboardPage = lazy(() => import('../features/dashboards/pages/AdminDashboardPage'));
const LeaderboardPage = lazy(() => import('../features/dashboards/pages/LeaderboardPage'));
const AccountPage = lazy(() => import('../features/account/pages/AccountPage'));
const AdminHomePage = lazy(() => import('../features/admin/pages/AdminHomePage'));
const ProfileReviewPage = lazy(() => import('../features/admin/pages/ProfileReviewPage'));
const UsersPage = lazy(() => import('../features/admin/pages/UsersPage'));
const RolesPage = lazy(() => import('../features/admin/pages/RolesPage'));
const RoleEditorPage = lazy(() => import('../features/admin/pages/RoleEditorPage'));
const NotificationSettingsPage = lazy(() => import('../features/admin/pages/NotificationSettingsPage'));
const ExpensesListPage = lazy(() => import('../features/expenses/pages/ExpensesListPage'));
const ExpenseEntryPage = lazy(() => import('../features/expenses/pages/ExpenseEntryPage'));
const ExpenseEditPage = lazy(() => import('../features/expenses/pages/ExpenseEditPage'));
const ExpenseDetailPage = lazy(() => import('../features/expenses/pages/ExpenseDetailPage'));
const ExpenseApprovalsPage = lazy(() => import('../features/expenses/pages/ExpenseApprovalsPage'));
const ClientsPage = lazy(() => import('../features/clients/pages/ClientsPage'));
const ClientDetailPage = lazy(() => import('../features/clients/pages/ClientDetailPage'));
const ProductsListPage = lazy(() => import('../features/products/pages/ProductsListPage'));
const CommissionConfigPage = lazy(() => import('../features/commission/pages/CommissionConfigPage'));
const ProductTypesPage = lazy(() => import('../features/productTypes/pages/ProductTypesPage'));
const KmRatesPage = lazy(() => import('../features/kmRates/pages/KmRatesPage'));
const PayRunListPage = lazy(() => import('../features/payrun/pages/PayRunListPage'));
const PayRunDetailPage = lazy(() => import('../features/payrun/pages/PayRunDetailPage'));
const ClawbackListPage = lazy(() => import('../features/clawback/pages/ClawbackListPage'));
const ClawbackEntryPage = lazy(() => import('../features/clawback/pages/ClawbackEntryPage'));
const BillingListPage = lazy(() => import('../features/billing/pages/BillingListPage'));
const StatementDetailPage = lazy(() => import('../features/billing/pages/StatementDetailPage'));
const ReconciliationPage = lazy(() => import('../features/reconciliation/pages/ReconciliationPage'));
const DocumentsListPage = lazy(() => import('../features/documents/pages/DocumentsListPage'));
const DocumentDetailPage = lazy(() => import('../features/documents/pages/DocumentDetailPage'));
const ImportListPage = lazy(() => import('../features/import/pages/ImportListPage'));
const NewImportPage = lazy(() => import('../features/import/pages/NewImportPage'));
const ImportDetailPage = lazy(() => import('../features/import/pages/ImportDetailPage'));
const ChatbotPage = lazy(() => import('../features/chatbot/pages/ChatbotPage'));
const NotificationCenterPage = lazy(() => import('../features/notifications/pages/NotificationCenterPage'));
const BroadcastPage = lazy(() => import('../features/notifications/pages/BroadcastPage'));
const RepsListPage = lazy(() => import('../features/reps/pages/RepsListPage'));
const ReportsLandingPage = lazy(() => import('../features/reports/pages/ReportsLandingPage'));
const TrendsPage = lazy(() => import('../features/reports/pages/TrendsPage'));
const ReportExportsPage = lazy(() => import('../features/reports/pages/ReportExportsPage'));
const ForgotPasswordPage = lazy(() => import('../features/auth/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('../features/auth/pages/ResetPasswordPage'));
const ChangePasswordRequiredPage = lazy(() => import('../features/auth/pages/ChangePasswordRequiredPage'));
const SetupMfaPage = lazy(() => import('../features/auth/pages/SetupMfaPage'));
const SecuritySettingsPage = lazy(() => import('../features/admin/pages/SecuritySettingsPage'));
const AuditLogPage = lazy(() => import('../features/audit/pages/AuditLogPage'));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'));

const fallback = (
  <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-7)' }}>
    <LoadingSpinner size="lg" />
  </div>
);
const lazyEl = (el: ReactNode) => <Suspense fallback={fallback}>{el}</Suspense>;

export const router = createBrowserRouter([
  {
    path: '/login',
    element: lazyEl(<LoginPage />),
  },
  { path: '/forgot-password', element: lazyEl(<ForgotPasswordPage />) },
  { path: '/reset-password', element: lazyEl(<ResetPasswordPage />) },
  { path: '/set-password', element: lazyEl(<ResetPasswordPage flavor="invite" />) },
  {
    element: <RequireAuth />,
    // Backstop: an error thrown above the shell (in a guard) still renders the friendly panel, not a white screen.
    errorElement: <RouteErrorBoundary />,
    children: [
      // Authed but OUTSIDE the must-change / MFA-enrolment guards, so a flagged user can actually reach them.
      { path: '/change-password', element: lazyEl(<ChangePasswordRequiredPage />) },
      { path: '/setup-mfa', element: lazyEl(<SetupMfaPage />) },
      {
        element: <RequirePasswordChange />,
        children: [
      {
        element: <RequireMfaEnrollment />,
        children: [
      {
        path: '/',
        element: <AppShell />,
        // withCrumbs injects each route's breadcrumb metadata (handle.crumb) from routes/crumbs.ts —
        // the single declaration site. New routes MUST add an entry there (dev warns otherwise). §13
        children: withCrumbs([
          {
            // A render error in any feature page bubbles here → the friendly panel renders INSIDE the shell
            // (sidebar/topbar preserved), never a white screen. — CLAUDE §13
            errorElement: <RouteErrorBoundary />,
            children: [
          { index: true, element: lazyEl(<DashboardLanding />) },
          { path: 'dashboards/rep', element: lazyEl(<RepDashboardPage />) },
          { path: 'dashboards/manager', element: lazyEl(<ManagerDashboardPage />) },
          { path: 'dashboards/business', element: lazyEl(<BusinessDashboardPage />) },
          { path: 'dashboards/admin', element: lazyEl(<AdminDashboardPage />) },
          { path: 'dashboards/leaderboard', element: lazyEl(<LeaderboardPage />) },
          { path: 'showcase', element: lazyEl(<ShowcasePage />) },
          { path: 'sales', element: lazyEl(<SalesListPage />) },
          { path: 'sales/new', element: lazyEl(<SaleEntryPage />) },
          { path: 'sales/:id', element: lazyEl(<SaleDetailPage />) },
          { path: 'expenses', element: lazyEl(<ExpensesListPage />) },
          { path: 'expenses/new', element: lazyEl(<ExpenseEntryPage />) },
          { path: 'expenses/approvals', element: lazyEl(<ExpenseApprovalsPage />) },
          { path: 'expenses/:id', element: lazyEl(<ExpenseDetailPage />) },
          { path: 'expenses/:id/edit', element: lazyEl(<ExpenseEditPage />) },
          { path: 'pay-runs', element: lazyEl(<PayRunListPage />) },
          { path: 'pay-runs/:id', element: lazyEl(<PayRunDetailPage />) },
          { path: 'clawbacks', element: lazyEl(<ClawbackListPage />) },
          { path: 'clawbacks/new', element: lazyEl(<ClawbackEntryPage />) },
          { path: 'billing', element: lazyEl(<BillingListPage />) },
          { path: 'billing/statements/:id', element: lazyEl(<StatementDetailPage />) },
          { path: 'documents', element: lazyEl(<DocumentsListPage />) },
          { path: 'documents/:id', element: lazyEl(<DocumentDetailPage />) },
          { path: 'import', element: lazyEl(<ImportListPage />) },
          { path: 'import/new', element: lazyEl(<NewImportPage />) },
          { path: 'import/:id', element: lazyEl(<ImportDetailPage />) },
          { path: 'chatbot', element: lazyEl(<ChatbotPage />) },
          { path: 'notifications', element: lazyEl(<NotificationCenterPage />) },
          { path: 'account', element: lazyEl(<AccountPage />) },
          { path: 'admin', element: lazyEl(<AdminHomePage />) },
          { path: 'admin/profile-review', element: lazyEl(<ProfileReviewPage />) },
          { path: 'admin/users', element: lazyEl(<UsersPage />) },
          { path: 'admin/roles', element: lazyEl(<RolesPage />) },
          { path: 'admin/roles/new', element: lazyEl(<RoleEditorPage />) },
          { path: 'admin/roles/:id', element: lazyEl(<RoleEditorPage />) },
          { path: 'admin/notifications', element: lazyEl(<NotificationSettingsPage />) },
          { path: 'admin/broadcast', element: lazyEl(<BroadcastPage />) },
          { path: 'admin/reps', element: lazyEl(<RepsListPage />) },
          { path: 'reports', element: lazyEl(<ReportsLandingPage />) },
          { path: 'reports/trends', element: lazyEl(<TrendsPage />) },
          { path: 'reports/exports', element: lazyEl(<ReportExportsPage />) },
          { path: 'admin/clients', element: lazyEl(<ClientsPage />) },
          { path: 'admin/clients/:id', element: lazyEl(<ClientDetailPage />) },
          { path: 'admin/products', element: lazyEl(<ProductsListPage />) },
          { path: 'admin/commission', element: lazyEl(<CommissionConfigPage />) },
          { path: 'admin/product-types', element: lazyEl(<ProductTypesPage />) },
          { path: 'admin/km-rates', element: lazyEl(<KmRatesPage />) },
          { path: 'admin/security', element: lazyEl(<SecuritySettingsPage />) },
          { path: 'admin/audit', element: lazyEl(<AuditLogPage />) },
          { path: 'admin/reconciliation', element: lazyEl(<ReconciliationPage />) },
          // Convenience redirects for legacy/short paths that previously dead-ended on a blank RR-404.
          { path: 'users', element: <Navigate to="/admin/users" replace /> },
          { path: 'reps', element: <Navigate to="/admin/reps" replace /> },
          // Friendly catch-all so no unknown path is ever a blank screen.
          { path: '*', element: lazyEl(<NotFoundPage />) },
            ],
          },
        ]),
      },
        ],
      },
        ],
      },
    ],
  },
]);
