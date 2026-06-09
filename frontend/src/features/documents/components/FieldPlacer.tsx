/**
 * FieldPlacer — the requester places signature fields on the PDF (where/what each recipient signs). Renders
 * the document via pdf.js and overlays draggable/resizable boxes per page. Coordinates are stored as
 * normalized 0..1 fractions (top-left origin) — resolution-independent, matching the server's stamp model.
 * Pick a type + recipient, then click an empty area of a page to drop a box; drag to move, corner to resize,
 * × to remove. — SRS DOC-003
 */
import { useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { FormField, Select } from '../../../components/ui';
import { DocumentPreview } from './DocumentPreview';
import { useDocumentFileUrl } from '../api/useDocumentFiles';
import { seriesColor } from '../../dashboards/charts/chartTheme';
import type { RenderedPage } from './pdf/PdfDocumentView';
import type { SignatureFieldInput, SignatureFieldType } from '../documents.types';
import styles from './fieldPlacer.module.css';

export interface PlacedField extends SignatureFieldInput {
  key: string; // local id
}

const FIELD_TYPES: { value: SignatureFieldType; label: string }[] = [
  { value: 'signature', label: 'Signature' },
  { value: 'initial', label: 'Initial' },
  { value: 'date', label: 'Date' },
  { value: 'text', label: 'Text' },
];

const DEFAULT_SIZE: Record<SignatureFieldType, { w: number; h: number }> = {
  signature: { w: 0.26, h: 0.07 },
  initial: { w: 0.1, h: 0.06 },
  date: { w: 0.18, h: 0.04 },
  text: { w: 0.26, h: 0.04 },
};

const clamp = (v: number) => Math.min(1, Math.max(0, v));

interface Props {
  documentId: string;
  recipients: { id: string; label: string }[];
  fields: PlacedField[];
  onChange: (fields: PlacedField[]) => void;
}

export function FieldPlacer({ documentId, recipients, fields, onChange }: Props) {
  const fileUrl = useDocumentFileUrl(documentId);
  const baseId = useId();
  const [type, setType] = useState<SignatureFieldType>('signature');
  const [recipientId, setRecipientId] = useState<string>(recipients[0]?.id ?? '');
  const drag = useRef<{ key: string; mode: 'move' | 'resize'; rect: DOMRect } | null>(null);

  const recipientColor = (id: string) => seriesColor(Math.max(0, recipients.findIndex((r) => r.id === id)));
  const recipientLabel = (id: string) => recipients.find((r) => r.id === id)?.label ?? 'recipient';

  const addField = (page: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current || !recipientId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const size = DEFAULT_SIZE[type];
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    const field: PlacedField = {
      key: `${baseId}-${fields.length}-${page}`,
      type,
      recipient_user_id: recipientId,
      page,
      x: clamp(cx - size.w / 2),
      y: clamp(cy - size.h / 2),
      w: size.w,
      h: size.h,
    };
    onChange([...fields, field]);
  };

  const onPointerDownBox = (key: string, mode: 'move' | 'resize', e: React.PointerEvent) => {
    e.stopPropagation();
    const overlay = (e.currentTarget as HTMLElement).closest('[data-overlay]') as HTMLElement | null;
    if (!overlay) return;
    drag.current = { key, mode, rect: overlay.getBoundingClientRect() };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const fx = (e.clientX - d.rect.left) / d.rect.width;
    const fy = (e.clientY - d.rect.top) / d.rect.height;
    onChange(
      fields.map((f) => {
        if (f.key !== d.key) return f;
        if (d.mode === 'move') {
          return { ...f, x: clamp(fx - f.w / 2), y: clamp(fy - f.h / 2) };
        }
        return { ...f, w: clamp(Math.max(0.04, fx - f.x)), h: clamp(Math.max(0.02, fy - f.y)) };
      }),
    );
  };

  const endDrag = () => {
    drag.current = null;
  };

  const removeField = (key: string, e: React.PointerEvent) => {
    e.stopPropagation();
    onChange(fields.filter((f) => f.key !== key));
  };

  const overlay = (page: RenderedPage) => (
    <div
      data-overlay
      className={styles.overlay}
      onPointerDown={(e) => addField(page.index, e)}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
    >
      {fields
        .filter((f) => f.page === page.index)
        .map((f) => (
          <div
            key={f.key}
            className={styles.box}
            style={{
              left: `${f.x * 100}%`,
              top: `${f.y * 100}%`,
              width: `${f.w * 100}%`,
              height: `${f.h * 100}%`,
              borderColor: recipientColor(f.recipient_user_id),
              background: `color-mix(in srgb, ${recipientColor(f.recipient_user_id)} 16%, transparent)`,
            }}
            onPointerDown={(e) => onPointerDownBox(f.key, 'move', e)}
          >
            <span className={styles.boxLabel} style={{ color: recipientColor(f.recipient_user_id) }}>
              {f.type} · {recipientLabel(f.recipient_user_id)}
            </span>
            <button type="button" className={styles.remove} onPointerDown={(e) => removeField(f.key, e)} aria-label="Remove field">
              <X size={12} />
            </button>
            <span
              className={styles.resize}
              style={{ borderColor: recipientColor(f.recipient_user_id) }}
              onPointerDown={(e) => onPointerDownBox(f.key, 'resize', e)}
            />
          </div>
        ))}
    </div>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <FormField label="Field">
          <Select options={FIELD_TYPES} value={type} onValueChange={(v) => setType(v as SignatureFieldType)} />
        </FormField>
        <FormField label="For recipient">
          <Select
            options={recipients.map((r) => ({ value: r.id, label: r.label }))}
            value={recipientId}
            onValueChange={setRecipientId}
            placeholder="Pick a recipient"
          />
        </FormField>
        <p className={styles.hint}>Click a page to drop the field, drag to move, corner to resize.</p>
      </div>
      <DocumentPreview query={fileUrl} renderPageOverlay={overlay} maxWidth={560} />
    </div>
  );
}
