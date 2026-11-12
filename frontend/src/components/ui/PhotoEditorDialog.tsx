/**
 * PhotoEditorDialog — crop, zoom and rotate a chosen photo before it is saved (2026-11-12). Drag the picture
 * to position it inside the circle, use the slider to zoom, rotate in 90° steps. Save renders the visible
 * square (512×512 JPEG) on a canvas with the same geometry the preview uses (lib/files/photoCrop), so the
 * saved photo is exactly what was shown. Keyboard: arrow keys move the photo, +/− zoom. Tokens only.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';
import {
  clampOffset,
  displayScale,
  drawCrop,
  INITIAL_CROP,
  MAX_ZOOM,
  MIN_ZOOM,
  nextRotation,
  type CropState,
} from '../../lib/files/photoCrop';
import styles from './PhotoEditorDialog.module.css';

const VIEWPORT = 280; // must match .viewport in the CSS
const OUTPUT = 512;

export interface PhotoEditResult {
  /** The edited square JPEG to save. */
  file: File;
  /** The original pick + the crop used, so "Edit photo" can reopen exactly where the user left off. */
  source: File;
  crop: CropState;
}

export interface PhotoEditorDialogProps {
  /** The original file the user picked; null closes the dialog. */
  source: File | null;
  /** Re-open with an earlier crop (Edit photo), else start centred. */
  initialCrop?: CropState;
  title?: string;
  saveLabel?: string;
  saving?: boolean;
  onCancel: () => void;
  onSave: (result: PhotoEditResult) => void;
}

export function PhotoEditorDialog({
  source,
  initialCrop,
  title = 'Edit photo',
  saveLabel = 'Apply',
  saving = false,
  onCancel,
  onSave,
}: PhotoEditorDialogProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<CropState>(initialCrop ?? INITIAL_CROP);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);

  useEffect(() => {
    if (!source) return;
    const u = URL.createObjectURL(source);
    setUrl(u);
    setSize(null);
    setCrop(initialCrop ?? INITIAL_CROP);
    return () => URL.revokeObjectURL(u);
  }, [source, initialCrop]);

  const update = (next: CropState) => {
    if (!size) return;
    setCrop(clampOffset(next, size.w, size.h, VIEWPORT));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, dx: crop.dx, dy: crop.dy };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    update({ ...crop, dx: drag.current.dx + e.clientX - drag.current.x, dy: drag.current.dy + e.clientY - drag.current.y });
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 10;
    const moves: Record<string, Partial<CropState>> = {
      ArrowLeft: { dx: crop.dx - step },
      ArrowRight: { dx: crop.dx + step },
      ArrowUp: { dy: crop.dy - step },
      ArrowDown: { dy: crop.dy + step },
      '+': { zoom: Math.min(MAX_ZOOM, crop.zoom + 0.1) },
      '=': { zoom: Math.min(MAX_ZOOM, crop.zoom + 0.1) },
      '-': { zoom: Math.max(MIN_ZOOM, crop.zoom - 0.1) },
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    update({ ...crop, ...m });
  };

  const save = async () => {
    const img = imgRef.current;
    if (!img || !size || !source) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawCrop(ctx, img, size.w, size.h, crop, VIEWPORT, OUTPUT);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) return;
    const name = source.name.replace(/\.[^.]+$/, '') + '.jpg';
    onSave({ file: new File([blob], name, { type: 'image/jpeg' }), source, crop });
  };

  const scale = size ? displayScale(size.w, size.h, crop.rotation, VIEWPORT, crop.zoom) : 0;

  return (
    <Modal
      open={!!source}
      onOpenChange={(o) => {
        if (!o && !saving) onCancel();
      }}
      title={title}
      description="Drag to position the photo, then zoom or rotate it until it looks right."
      size="sm"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="button" onClick={() => void save()} loading={saving} disabled={!size}>
            {saveLabel}
          </Button>
        </>
      }
    >
      <div className={styles.editor}>
        <div
          className={styles.viewport}
          tabIndex={0}
          role="application"
          aria-label="Photo position. Drag, or use the arrow keys to move and plus or minus to zoom."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {url && (
            <img
              ref={imgRef}
              src={url}
              alt=""
              draggable={false}
              className={styles.image}
              onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              style={
                size
                  ? {
                      width: size.w,
                      height: size.h,
                      transform: `translate(-50%, -50%) translate(${crop.dx}px, ${crop.dy}px) rotate(${crop.rotation}deg) scale(${scale})`,
                    }
                  : { visibility: 'hidden' }
              }
            />
          )}
          <span className={styles.mask} aria-hidden />
        </div>

        <div className={styles.controls}>
          <ZoomOut size={16} aria-hidden className={styles.icon} />
          <input
            type="range"
            className={styles.slider}
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={(e) => update({ ...crop, zoom: Number(e.target.value) })}
            aria-label="Zoom"
            disabled={!size}
          />
          <ZoomIn size={16} aria-hidden className={styles.icon} />
          <Button
            variant="tertiary"
            size="sm"
            type="button"
            leftIcon={<RotateCw size={14} />}
            onClick={() => update({ ...crop, rotation: nextRotation(crop.rotation), dx: 0, dy: 0 })}
            disabled={!size}
          >
            Rotate
          </Button>
        </div>
      </div>
    </Modal>
  );
}
