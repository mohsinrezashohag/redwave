/**
 * RowActions — the per-row action cell for `DataTable`, design-system §6.5.
 *
 * A kebab menu costs two clicks and hides what a row can do. Most of these tables are wide with an
 * ACTIONS column of pure slack, so when a row has only a FEW actions they are shown as real buttons and
 * the menu disappears. When a row has many (Users: edit / reset password / force log out / disable MFA /
 * deactivate) they stay behind the kebab — a wall of buttons per row is worse than a menu, and the column
 * would blow the table's layout.
 *
 * The decision is made at RUNTIME from the actual item count, not per-table, so a menu that grows past the
 * threshold collapses back to the kebab on its own instead of quietly overflowing.
 *
 * Below the desktop breakpoint everything reverts to the kebab: horizontal room is the whole premise, and
 * on tablet/mobile there isn't any. Callers pass the SAME `MenuEntry[]` they already build for
 * `DropdownMenu`, so adopting this is a one-line change and no action list is duplicated.
 *
 * `iconOnly` (2026-11-12): the inline actions render as labelled icon buttons (native tooltip + aria-label)
 * instead of text buttons. Icons are narrow, so up to FOUR fit without driving the column; every action
 * must then carry an `icon`. Used where a row has a short, familiar set (rep documents: open / edit / replace
 * / delete).
 */
import { DropdownMenu, IconButton, Button, type MenuAction, type MenuEntry } from '../ui';
import { MoreHorizontal } from 'lucide-react';
import { useIsMobile, useIsTablet } from '../../lib/useMediaQuery';
import styles from './RowActions.module.css';

export interface RowActionsProps {
  /** The row's actions — identical to what `DropdownMenu` takes. Separators are ignored when inline. */
  items: MenuEntry[];
  /** Accessible label for the overflow trigger (e.g. "Client actions"). */
  label: string;
  /**
   * How many actions may render as buttons before falling back to the kebab.
   *
   * TWO is the default on purpose. Two short buttons fit any of these tables without argument; three is a
   * per-table judgement call — it crowds the ones that already carry many columns (Sales, Import rows). A
   * table with a genuinely empty actions column can opt into 3, but never more: past that the column
   * starts driving the table's layout, which is the thing the kebab exists to prevent.
   */
  maxInline?: number;
  /** Render the inline actions as icon buttons (each item needs an `icon`); allows up to 4 inline. */
  iconOnly?: boolean;
}

const DEFAULT_MAX_INLINE = 2;
const ICON_MAX_INLINE = 4;

export function RowActions({ items, label, maxInline, iconOnly = false }: RowActionsProps) {
  // Hooks run unconditionally (rules of hooks) — the result only decides which branch renders.
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();

  const actions = items.filter((item): item is MenuAction => item !== 'separator');
  const hasRoom = !isMobile && !isTablet;
  const limit = maxInline ?? (iconOnly ? ICON_MAX_INLINE : DEFAULT_MAX_INLINE);
  const iconsReady = !iconOnly || actions.every((a) => a.icon);
  const inline = hasRoom && iconsReady && actions.length > 0 && actions.length <= limit;

  if (!inline) {
    return <DropdownMenu trigger={<IconButton label={label} icon={<MoreHorizontal size={16} />} size="sm" />} items={items} />;
  }

  if (iconOnly) {
    return (
      <div className={styles.inline}>
        {actions.map((action) => (
          <IconButton
            key={action.label}
            label={action.label}
            icon={action.icon}
            size="sm"
            disabled={action.disabled}
            onClick={action.onSelect}
            className={action.danger ? styles.danger : undefined}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={styles.inline}>
      {actions.map((action) => (
        <Button
          key={action.label}
          // A destructive action keeps its danger styling inline — the confirm dialog is still the guard.
          variant={action.danger ? 'destructive' : 'tertiary'}
          size="sm"
          disabled={action.disabled}
          leftIcon={action.icon}
          onClick={action.onSelect}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
