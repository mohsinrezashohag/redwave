/**
 * PdfDocumentView — renders every page of a PDF (from a signed URL) to canvases in a scrollable column,
 * and exposes each page's DISPLAY size so callers can absolutely-position overlays (field placement /
 * signing highlights) using normalized 0..1 fractions. This single component backs preview, the field
 * placer, and the signing view. pdf.js is loaded here (lazy), never on other screens. — SRS DOC-002/003
 *
 * Two-phase: (1) measure each page's display size and mount a canvas per page; (2) once the canvases
 * exist, render the pages onto them. Coordinates an overlay layer per page sized to the display box.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LoadingSpinner } from '../../../../components/ui';
import { pdfjs } from './pdfWorker';
import styles from './pdf.module.css';

export interface RenderedPage {
  index: number; // 0-based
  width: number; // display px
  height: number; // display px
}

interface Props {
  url: string;
  /** Optional absolutely-positioned overlay per page (e.g. field boxes). */
  renderPageOverlay?: (page: RenderedPage) => ReactNode;
  /** Called once the document's page count is known. */
  onReady?: (pageCount: number) => void;
  /** Target render width in px (display). Defaults to 720. */
  maxWidth?: number;
}

const renderScale = (baseWidth: number, maxWidth: number) => Math.min(maxWidth / baseWidth, 2);

export default function PdfDocumentView({ url, renderPageOverlay, onReady, maxWidth = 720 }: Props) {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());

  // Phase 1 — measure page sizes + mount the canvases.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setPages([]);
    (async () => {
      try {
        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) return;
        onReady?.(doc.numPages);
        const dims: RenderedPage[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const vp = page.getViewport({ scale: renderScale(page.getViewport({ scale: 1 }).width, maxWidth) });
          dims.push({ index: n - 1, width: vp.width, height: vp.height });
        }
        if (!cancelled) setPages(dims);
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, maxWidth]);

  // Phase 2 — draw each page onto its mounted canvas.
  useEffect(() => {
    if (pages.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const doc = await pdfjs.getDocument({ url }).promise;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= doc.numPages; n++) {
          if (cancelled) return;
          const canvas = canvasRefs.current.get(n - 1);
          if (!canvas) continue;
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale: renderScale(page.getViewport({ scale: 1 }).width, maxWidth) });
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            await page.render({ canvasContext: ctx, viewport }).promise;
          }
        }
        if (!cancelled) setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pages, url, maxWidth]);

  if (status === 'error') {
    return <div className={styles.state}>Couldn’t render this document.</div>;
  }

  return (
    <div className={styles.viewer}>
      {status === 'loading' && pages.length === 0 && (
        <div className={styles.state}>
          <LoadingSpinner size="md" label="Loading document" />
        </div>
      )}
      {pages.map((p) => (
        <div key={p.index} className={styles.page} style={{ width: p.width, height: p.height }}>
          <canvas
            className={styles.canvas}
            ref={(el) => {
              if (el) canvasRefs.current.set(p.index, el);
              else canvasRefs.current.delete(p.index);
            }}
          />
          {renderPageOverlay && (
            <div className={styles.overlay} data-page={p.index}>
              {renderPageOverlay(p)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
