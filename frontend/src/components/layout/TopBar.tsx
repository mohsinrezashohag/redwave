/**
 * TopBar — design-system §6.6. Collapse toggle, global search, current pay-cycle indicator,
 * notifications bell, environment badge, and the user menu (real signed-in user + the Light/Dark/System
 * theme toggle + Sign out). Search / pay-cycle / notifications are PLACEHOLDERS this session. Tokens only.
 */
import { Menu, PanelLeft, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IconButton } from '../ui/IconButton';
import { Popover } from '../ui/Popover';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { useAuth } from '../../auth/useAuth';
import { NotificationsBell } from '../../features/notifications/NotificationsBell';
import { EnvironmentBadge } from './EnvironmentBadge';
import styles from './TopBar.module.css';

const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?';

export function TopBar({ onToggleSidebar, isMobile = false }: { onToggleSidebar: () => void; isMobile?: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <IconButton
          label={isMobile ? 'Open menu' : 'Toggle sidebar'}
          icon={isMobile ? <Menu size={18} /> : <PanelLeft size={18} />}
          onClick={onToggleSidebar}
        />
        <div className={styles.search}>
          <Search size={16} className={styles.searchIcon} aria-hidden />
          <input className={styles.searchInput} type="search" placeholder="Search…" aria-label="Search" />
        </div>
      </div>

      <div className={styles.right}>
        <span className={styles.cycle} title="Current pay cycle">
          <span className={styles.cycleDot} aria-hidden />
          Cycle 11 · Jun 2026
        </span>
        <EnvironmentBadge />
        <NotificationsBell />
        <Popover
          align="end"
          trigger={
            <button type="button" className={styles.user} aria-label="User menu">
              <span className={styles.avatar} aria-hidden>
                {user ? initials(user.full_name) : '?'}
              </span>
            </button>
          }
        >
          <div className={styles.menu}>
            <div className={styles.menuUser}>
              <p className={styles.menuName}>{user?.full_name ?? 'Account'}</p>
              <p className={styles.menuEmail}>{user?.email}</p>
            </div>
            <div className={styles.menuRow}>
              <span className={styles.menuLabel}>Theme</span>
              <ThemeToggle />
            </div>
            <div className={styles.menuLinks}>
              <button type="button" className={styles.menuLink} onClick={() => navigate('/account')}>
                My Account
              </button>
              <button type="button" className={styles.menuLink} onClick={() => void logout()}>
                Sign out
              </button>
            </div>
          </div>
        </Popover>
      </div>
    </header>
  );
}
