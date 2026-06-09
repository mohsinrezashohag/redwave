/**
 * SignDeclineModal — the ROW-LEVEL sign/decline action. Only opened for the current user when they are the
 * asked PENDING signer (findMyPendingSignature); the SERVER is the real gate (non-signer → 403, closed → 409).
 *
 * Signing is IN-SYSTEM: preview the document with YOUR assigned fields highlighted, apply a signature
 * (a saved one, drawn, or typed), fill any text fields (dates auto-fill server-side), and submit — the
 * server stamps a distinct signed copy (the original is never modified, DOC-004). You can also upload an
 * externally-signed PDF instead. DECLINE IS TERMINAL. — SRS DOC-003/004
 */
import { useRef, useState } from 'react';
import { Banner, Button, FileUpload, FormField, Input, Modal, Select, SignaturePad, useToast, type SignaturePadHandle } from '../../../components/ui';
import { useAuth } from '../../../auth/useAuth';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { typedSignatureDataUrl } from '../../../lib/signature';
import { useSignatures } from '../../account/api/useSignatures';
import { useSignRequest, useSignUpload } from '../api/useDocumentMutations';
import { useDocumentFileUrl } from '../api/useDocumentFiles';
import { DocumentPreview } from './DocumentPreview';
import type { RenderedPage } from './pdf/PdfDocumentView';
import styles from './documents.module.css';
import placer from './fieldPlacer.module.css';
import type { SignBody, SignDecision, SignatureField, SignatureRequest } from '../documents.types';

interface Props {
  open: boolean;
  onClose: () => void;
  documentId: string;
  request: SignatureRequest | null;
  decision: SignDecision;
}

type Source = 'saved' | 'draw' | 'type';

