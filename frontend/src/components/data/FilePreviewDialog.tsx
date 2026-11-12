/**
 * FilePreviewDialog — view a stored file (PDF or image) in a large window instead of a new tab (2026-11-12).
 * Used wherever the app keeps a file: rep documents, expense receipts. The dialog asks the caller for a
 * fresh short-lived signed URL each time it opens (and again for "Open in new tab"), because those URLs
 * expire within minutes. The kind is read from the file name in the URL: PDFs render page by page with
 * pdf.js (lazy-loaded, never on other screens), images fit the window; anything else offers the new tab.
 * Tokens only.
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Banner, Button, LoadingSpinner, Modal } from '../ui';
import { fileKindFromUrl } from '../../lib/files/fileKind';
import styles from './FilePreviewDialog.module.css';

const PdfDocumentView = lazy(() => import('../pdf/PdfDocumentView'));

export interface FilePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "Passport" or "Receipt". */
  title: string;
  /** Mints a fresh signed URL for the file (the caller's access-checked endpoint). */
  fetchUrl: () => Promise<string>;
}

type State = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error' };

export function FilePreviewDialog({ open, onOpenChange, title, fetchUrl }: FilePreviewDialogProps) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [opening, setOpening] = useState(false);
  const fetchRef = useRef(fetchUrl);
  fetchRef.current = fetchUrl;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetchRef
      .current()
      .then((url) => !cancelled && setState({ status: 'ready', url }))
      .catch(() => !cancelled && setState({ status: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const openInNewTab = async () => {
    setOpening(true);
    try {
      // A fresh link: the one on screen may already have expired.
      window.open(await fetchRef.current(), '_blank', 'noopener,noreferrer');
    } catch {
      setState({ status: 'error' });
    } finally {
      setOpening(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="xl"
      footer={
        <>
          <Button
            variant="secondary"
            type="button"
            leftIcon={<ExternalLink size={16} />}
            onClick={openInNewTab}
            loading={opening}
            disabled={state.status === 'error'}
          >
            Open in new tab
          </Button>
          <Button variant="primary" type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </>
      }
    >
      <div className={styles.stage}>
        {state.status === 'loading' && <Centered label="Loading file" />}
        {state.status === 'error' && (
          <Banner tone="warning" title="Preview unavailable">
            The file couldn’t be loaded. Please close this window and try again.
          </Banner>
        )}
        {state.status === 'ready' && <FileView url={state.url} title={title} />}
      </div>
    </Modal>
  );
}

function FileView({ url, title }: { url: string; title: string }) {
  const kind = fileKindFromUrl(url);
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const [imageFailed, setImageFailed] = useState(false);

  if (kind === 'image' && !imageFailed) {
    return (
      <div className={styles.imageWrap}>
        <img className={styles.image} src={url} alt={title} onError={() => setImageFailed(true)} />
      </div>
    );
  }
  if (kind === 'pdf') {
    return (
      <div ref={box} className={styles.pdfWrap}>
        {width > 0 && (
          <Suspense fallback={<Centered label="Loading viewer" />}>
            {/* Pages fill the window width (capped so text stays crisp, never stretched past 2x). */}
            <PdfDocumentView url={url} maxWidth={Math.min(width - 48, 1000)} viewerClassName={styles.pdfViewer} />
          </Suspense>
        )}
      </div>
    );
  }
  return (
    <Banner tone="info" title="No preview for this file">
      This kind of file can’t be shown here. Use Open in new tab to view or download it.
    </Banner>
  );
}

function Centered({ label }: { label: string }) {
  return (
    <div className={styles.centered}>
      <LoadingSpinner size="md" label={label} />
    </div>
  );
}

/** The element's current width, kept up to date as the window resizes. */
function useWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.round(el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
