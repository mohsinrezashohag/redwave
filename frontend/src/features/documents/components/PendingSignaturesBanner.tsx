/**
 * PendingSignaturesBanner — "You have N documents to sign". A nudge for the documents list and the
 * dashboard. Reads the caller's own "to sign" inbox (`awaiting_my_signature`, row-level server-side:
 * only documents where THIS user has a pending signature in a pending request). One document links
 * straight to its signing page; several link to the filtered list. Renders nothing while loading, on an
 * error, without `documents:view`, or when nothing is waiting: it is a prompt, not a data view.
 */
import { Link } from 'react-router-dom';
import { FileSignature } from 'lucide-react';
import { Banner } from '../../../components/ui';
import { useCan } from '../../../auth/useCan';
import { useDocuments } from '../api/useDocuments';
import styles from './documents.module.css';

export function PendingSignaturesBanner({ hideListLink = false }: { hideListLink?: boolean }) {
  const canView = useCan('documents:view');
  const q = useDocuments({ awaiting_my_signature: true }, canView);
  const docs = q.data ?? [];
  if (!canView || q.isLoading || q.isError || docs.length === 0) return null;

  const one = docs.length === 1 ? docs[0] : null;
  return (
    <Banner tone="info" title={one ? 'You have 1 document to sign' : `You have ${docs.length} documents to sign`}>
      <span className={styles.bannerBody}>
        <span>{one ? `“${one.title}” is waiting for your signature.` : 'These documents are waiting for your signature.'}</span>
        <span className={styles.bannerActions}>
          {one ? (
            <Link className={styles.bannerCta} to={`/documents/${one.id}/sign`}>
              <FileSignature size={16} aria-hidden /> Sign now
            </Link>
          ) : (
            !hideListLink && (
              <Link className={styles.bannerCta} to="/documents?queue=to-sign">
                <FileSignature size={16} aria-hidden /> Review and sign
              </Link>
            )
          )}
        </span>
      </span>
    </Banner>
  );
}
