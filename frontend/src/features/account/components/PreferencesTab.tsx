/**
 * PreferencesTab — personal preferences. The Light/Dark/System theme is the deliberate INSTANT exception
 * to the edit-as-request rule (SRS AUTH-010, CLAUDE §3): it applies immediately and persists via
 * PATCH /v1/account/theme. Reuses the already-wired <ThemeToggle/> (useAuth().setTheme). Tokens only.
 */
import { FormField } from '../../../components/ui';
import { ThemeToggle } from '../../../theme/ThemeToggle';
import styles from './account.module.css';

export function PreferencesTab() {
  return (
    <div className={styles.stack}>
      <FormField label="Theme" help="Applies instantly and is saved to your account.">
        <ThemeToggle />
      </FormField>
      <p className={styles.help}>
        Light, Dark, or System (follows your device). Unlike your profile fields, this change is applied
        immediately, with no review.
      </p>
    </div>
  );
}
