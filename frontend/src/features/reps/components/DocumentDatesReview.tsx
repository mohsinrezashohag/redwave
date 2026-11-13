/**
 * DocumentDatesReview — HR confirms an ID's issue and expiry dates (2026-11-12), and edits a document on file
 * (its type + dates). When the document could be read automatically, the dates arrive pre-filled with the
 * consistency checks beside them (name, dates, machine-readable strip). They are SUGGESTIONS: the fields stay
 * editable, nothing is saved until HR clicks Save, and the panel never calls a document "verified" or
 * "genuine". The date fields only show for types that carry dates. Tokens only.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ScanText } from 'lucide-react';
import { Banner, Button, DatePicker, FormField, LoadingSpinner, Modal, PrivateInput, Select } from '../../../components/ui';
import { datesProblem, EXPIRING_DOC_TYPES, REP_DOC_TYPES } from '../repDocTypes';
import type { DocumentRead } from '../reps.types';
import styles from './reps.module.css';

export interface DocumentDates {
  issued_on: string | null;
  expires_on: string | null;
  /** HR-confirmed identity details (2026-11-13), IDs only. */
  name_on_document: string | null;
  date_of_birth: string | null;
  /** Write-only. Undefined = keep the one on file (only its mask is ever shown). */
  document_number?: string;
}

export interface DocumentEdit extends DocumentDates {
  doc_type: string;
  /** "••••4567" when a number is already on file (edit). */
  document_number_masked?: string | null;
}

export function DocumentDatesReview({
  open,
  title,
  initial,
  editType = false,
  read,
  reading,
  note,
  saving,
  saveLabel,
  onReadAgain,
  onSave,
  onCancel,
}: {
  open: boolean;
  title: string;
  /** The type and dates already on file (edit) or the chosen type with no dates (new upload). */
  initial: DocumentEdit;
  /** Offer the Type picker (editing a document on file). */
  editType?: boolean;
  read: DocumentRead | null;
  reading: boolean;
  /** Why reading didn't work, when it didn't. */
  note: string | null;
  saving: boolean;
  saveLabel: string;
  /** Offer "Read from document" (a stored document HR is editing). */
  onReadAgain?: () => void;
  onSave: (edit: DocumentEdit) => void;
  onCancel: () => void;
}) {
  const [docType, setDocType] = useState('');
  const [issued, setIssued] = useState('');
  const [expires, setExpires] = useState('');
  const [nameOnDoc, setNameOnDoc] = useState('');
  const [dob, setDob] = useState('');
  const [docNumber, setDocNumber] = useState('');

  const startIssued = initial.issued_on?.slice(0, 10) ?? '';
  const startExpires = initial.expires_on?.slice(0, 10) ?? '';
  const startName = initial.name_on_document ?? '';
  const startDob = initial.date_of_birth?.slice(0, 10) ?? '';

  // Start from what's on file; whatever the reader finds fills in on top (HR can still change it).
  useEffect(() => {
    if (!open) return;
    setDocType(initial.doc_type);
    setIssued(startIssued);
    setExpires(startExpires);
    setNameOnDoc(startName);
    setDob(startDob);
    setDocNumber('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the panel opens
  }, [open]);
  useEffect(() => {
    if (!read) return;
    if (read.issued_on) setIssued(read.issued_on);
    if (read.expires_on) setExpires(read.expires_on);
    if (read.name_on_document) setNameOnDoc(read.name_on_document);
    if (read.date_of_birth) setDob(read.date_of_birth);
    if (read.document_number) setDocNumber(read.document_number);
  }, [read]);

  const hasDates = EXPIRING_DOC_TYPES.has(docType);
  const problem = hasDates ? datesProblem(issued, expires) : null;
  const dirty =
    docType !== initial.doc_type ||
    issued !== startIssued ||
    expires !== startExpires ||
    nameOnDoc !== startName ||
    dob !== startDob ||
    docNumber !== '';
  // A known type is required when editing (rows uploaded before the list existed keep a free-text type).
  const typeOptions = REP_DOC_TYPES.map((t) => ({ value: t.value, label: t.label }));
  const validType = REP_DOC_TYPES.some((t) => t.value === docType);

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !saving && onCancel()}
      title={title}
      size="md"
      dirty={dirty && !saving}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="button"
            loading={saving}
            disabled={reading || !!problem || (editType && !validType)}
            onClick={() =>
              onSave({
                doc_type: docType,
                issued_on: hasDates ? issued || null : null,
                expires_on: hasDates ? expires || null : null,
                name_on_document: hasDates ? nameOnDoc.trim() || null : null,
                date_of_birth: hasDates ? dob || null : null,
                ...(hasDates && docNumber.trim() ? { document_number: docNumber.trim() } : {}),
              })
            }
          >
            {saveLabel}
          </Button>
        </>
      }
    >
      <div className={styles.datesReview}>
        {editType && (
          <FormField label="Document type" required help={docType === 'headshot' ? 'A headshot must be a JPG or PNG photo.' : undefined}>
            <Select options={typeOptions} value={validType ? docType : ''} onValueChange={setDocType} placeholder="Choose…" aria-label="Document type" />
          </FormField>
        )}

        {hasDates && (
          <>
            {reading ? (
              <p className={styles.readingRow}>
                <LoadingSpinner size="sm" label="" /> Reading the document…
              </p>
            ) : read ? (
              <Banner tone="info" title="Read automatically">
                Please check these dates against the document before saving.
              </Banner>
            ) : note ? (
              <Banner tone="warning" title="Enter the dates by hand">
                {note}
              </Banner>
            ) : null}

            <div className={styles.grid2}>
              <FormField label="Issued on">
                <DatePicker value={issued} onChange={setIssued} clearable aria-label="Issued on" />
              </FormField>
              <FormField label="Expires on" error={problem ?? undefined} help="We flag it 60 days before it expires.">
                <DatePicker value={expires} onChange={setExpires} clearable aria-label="Expires on" />
              </FormField>
            </div>

            <p className={styles.checksTitle}>Holder details</p>
            <FormField label="Name on document" help="As printed. Used on the Data accuracy tab.">
              <PrivateInput value={nameOnDoc} onChange={(e) => setNameOnDoc(e.target.value)} placeholder="e.g. RIVERA, RILEY" />
            </FormField>
            <div className={styles.grid2}>
              <FormField label="Date of birth">
                <DatePicker value={dob} onChange={setDob} clearable aria-label="Date of birth on document" />
              </FormField>
              <FormField
                label="Document number"
                help={
                  initial.document_number_masked
                    ? `On file (${initial.document_number_masked}). Leave blank to keep it.`
                    : 'Saved encrypted. Only the last four are shown.'
                }
              >
                <PrivateInput value={docNumber} onChange={(e) => setDocNumber(e.target.value)} className="mono" placeholder="AB1234567" />
              </FormField>
            </div>

            {read && read.checks.length > 0 && (
              <div>
                <p className={styles.checksTitle}>Checks</p>
                <ul className={styles.checks}>
                  {read.checks.map((c) => (
                    <li key={c.key} className={c.ok ? styles.checkOk : styles.checkWarn}>
                      {c.ok ? <CheckCircle2 size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />}
                      <span>{c.message}</span>
                    </li>
                  ))}
                </ul>
                <p className={styles.muted}>These checks catch mistakes and mismatches. They can’t prove a document is genuine.</p>
              </div>
            )}

            {onReadAgain && !reading && (
              <Button variant="tertiary" size="sm" type="button" leftIcon={<ScanText size={14} />} onClick={onReadAgain}>
                Read from document
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
