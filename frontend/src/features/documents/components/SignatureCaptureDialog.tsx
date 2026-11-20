/**
 * SignatureCaptureDialog — "Adopt your signature" for the signing page. Pick a saved signature (with a
 * preview), draw one, or type your name. The adopted signature is what the server stamps onto EVERY
 * signature/initial box of this signer (one image per signer, per the sign endpoint), so it is chosen once
 * and then applied box by box. Nothing is sent here: the page submits on "Sign and submit". — SRS DOC-003/004
 */
import { PenLine } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, FormField, Input, Modal, ModalClose, SegmentedControl, SignaturePad, type SignaturePadHandle } from '../../../components/ui';
import { typedSignatureDataUrl } from '../../../lib/signature';
import { useSignatureImageUrl, useSignatures, type UserSignature } from '../../account/api/useSignatures';
import { cx } from '../../../components/ui/cx';
import styles from './signing.module.css';

/** What the page sends with the sign call, plus an image to preview in the boxes. */
export interface AdoptedSignature {
  signature_id?: string;
  signature_image?: string;
  method: 'saved' | 'drawn' | 'typed';
  previewUrl: string | null;
}

type Source = 'saved' | 'draw' | 'type';

function SavedOption({ sig, selected, onSelect }: { sig: UserSignature; selected: boolean; onSelect: (url: string | null) => void }) {
  const img = useSignatureImageUrl(sig.id);
  return (
    <button
      type="button"
      className={cx(styles.savedOption, selected && styles.savedSelected)}
      aria-pressed={selected}
      onClick={() => onSelect(img.data?.url ?? null)}
    >
      <span className={styles.savedImage} data-theme="light">
        {img.data?.url ? <img src={img.data.url} alt="" /> : <span className={styles.muted}>Preview unavailable</span>}
      </span>
      <span className={styles.savedLabel}>
        {sig.label}
        {sig.is_default ? ' (default)' : ''}
      </span>
    </button>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  onAdopt: (sig: AdoptedSignature) => void;
}

export function SignatureCaptureDialog({ open, onClose, onAdopt }: Props) {
  const saved = useSignatures();
  const savedList = saved.data ?? [];
  const [source, setSource] = useState<Source>('saved');
  const [savedId, setSavedId] = useState('');
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [typedName, setTypedName] = useState('');
  const [padEmpty, setPadEmpty] = useState(true);
  const padRef = useRef<SignaturePadHandle>(null);

  const effective: Source = savedList.length === 0 && source === 'saved' ? 'draw' : source;
  const chosenSavedId = savedId || savedList.find((s) => s.is_default)?.id || savedList[0]?.id || '';
  const defaultImg = useSignatureImageUrl(!savedId && chosenSavedId ? chosenSavedId : undefined);

  const ready = effective === 'saved' ? !!chosenSavedId : effective === 'draw' ? !padEmpty : !!typedName.trim();

  const adopt = () => {
    if (effective === 'saved') {
      if (!chosenSavedId) return;
      onAdopt({ signature_id: chosenSavedId, method: 'saved', previewUrl: savedId ? savedUrl : defaultImg.data?.url ?? null });
    } else if (effective === 'draw') {
      const url = padRef.current?.toDataUrl();
      if (!url) return;
      onAdopt({ signature_image: url, method: 'drawn', previewUrl: url });
    } else {
      const url = typedSignatureDataUrl(typedName.trim());
      if (!url) return;
      onAdopt({ signature_image: url, method: 'typed', previewUrl: url });
    }
    setPadEmpty(true);
  };

  const options = [
    ...(savedList.length ? [{ value: 'saved' as const, label: 'Saved' }] : []),
    { value: 'draw' as const, label: 'Draw' },
    { value: 'type' as const, label: 'Type' },
  ];

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Adopt your signature"
      description="It is applied to each signature and initials box you click. You can change it before you submit."
      size="lg"
      footer={
        <>
          <ModalClose asChild>
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </ModalClose>
          <Button leftIcon={<PenLine size={16} />} variant="primary" type="button" onClick={adopt} disabled={!ready}>
            Adopt and apply
          </Button>
        </>
      }
    >
      <div className={styles.capture}>
        <SegmentedControl options={options} value={effective} onChange={setSource} ariaLabel="Signature source" />

        {effective === 'saved' && (
          <div className={styles.savedGrid}>
            {savedList.map((s) => (
              <SavedOption
                key={s.id}
                sig={s}
                selected={s.id === chosenSavedId}
                onSelect={(url) => {
                  setSavedId(s.id);
                  setSavedUrl(url);
                }}
              />
            ))}
          </div>
        )}

        {effective === 'draw' && (
          <FormField label="Draw your signature" help="Use your finger, a stylus or the mouse.">
            <SignaturePad ref={padRef} onChange={setPadEmpty} />
            <button type="button" className={styles.linkBtn} onClick={() => padRef.current?.clear()}>
              Clear
            </button>
          </FormField>
        )}

        {effective === 'type' && (
          <>
            <FormField label="Type your full name">
              <Input value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Your full name" maxLength={60} autoComplete="name" />
            </FormField>
            {typedName.trim() && (
              <div className={styles.typedPreview} data-theme="light">
                <img src={typedSignatureDataUrl(typedName.trim())} alt={`Signature preview: ${typedName.trim()}`} />
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
