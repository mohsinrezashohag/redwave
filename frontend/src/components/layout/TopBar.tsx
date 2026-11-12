/**
 * TopBar — design-system §6.6. Collapse toggle, global search, current pay-cycle indicator,
 * notifications bell, environment badge, and the user menu (real signed-in user + the Light/Dark/System
 * theme toggle + Sign out). The pay-cycle chip is the REAL period containing today (Winnipeg), shown only to payrun:view holders. Tokens only.
 */
import { useState } from 'react';
import { Menu, PanelLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '../ui/Avatar';
import { IconButton } from '../ui/IconButton';
import { Popover } from '../ui/Popover';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { useAuth } from '../../auth/useAuth';
import { NotificationsBell } from '../../features/notifications/NotificationsBell';
import { GlobalSearch } from '../../features/search/components/GlobalSearch';
import { usePayPeriods } from '../../features/payrun/api/usePayRun';
import { cycleLabel, findCurrentPeriod } from '../../features/payrun/currentPeriod';
import { displayDate, todayInWinnipeg } from '../../lib/format/date';
import { EnvironmentBadge } from './EnvironmentBadge';
import styles from './TopBar.module.css';

export function TopBar({ onToggleSidebar, isMobile = false }: { onToggleSidebar: () => void; isMobile?: boolean }) {
  const { user, roles, logout, permissions } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  // Choosing an item closes the menu (it used to stay open over the next page).
  const go = (to: string) => {
    setMenuOpen(false);
    navigate(to);
  };
  // The real current pay period. /v1/pay-periods is payrun:view-gated, so without it the chip is hidden
  // rather than showing a stale or invented cycle.
  const { data: periods } = usePayPeriods(permissions.has('payrun:view'));
  const current = periods ? findCurrentPeriod(periods, todayInWinnipeg()) : null;

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <IconButton
          label={isMobile ? 'Open menu' : 'Toggle sidebar'}
          icon={isMobile ? <Menu size={18} /> : <PanelLeft size={18} />}
          onClick={onToggleSidebar}
        />
        <GlobalSearch />
      </div>

      <div className={styles.right}>
        {current && (
          <span className={styles.cycle} title={`Current pay cycle · payday ${displayDate(current.payday)}`}>
            <span className={styles.cycleDot} aria-hidden />
            {cycleLabel(current)}
          </span>
        )}
        <EnvironmentBadge />
        <NotificationsBell />
        <Popover
          align="end"
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={
            <button type="button" className={styles.user} aria-label="User menu">
              {/* The signed-in user's photo (a rep's = their HR headshot); initials when there is none. */}
              <Avatar name={user?.full_name ?? '?'} src={user?.avatar_url} size="sm" />
            </button>
          }
        >
          <div className={styles.menu}>
            <div className={styles.menuUser}>
              <p className={styles.menuName}>{user?.full_name ?? 'Account'}</p>
              <p className={styles.menuEmail}>{user?.email}</p>
              {roles.length > 0 && <p className={styles.menuEmail}>{roles.join(', ')}</p>}
            </div>
            <div className={styles.menuRow}>
              <span className={styles.menuLabel}>Theme</span>
              <ThemeToggle />
            </div>
            <div className={styles.menuLinks}>
              <button type="button" className={styles.menuLink} onClick={() => go('/account')}>
                My Account
              </button>
              <button
                type="button"
                className={styles.menuLink}
                onClick={() => {
                  setMenuOpen(false);
                  void logout();
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </Popover>
      </div>
    </header>
  );
}
