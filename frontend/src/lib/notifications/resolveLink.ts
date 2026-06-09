/**
 * resolveLink — maps a notification to the in-app route for its related record (click-through). Some
 * events key off the notification TYPE (a profile-change decision goes to My Account, a request goes to
 * the review queue); the rest map by `related_entity_type` + `related_entity_id`. Returns null when there's
 * no good target (the row then just marks read without navigating). Pure.
 */
import type { AppNotification } from '../../features/notifications/notifications.types';

export function resolveNotificationLink(n: Pick<AppNotification, 'type' | 'related_entity_type' | 'related_entity_id'>): string | null {
  // Type-specific routing first (same entity, different destination per audience).
  if (n.type === 'profile_change_decided') return '/account';
  if (n.type === 'profile_change_requested') return '/admin/profile-review';

  const t = n.related_entity_type;
  const id = n.related_entity_id;
  if (!t) return null;
  switch (t) {
    case 'sales':
      return id ? `/sales/${id}` : '/sales';
    case 'expense_reports':
      return id ? `/expenses/${id}` : '/expenses';
    case 'documents':
      return id ? `/documents/${id}` : '/documents';
    case 'pay_runs':
      return id ? `/pay-runs/${id}` : '/pay-runs';
    case 'client_statements':
      return id ? `/billing/statements/${id}` : '/billing';
    case 'import_batches':
      return id ? `/import/${id}` : '/import';
    case 'clawbacks':
      return '/clawbacks'; // no per-clawback detail route — the list
    case 'client_billing_rates':
      return '/admin/clients'; // rates live under a client's detail
    default:
      return null;
  }
}
