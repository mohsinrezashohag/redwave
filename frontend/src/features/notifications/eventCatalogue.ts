/**
 * Event catalogue documentation — the STATIC map of who each automatic event notifies (its INTRINSIC
 * recipients, shown read-only) and which `{variables}` its templates may reference. This mirrors the
 * backend emit sites (Chunk 5) and the seeded templates (prisma/seed/bootstrap.ts). Recipients are
 * intrinsic to each trigger and are NOT editable here — free targeting is the Broadcast feature. Adding a
 * genuinely NEW automatic trigger needs a code change (a new emit call); the SA manages this catalogue
 * (channel + template), not the trigger logic. — SRS §14 / BRD §9.3
 */
export interface EventDoc {
  /** Read-only description of who this event notifies (intrinsic to the trigger). */
  recipients: string;
  /** Template variables the emit site provides for {placeholder} substitution. */
  variables: string[];
}

export const EVENT_CATALOGUE: Record<string, EventDoc> = {
  sale_validated: { recipients: "The sale's rep", variables: ['sale_code', 'customer_name'] },
  expense_submitted: {
    recipients: "The rep's field manager (or all Admins & Super Admins if none)",
    variables: ['submitter_name', 'week_start'],
  },
  expense_approved: { recipients: 'The report submitter', variables: ['week_start'] },
  expense_rejected: { recipients: 'The report submitter', variables: ['week_start', 'note'] },
  expense_sent_back: { recipients: 'The report submitter', variables: ['week_start', 'note'] },
  signature_requested: { recipients: 'Each requested signer', variables: ['requester_name', 'document_name'] },
  signature_signed: { recipients: 'The document owner', variables: ['signer_name', 'document_name'] },
  signature_declined: { recipients: 'The document owner', variables: ['signer_name', 'document_name'] },
  document_completed: { recipients: 'The document owner', variables: ['document_name'] },
  pay_run_finalized: { recipients: 'Each rep paid in the run', variables: ['period_number', 'net_payout'] },
  holdback_released: { recipients: 'The rep whose holdback released', variables: ['amount', 'period_number'] },
  clawback_applied: { recipients: 'The affected rep', variables: ['amount', 'reason'] },
  profile_change_requested: {
    recipients: 'The reviewers (field manager + Admins & Super Admins)',
    variables: ['subject_name'],
  },
  profile_change_decided: { recipients: 'The requesting user', variables: ['outcome'] },
  statement_ready: { recipients: 'Admins & Super Admins', variables: ['period_number'] },
  rate_change: { recipients: 'Admins & Super Admins', variables: ['rate_kind', 'client_code'] },
  import_committed: { recipients: 'Admins & Super Admins', variables: ['import_type', 'committed_count'] },
  broadcast: { recipients: 'Chosen at send time (the Broadcast composer)', variables: [] },
};

export const humanizeEvent = (eventType: string): string =>
  eventType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const eventDoc = (eventType: string): EventDoc =>
  EVENT_CATALOGUE[eventType] ?? { recipients: 'System-defined', variables: [] };
