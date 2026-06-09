/**
 * SignaturePad — a small canvas drawing surface (signature_pad) for capturing a hand-drawn signature.
 * Imperative handle: toDataUrl() (PNG) / clear() / isEmpty(). Themed via tokens; the pen colour follows
 * the text colour so it reads in both themes. Used by the saved-signature manager + the signing flow.
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
  height?: number;
  onChange?: (empty: boolean) => void;
  ariaLabel?: string;
}

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { height = 160, onChange, ariaLabel = 'Draw your signature' },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const { width } = canvas.getBoundingClientRect();
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      const ctx = canvas.getContext('2d');
      ctx?.scale(ratio, ratio);
      padRef.current?.clear();
    };
    // Pen colour from the computed text colour so it reads on either theme.
    const penColor = getComputedStyle(canvas).color || '#111111';
    const pad = new SignaturePadLib(canvas, { penColor, backgroundColor: 'rgba(0,0,0,0)' });
    padRef.current = pad;
    resize();
    const onEnd = () => {
      const isEmpty = pad.isEmpty();
      setEmpty(isEmpty);
      onChange?.(isEmpty);
    };
    pad.addEventListener('endStroke', onEnd);
    window.addEventListener('resize', resize);
    return () => {
      pad.removeEventListener('endStroke', onEnd);
      window.removeEventListener('resize', resize);
      pad.off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className={styles.wrap}>
      <canvas ref={canvasRef} className={styles.canvas} style={{ height }} aria-label={ariaLabel} role="img" />
      {empty && <span className={styles.hint}>Sign here</span>}
    </div>
  );
});
