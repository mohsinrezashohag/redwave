/**
 * EditableAvatar — a profile photo that can be changed in place (2026-11-12). Hovering (or focusing) shows a
 * pen; on touch screens a small pen badge stays visible. Clicking opens the file picker (JPG/PNG), then the
 * PhotoEditorDialog to crop / zoom / rotate. What happens with the edited file is the caller's: upload it
 * straight away, or hold it as a preview until a form is saved. Tokens only.
 */
import { useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Avatar, type AvatarProps } from './Avatar';
import { PhotoEditorDialog, type PhotoEditResult } from './PhotoEditorDialog';
import { useToast } from './useToast';
import { cx } from './cx';
import styles from './EditableAvatar.module.css';

export interface EditableAvatarProps {
  name: string;
  src: string | null | undefined;
  size?: AvatarProps['size'];
  /** Called with the edited (cropped) photo. Return a promise to keep the dialog busy while it saves; a
   *  rejected promise keeps the dialog open so the user can try again (the caller shows the error). */
  onChange: (result: PhotoEditResult) => void | Promise<void>;
  /** The dialog's confirm button ("Save photo" when it uploads straight away). */
  saveLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function EditableAvatar({ name, src, size = 'xl', onChange, saveLabel = 'Apply', disabled = false, className }: EditableAvatarProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const [source, setSource] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const pick = (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      toast({ title: 'A photo must be a JPG or PNG image', tone: 'warning' });
      return;
    }
    setSource(file);
  };

  const save = async (result: PhotoEditResult) => {
    setSaving(true);
    try {
      await onChange(result);
      setSource(null);
    } catch {
      // Reported by the caller; the dialog stays open for a retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <span className={cx(styles.wrap, className)}>
        <Avatar name={name} src={src} size={size} />
        {!disabled && (
          <button type="button" className={styles.edit} aria-label="Change photo" onClick={() => input.current?.click()}>
            <Pencil size={16} aria-hidden />
          </button>
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </span>
      <PhotoEditorDialog
        source={source}
        saving={saving}
        saveLabel={saveLabel}
        onCancel={() => setSource(null)}
        onSave={(r) => void save(r)}
      />
    </>
  );
}
