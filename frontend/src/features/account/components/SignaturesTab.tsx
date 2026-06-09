/**
 * SignaturesTab — manage your OWN reusable signatures (Account → Signatures). Create by drawing, typing,
 * or uploading an image; set a default; delete. Own-scoped (no permission gate — the server own-scopes
 * every call). The default is applied first when signing. — SRS §13 (saved signature)
 */
import { useRef, useState } from 'react';
import { Check, Star, Trash2 } from 'lucide-react';
import {
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  FileUpload,
  FormField,
  Input,
  LoadingSpinner,
  Select,
  SignaturePad,
  useToast,
  type SignaturePadHandle,
} from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import {
  useCreateSignature,
  useDeleteSignature,
  useSetDefaultSignature,
  useSignatureImageUrl,
  useSignatures,
  type SignatureMethod,
  type UserSignature,
} from '../api/useSignatures';
import { dataUrlToFile, typedSignatureDataUrl } from './signatureImage';
import styles from './signatures.module.css';

const METHODS = [
  { value: 'drawn', label: 'Draw' },
  { value: 'typed', label: 'Type' },
  { value: 'uploaded', label: 'Upload image' },
];

function SignatureThumb({ id }: { id: string }) {
  const q = useSignatureImageUrl(id);
  if (q.isLoading) return <div className={styles.thumb}><LoadingSpinner size="sm" label="" /></div>;
  if (q.isError || !q.data) return <div className={styles.thumb}><span className={styles.thumbNa}>image unavailable</span></div>;
  return <img className={styles.thumbImg} src={q.data.url} alt="Saved signature" />;
}

export function SignaturesTab() {
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const list = useSignatures();
  const create = useCreateSignature();
  const setDefault = useSetDefaultSignature();
  const del = useDeleteSignature();

  const [method, setMethod] = useState<SignatureMethod>('drawn');
  const [label, setLabel] = useState('My signature');
  const [typed, setTyped] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [padEmpty, setPadEmpty] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<UserSignature | null>(null);
  const padRef = useRef<SignaturePadHandle>(null);

  const buildFile = (): File | null => {
    if (method === 'drawn') {
      const url = padRef.current?.toDataUrl();
      return url ? dataUrlToFile(url, 'signature.png') : null;
    }
    if (method === 'typed') {
      return typed.trim() ? dataUrlToFile(typedSignatureDataUrl(typed.trim()), 'signature.png') : null;
    }
    return uploadFile;
  };

  const onSave = () => {
    const file = buildFile();
    if (!file || !label.trim()) return;
    create.mutate(
      { file, label: label.trim(), method },
      {
        onSuccess: () => {
          toast({ title: 'Signature saved', tone: 'success' });
          padRef.current?.clear();
          setTyped('');
          setUploadFile(null);
          setPadEmpty(true);
        },
        onError,
      },
    );
  };

  const canSave =
    !!label.trim() &&
    !create.isPending &&
    (method === 'drawn' ? !padEmpty : method === 'typed' ? !!typed.trim() : !!uploadFile);

  const signatures = list.data ?? [];

  return (
    <div className={styles.wrap}>
      <Card title="Your signatures">
        {list.isLoading ? (
          <LoadingSpinner size="md" label="Loading signatures" />
        ) : signatures.length === 0 ? (
          <Banner tone="info" title="No saved signatures">
            Add a signature below to reuse it when signing documents.
          </Banner>
        ) : (
          <ul className={styles.list}>
            {signatures.map((s) => (
              <li key={s.id} className={styles.item}>
                <SignatureThumb id={s.id} />
                <div className={styles.meta}>
                  <span className={styles.label}>
                    {s.label}
                    {s.is_default && <Badge tone="success" icon={<Star size={12} />}>Default</Badge>}
                  </span>
                  <span className={styles.method}>{s.method}</span>
                </div>
                <div className={styles.actions}>
                  {!s.is_default && (
                    <Button
                      variant="tertiary"
                      size="sm"
                      leftIcon={<Check size={14} />}
                      onClick={() => setDefault.mutate(s.id, { onError })}
                      loading={setDefault.isPending && setDefault.variables === s.id}
                    >
                      Set default
                    </Button>
                  )}
                  <Button variant="tertiary" size="sm" leftIcon={<Trash2 size={14} />} onClick={() => setDeleteTarget(s)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Add a signature">
        <div className={styles.form}>
          <FormField label="How">
            <Select options={METHODS} value={method} onValueChange={(v) => setMethod(v as SignatureMethod)} />
          </FormField>
          {method === 'drawn' && (
            <FormField label="Draw your signature">
              <SignaturePad ref={padRef} onChange={setPadEmpty} />
              <button type="button" className={styles.clear} onClick={() => padRef.current?.clear()}>
                Clear
              </button>
            </FormField>
          )}
          {method === 'typed' && (
            <FormField label="Type your name">
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Jane Q. Doe" maxLength={60} />
            </FormField>
          )}
          {method === 'uploaded' && (
            <FormField label="Upload an image" help="PNG/JPEG/WebP up to 2 MB.">
              <FileUpload accept="image/png,image/jpeg,image/webp" multiple={false} onFiles={(f) => setUploadFile(f[0] ?? null)} />
            </FormField>
          )}
          <FormField label="Label" required>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="My signature" maxLength={60} />
          </FormField>
          <div className={styles.saveRow}>
            <Button variant="primary" onClick={onSave} loading={create.isPending} disabled={!canSave}>
              Save signature
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete signature"
        description={`Delete “${deleteTarget?.label}”? This can't be undone.`}
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() =>
          deleteTarget &&
          del.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast({ title: 'Signature deleted', tone: 'success' });
              setDeleteTarget(null);
            },
            onError: (err) => {
              setDeleteTarget(null);
              onError(err);
            },
          })
        }
      />
    </div>
  );
}
