/**
 * DocumentPreview — fetches an access-controlled signed URL (via a file-url query passed in) and
 * lazy-renders the PDF with pdf.js. Reused for the original, a per-signer signed copy, and the final
 * completed copy. The heavy pdf.js view is code-split so it loads only when a preview is shown. Callers
 * can pass a `renderPageOverlay` (field placement / signing highlights). — SRS DOC-002
 */
import { Suspense, lazy, type ReactNode } from 'react';
import { Banner, LoadingSpinner } from '../../../components/ui';
import { isNotFound } from '../documents.logic';
import type { FileUrl } from '../api/useDocumentFiles';
import type { RenderedPage } from './pdf/PdfDocumentView';
import styles from './pdf/pdf.module.css';

const PdfDocumentView = lazy(() => import('./pdf/PdfDocumentView'));

interface FileUrlQuery {
  data?: FileUrl;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
}

interface Props {
  query: FileUrlQuery;
  renderPageOverlay?: (page: RenderedPage) => ReactNode;
  onReady?: (pageCount: number) => void;
  maxWidth?: number;
  /** Message when no file is available yet (e.g. completed copy before completion). */
  emptyMessage?: string;
}

export function DocumentPreview({ query, renderPageOverlay, onReady, maxWidth, emptyMessage }: Props) {
  if (query.isLoading) {
    return (
      <div className={styles.state}>
        <LoadingSpinner size="md" label="Loading document" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    const notReady = isNotFound(query.error);
    return (
      <Banner tone={notReady ? 'info' : 'warning'} title={notReady ? 'Not available yet' : 'Preview unavailable'}>
        {emptyMessage ??
          (notReady
            ? 'This file isn’t available yet, or storage isn’t configured on the server.'
            : 'Couldn’t load the document file.')}
      </Banner>
    );
  }
  return (
    <Suspense
      fallback={
        <div className={styles.state}>
          <LoadingSpinner size="md" label="Loading viewer" />
        </div>
      }
    >
      <PdfDocumentView url={query.data.url} renderPageOverlay={renderPageOverlay} onReady={onReady} maxWidth={maxWidth} />
    </Suspense>
  );
}
