/**
 * DownloadLink — renders a download/open anchor for a file once its access-controlled signed URL resolves.
 * The bytes are fetched via an RBAC-gated /file-url endpoint (the URL expires), so the anchor opens the
 * fresh signed URL in a new tab / downloads it. Silent while loading; nothing if unavailable. — SRS DOC-002
 */
import { Download } from 'lucide-react';
import type { FileUrl } from '../api/useDocumentFiles';
import styles from './documents.module.css';

interface Props {
  query: { data?: FileUrl; isLoading: boolean; isError: boolean };
  label: string;
}

export function DownloadLink({ query, label }: Props) {
  if (query.isLoading) {
    return <span className={styles.copyLink}>…</span>;
  }
  if (query.isError || !query.data) {
    return null;
  }
  return (
    <a className={styles.copyLink} href={query.data.url} download={query.data.filename} target="_blank" rel="noreferrer">
      <Download size={14} /> {label}
    </a>
  );
}
