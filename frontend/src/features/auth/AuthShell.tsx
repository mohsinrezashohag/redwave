/**
 * AuthShell — the centered branded card used by the forgot/reset/set-password screens (matches the login
 * page styling, tokens only, light+dark).
 */
import type { ReactNode } from 'react';
import { Logo } from '../../components/ui';
import styles from '../../pages/login/LoginPage.module.css';

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <main className={styles.card}>
        <div className={styles.brand}>
          <Logo variant="full" size="lg" />
        </div>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        {children}
      </main>
      <footer className={styles.footer}>Redwave ERP / HRM · Internal</footer>
    </div>
  );
}
