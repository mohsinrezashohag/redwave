/**
 * DocumentDatesReview — HR confirms an ID's issue and expiry dates (2026-11-12). When the document could be
 * read automatically, the dates arrive pre-filled with the consistency checks beside them (name, dates,
 * machine-readable strip). They are SUGGESTIONS: the fields stay editable, nothing is saved until HR clicks
 * Save, and the panel never calls a document "verified" or "genuine". Tokens only.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ScanText } from 'lucide-react';
import { Banner, Button, DatePicker, FormField, LoadingSpinner, Modal } from '../../../components/ui';
import { datesProblem } from '../repDocTypes';
import type { DocumentRead } from '../reps.types';
import styles from './reps.module.css';

export interface DocumentDates {
  issued_on: string | null;
  expires_on: string | null;
}

export function DocumentDatesReview({
  open,
  title,
  initial,
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
  /** The dates already on file (edit) or none (new upload). */
  initial: DocumentDates;
  read: DocumentRead | null;
  reading: boolean;
  /** Why reading didn't work, when it didn't. */
  note: string | null;
  saving: boolean;
  saveLabel: string;
  /** Offer "Read from document" (a stored document HR is editing). */
  onReadAgain?: () => void;
  onSave: (dates: DocumentDates) => void;
  onCancel: () => void;
}) {
  const [issued, setIssued] = useState('');
  const [expires, setExpires] = useState('');

  // Start from what's on file; whatever the reader finds fills in on top (HR can still change it).
  useEffect(() => {
    if (!open) return;
    setIssued(initial.issued_on?.slice(0, 10) ?? '');
    setExpires(initial.expires_on?.slice(0, 10) ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the panel opens
  }, [open]);
  useEffect(() => {
    if (!read) return;
    if (read.issued_on) setIssued(read.issued_on);
    if (read.expires_on) setExpires(read.expires_on);
  }, [read]);

  const problem = datesProblem(issued, expires);

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !saving && onCancel()}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="button"
            loading={saving}
            disabled={reading || !!problem}
            onClick={() => onSave({ issued_on: issued || null, expires_on: expires || null })}
          >
            {saveLabel}
          </Button>
        </>
      }
    >
      <div className={styles.datesReview}>
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
      </div>
    </Modal>
  );
}
