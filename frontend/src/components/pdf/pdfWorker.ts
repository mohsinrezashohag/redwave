/**
 * pdf.js singleton + worker wiring. Imported only by the (lazy-loaded) PDF components so the ~2 MB
 * pdf.js chunk + worker never load on non-document screens. The worker URL is resolved by Vite via the
 * `?url` suffix. — design-system §10.5 (document preview)
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
