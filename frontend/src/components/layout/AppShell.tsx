/**
 * AppShell — design-system §5.2/§6.6/§8. The structural frame every screen lives in: navy sidebar + top
 * bar + scrollable content region + minimal footer, with a skip-to-content link (§9). Responsive:
 *   • desktop (>1024px)  full sidebar, user-collapsible via the top-bar toggle;
 *   • tablet (640–1024)  sidebar forced to the icon rail;
 *   • mobile (<640px)    sidebar hidden; the hamburger opens it as an off-canvas drawer (Radix Dialog —
 *                        focus trap + Esc + scrim for free), auto-closing on navigation.
 * Routed pages render into the <Outlet />. Tokens only.
 */
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import * as RDialog from '@radix-ui/react-dialog';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Footer } from './Footer';
import { useIsMobile, useIsTablet } from '../../lib/useMediaQuery';
import styles from './AppShell.module.css';

export function AppShell() {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const [collapsed, setCollapsed] = useState(false); // desktop manual collapse
  const [mobileOpen, setMobileOpen] = useState(false); // mobile off-canvas drawer
  const location = useLocation();

  // Close the mobile nav whenever the route changes (Radix Dialog won't auto-close on a NavLink click).
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  // Tablet forces the icon rail; desktop honours the user's toggle. (On mobile the drawer shows full labels.)
  const sidebarCollapsed = isTablet ? true : collapsed;
  const onToggleSidebar = () => (isMobile ? setMobileOpen((o) => !o) : setCollapsed((c) => !c));

  return (
    <div className={styles.shell}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      {isMobile ? (
        <RDialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <RDialog.Portal>
            <RDialog.Overlay className={styles.navScrim} />
            <RDialog.Content className={styles.navSheet} aria-describedby={undefined}>
              <RDialog.Title className="sr-only">Navigation</RDialog.Title>
              <Sidebar collapsed={false} />
            </RDialog.Content>
          </RDialog.Portal>
        </RDialog.Root>
      ) : (
        <Sidebar collapsed={sidebarCollapsed} />
      )}

      <div className={styles.body}>
        <TopBar onToggleSidebar={onToggleSidebar} isMobile={isMobile} />
        <main id="main-content" className={styles.content}>
          <div className={styles.inner}>
            <Outlet />
          </div>
        </main>
        <Footer />
      </div>
    </div>
  );
}
