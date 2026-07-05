/**
 * ShowcasePage — the foundation's visual verification artifact. Renders the design tokens + every core
 * component, with the in-flow components shown side-by-side in BOTH themes (ThemePanels) and the
 * portaled/interactive components below (they follow the global top-bar theme toggle). No feature
 * screens — this proves the design system renders correctly in light and dark. — design-system §6/§7
 */
import { Plus } from 'lucide-react';
import { Banner, Button, PageHeader } from '../components/ui';
import { Interactive } from './Interactive';
import { ShowcaseSection } from './ShowcaseSection';
import { StaticGallery } from './StaticGallery';
import { ThemePanels } from './ThemePanels';
import styles from './Showcase.module.css';

export default function ShowcasePage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="Component Showcase"
        subtitle="Design tokens + the core component library, in light and dark. The foundation every screen is built from."
        actions={<Button variant="primary" leftIcon={<Plus size={16} />}>Primary action</Button>}
      />

      <Banner tone="info" title="How to read this">
        The two panels below render the same components in the light and dark token sets at once. Use the
        Light / Dark / System toggle in the top-bar user menu to switch the whole app (including the
        overlays at the bottom) instantly.
      </Banner>

      <ShowcaseSection
        title="Light &amp; dark — co-equal"
        description="Same components, swapped token values, zero component changes (design-system §3.5)."
      >
        <ThemePanels>
          <StaticGallery />
        </ThemePanels>
      </ShowcaseSection>

      <ShowcaseSection
        title="Interactive &amp; overlays"
        description="Modals, drawers, selects, menus, toasts and tooltips portal to the document root, so they follow the global theme — toggle the top bar to see them in both."
      >
        <Interactive />
      </ShowcaseSection>
    </div>
  );
}