export function SignDeclineModal({ open, onClose, documentId, request, decision }: Props) {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const { user } = useAuth();
  const sign = useSignRequest();
  const signUpload = useSignUpload();
  const saved = useSignatures();
  const fileUrl = useDocumentFileUrl(documentId, open && decision === 'sign');

  const isSign = decision === 'sign';
  const myFields: SignatureField[] = (request?.signature_fields ?? []).filter((f) => f.recipient_user_id === user?.id);
  const needsImage = myFields.some((f) => f.type === 'signature' || f.type === 'initial');
  const textFields = myFields.filter((f) => f.type === 'text');

  const savedList = saved.data ?? [];
  const [source, setSource] = useState<Source>('saved');
  const [savedId, setSavedId] = useState<string>('');
  const [typedName, setTypedName] = useState('');
  const [padEmpty, setPadEmpty] = useState(true);
  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const padRef = useRef<SignaturePadHandle>(null);

  const effectiveSource: Source = savedList.length === 0 && source === 'saved' ? 'draw' : source;
  const defaultSavedId = savedId || savedList.find((s) => s.is_default)?.id || savedList[0]?.id || '';

  const buildSignature = (): { signature_id?: string; signature_image?: string; method: string } | null => {
    if (effectiveSource === 'saved') {
      return defaultSavedId ? { signature_id: defaultSavedId, method: 'saved' } : null;
    }
    if (effectiveSource === 'draw') {
      const url = padRef.current?.toDataUrl();
      return url ? { signature_image: url, method: 'drawn' } : null;
    }
    return typedName.trim() ? { signature_image: typedSignatureDataUrl(typedName.trim()), method: 'typed' } : null;
  };

  const signatureReady =
    !needsImage ||
    (effectiveSource === 'saved' ? !!defaultSavedId : effectiveSource === 'draw' ? !padEmpty : !!typedName.trim());

  const onSign = () => {
    if (!request) return;
    const sig = needsImage ? buildSignature() : null;
    if (needsImage && !sig) return;
    const body: SignBody = {
      decision: 'sign',
      method: sig?.method ?? 'click_to_sign',
      ...(sig?.signature_id ? { signature_id: sig.signature_id } : {}),
      ...(sig?.signature_image ? { signature_image: sig.signature_image } : {}),
      ...(textFields.length ? { field_values: textFields.map((f) => ({ field_id: f.id, text: textValues[f.id] ?? '' })) } : {}),
    };
    sign.mutate(
      { requestId: request.id, body },
      {
        onSuccess: () => {
          toast({ title: 'Document signed', tone: 'success' });
          resetAndClose();
        },
        onError,
      },
    );
  };

  const onDecline = () => {
    if (!request) return;
    sign.mutate(
      { requestId: request.id, body: { decision: 'decline' } },
      {
        onSuccess: () => {
          toast({ title: 'Signature declined', tone: 'warning' });
          resetAndClose();
        },
        onError,
      },
    );
  };

  const onUploadSigned = () => {
    if (!request || !uploadFile) return;
    signUpload.mutate(
      { requestId: request.id, file: uploadFile },
      {
        onSuccess: () => {
          toast({ title: 'Signed file uploaded', tone: 'success' });
          resetAndClose();
        },
        onError,
      },
    );
  };

  const resetAndClose = () => {
    setSavedId('');
    setTypedName('');
    setTextValues({});
    setUploadFile(null);
    setPadEmpty(true);
    onClose();
  };

  const busy = sign.isPending || signUpload.isPending;

  const overlay = (page: RenderedPage) => (
    <>
      {myFields
        .filter((f) => f.page === page.index)
        .map((f) => (
          <div
            key={f.id}
            className={placer.box}
            style={{
              left: `${Number(f.x) * 100}%`,
              top: `${Number(f.y) * 100}%`,
              width: `${Number(f.w) * 100}%`,
              height: `${Number(f.h) * 100}%`,
              borderColor: 'var(--accent)',
              background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
              cursor: 'default',
              pointerEvents: 'none',
            }}
          >
            <span className={placer.boxLabel} style={{ color: 'var(--accent)' }}>{f.type}</span>
          </div>
        ))}
    </>
  );

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !busy && resetAndClose()}
      title={isSign ? 'Sign document' : 'Decline to sign'}
      size={isSign ? 'lg' : 'md'}
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={resetAndClose} disabled={busy}>
            Cancel
          </Button>
          {isSign ? (
            <Button variant="primary" type="button" onClick={onSign} loading={sign.isPending} disabled={busy || !signatureReady}>
              Sign document
            </Button>
          ) : (
            <Button variant="destructive" type="button" onClick={onDecline} loading={sign.isPending} disabled={busy}>
              Decline
            </Button>
          )}
        </div>
      }
    >
      <div className={styles.form}>
        {isSign ? (
          <>
            <p className={styles.note}>
              Your assigned fields are highlighted. Apply your signature — a signed copy is stored; the original is never modified.
            </p>
            {myFields.length > 0 && <DocumentPreview query={fileUrl} renderPageOverlay={overlay} maxWidth={520} />}

            {needsImage && (
              <>
                <FormField label="Signature">
                  <Select
                    options={[
                      ...(savedList.length ? [{ value: 'saved', label: 'Use a saved signature' }] : []),
                      { value: 'draw', label: 'Draw' },
                      { value: 'type', label: 'Type' },
                    ]}
                    value={effectiveSource}
                    onValueChange={(v) => setSource(v as Source)}
                  />
                </FormField>
                {effectiveSource === 'saved' && savedList.length > 0 && (
                  <FormField label="Saved signature">
                    <Select
                      options={savedList.map((s) => ({ value: s.id, label: `${s.label}${s.is_default ? ' (default)' : ''}` }))}
                      value={defaultSavedId}
                      onValueChange={setSavedId}
                    />
                  </FormField>
                )}
                {effectiveSource === 'draw' && (
                  <FormField label="Draw your signature">
                    <SignaturePad ref={padRef} onChange={setPadEmpty} />
                    <button type="button" className={styles.linkBtn} onClick={() => padRef.current?.clear()}>Clear</button>
                  </FormField>
                )}
                {effectiveSource === 'type' && (
                  <FormField label="Type your name">
                    <Input value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Your full name" maxLength={60} />
                  </FormField>
                )}
              </>
            )}

            {textFields.map((f, i) => (
              <FormField key={f.id} label={`Text field ${i + 1}`}>
                <Input value={textValues[f.id] ?? ''} onChange={(e) => setTextValues((p) => ({ ...p, [f.id]: e.target.value }))} maxLength={200} />
              </FormField>
            ))}
            {myFields.some((f) => f.type === 'date') && (
              <p className={styles.note}>Date fields will be filled with today’s date automatically.</p>
            )}

            <details className={styles.details}>
              <summary>Sign outside the app instead</summary>
              <div className={styles.form}>
                <p className={styles.note}>Download the document, sign it elsewhere, then upload the signed PDF.</p>
                <FileUpload accept="application/pdf" multiple={false} hint="Signed PDF" onFiles={(f) => setUploadFile(f[0] ?? null)} />
                <Button variant="secondary" type="button" onClick={onUploadSigned} loading={signUpload.isPending} disabled={busy || !uploadFile}>
                  Upload signed file
                </Button>
              </div>
            </details>
          </>
        ) : (
          <Banner tone="danger" title="Declining is final">
            Declining ends this signature request and marks the document <strong>declined</strong>. No one can sign it afterwards. This can’t be undone.
          </Banner>
        )}
      </div>
    </Modal>
  );
}
