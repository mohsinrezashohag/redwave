/**
 * AvatarPresetPicker — the Super Admin's profile picture (2026-11-12): one of three built-in avatars, picked
 * with one click and applied at once (the Super Admin's own changes need no review). The images live in
 * `public/avatars/` and are stored as `preset:<name>`; nothing is uploaded. Keyboard: Tab reaches each
 * avatar, Enter or Space picks it. Tokens only.
 */
import { Check } from 'lucide-react';
import { useToast } from '../../../components/ui';
import { useApiErrorToast } from '../../../lib/api/apiError';
import { useRequestProfileChange } from '../api/useAccountMutations';
import { AVATAR_PRESETS, presetFromUrl } from '../avatarPresets';
import styles from './account.module.css';

export function AvatarPresetPicker({ currentUrl }: { currentUrl: string | null }) {
  const req = useRequestProfileChange();
  const { toast } = useToast();
  const onError = useApiErrorToast();
  const current = presetFromUrl(currentUrl);

  const choose = (value: string, label: string) => {
    if (value === current || req.isPending) return;
    req.mutate(
      { avatar_url: value },
      { onSuccess: () => toast({ title: 'Profile picture updated', description: label, tone: 'success' }), onError },
    );
  };

  return (
    <div className={styles.presets} role="radiogroup" aria-label="Profile picture">
      {AVATAR_PRESETS.map((p) => {
        const selected = p.value === current;
        return (
          <button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={p.label}
            title={p.label}
            className={styles.preset}
            data-selected={selected || undefined}
            disabled={req.isPending}
            onClick={() => choose(p.value, p.label)}
          >
            <img src={p.src} alt="" className={styles.presetImg} />
            {selected && (
              <span className={styles.presetCheck} aria-hidden>
                <Check size={14} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
