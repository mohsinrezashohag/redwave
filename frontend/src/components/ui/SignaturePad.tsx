/**
 * SignaturePad — a canvas drawing surface (signature_pad) for capturing a hand-drawn signature.
 * Imperative handle: toDataUrl() (PNG) / clear() / isEmpty(). Themed via tokens; the pen colour follows
 * the (light-paper) text colour: the pad is always light, because the ink is stamped onto a white PDF. Used by the saved-signature manager + the signing flow.
 *
 * Full width and RESPONSIVE height by default (taller on phones, where a finger needs the room; see the
 * CSS). A caller may still pin a fixed `height` in px. The drawing survives a resize (the strokes are
 * replayed), so a phone's address bar collapsing mid-signature never wipes it.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import SignaturePadLib from 'signature_pad';
import styles from './SignaturePad.module.css';

export interface SignaturePadHandle {
  toDataUrl: () => string | null; // null when empty
  clear: () => void;
  isEmpty: () => boolean;
}

interface Props {
  /** Fixed height in px. Omit for the responsive default (taller on small screens). */
  height?: number;
  onChange?: (empty: boolean) => void;
  ariaLabel?: string;
}

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { height, onChange, ariaLabel = 'Draw your signature' },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const [empty, setEmpty] = useState(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    // Pen colour from the computed text colour so it reads on either theme.
    const penColor = getComputedStyle(canvas).color || 'black';
    const pad = new SignaturePadLib(canvas, { penColor, backgroundColor: 'rgba(0,0,0,0)' });
    padRef.current = pad;

    let lastW = 0;
    let lastH = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w === 0 || h === 0 || (w === lastW && h === lastH)) return;
      lastW = w;
      lastH = h;
      const strokes = pad.toData(); // resizing a canvas clears it, so replay what was drawn
      canvas.width = Math.floor(w * ratio);
      canvas.height = Math.floor(h * ratio);
      canvas.getContext('2d')?.scale(ratio, ratio);
      pad.clear();
      if (strokes.length) pad.fromData(strokes);
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);
    window.addEventListener('resize', resize);

    const onEnd = () => {
      const isEmpty = pad.isEmpty();
      setEmpty(isEmpty);
      onChangeRef.current?.(isEmpty);
    };
    pad.addEventListener('endStroke', onEnd);
    return () => {
      pad.removeEventListener('endStroke', onEnd);
      ro?.disconnect();
      window.removeEventListener('resize', resize);
      pad.off();
    };
  }, [height]);

  useImperativeHandle(ref, () => ({
    toDataUrl: () => (padRef.current && !padRef.current.isEmpty() ? padRef.current.toDataURL('image/png') : null),
    clear: () => {
      padRef.current?.clear();
      setEmpty(true);
      onChange?.(true);
    },
    isEmpty: () => padRef.current?.isEmpty() ?? true,
  }));

  return (
    // Always a light "paper" (data-theme re-roots the tokens): the ink must read on the WHITE PDF page it
    // is stamped onto, so a dark-theme user must not draw a light-grey signature.
    <div className={styles.wrap} data-theme="light">
      <canvas
        ref={canvasRef}
        className={height ? styles.canvas : `${styles.canvas} ${styles.responsive}`}
        style={height ? { height } : undefined}
        aria-label={ariaLabel}
        role="img"
      />
      {empty && <span className={styles.hint}>Sign here</span>}
    </div>
  );
});
