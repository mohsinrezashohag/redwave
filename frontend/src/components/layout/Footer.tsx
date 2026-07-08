/**
 * Footer — design-system §6.6. Minimal app footer: version, environment, support link. Not a
 * marketing footer. Tokens only.
 */
import styles from './Footer.module.css';

export function Footer() {
  const env = (import.meta.env.VITE_ENV as string | undefined) ?? import.meta.env.MODE;
  return (
    <footer className={styles.footer}>
      <span>Redwave ERP / HRM</span>
      <span className={styles.sep}>·</span>
      <span className="mono">v0.1.0</span>
      <span className={styles.sep}>·</span>
      <span>{env}</span>
      <span className={styles.sep}>·</span>
      {/* Build commit — lets you confirm at a glance which build a deploy is actually serving. */}
      <span className="mono" title="build commit">{__BUILD_SHA__}</span>
      <a className={styles.support} href="mailto:support@redwave.local">
        Support
      </a>
    </footer>
  );
}
