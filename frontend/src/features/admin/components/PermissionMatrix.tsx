/**
 * PermissionMatrix — the role builder's module × action grid (SRS AUTH-004). Rows = modules, columns =
 * the 6 actions, cells = a Checkbox per existing (module, action) permission (looked up by id). Not every
 * module has every action → an empty cell where no permission exists. Row + column headers carry a
 * "select all" checkbox (indeterminate when partial). Permissions whose action is NOT one of the 6 grid
 * columns (the off-grid `reports:business` / `notifications:broadcast`) have no cell, so they're rendered
 * as their own controllable checkboxes in an "Additional permissions" section below the grid. The selected
 * set is owned by the parent; this component computes the next set and calls onChange. `readOnly` disables
 * every control. Tokens only.
 */
import { Checkbox } from '../../../components/ui';
import { PERMISSION_ACTIONS, type Module, type Permission } from '../roles.types';
import styles from './PermissionMatrix.module.css';

export interface PermissionMatrixProps {
  modules: Module[];
  permissions: Permission[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  readOnly?: boolean;
}

type TriState = boolean | 'indeterminate';
const triState = (ids: string[], selected: Set<string>): TriState => {
  if (ids.length === 0) return false;
  const on = ids.filter((id) => selected.has(id)).length;
  return on === 0 ? false : on === ids.length ? true : 'indeterminate';
};

// The 6 grid actions as a fast lookup (an action outside this set is "off-grid" — no matrix column).
const GRID_ACTIONS = new Set<string>(PERMISSION_ACTIONS);
// Friendly labels for the known off-grid permissions; anything else falls back to its `key`.
const OFF_GRID_LABELS: Record<string, string> = {
  'reports:business': 'Business dashboard & cross-period trends',
  'notifications:broadcast': 'Send manual broadcast',
};

export function PermissionMatrix({ modules, permissions, selected, onChange, readOnly }: PermissionMatrixProps) {
  // index: module_key → action → permission
  const byModule = new Map<string, Map<string, Permission>>();
  for (const p of permissions) {
    if (!byModule.has(p.module_key)) byModule.set(p.module_key, new Map());
    byModule.get(p.module_key)!.set(p.action, p);
  }
  const sortedModules = [...modules].sort((a, b) => a.name.localeCompare(b.name));
  // Off-grid permissions (action ∉ the 6 columns) — rendered as their own section, not swept by row select-all.
  const offGrid = permissions
    .filter((p) => !GRID_ACTIONS.has(p.action))
    .sort((a, b) => a.key.localeCompare(b.key));

  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };
  // Row "select all" covers only GRID cells — the off-grid perms have their own controls below, so a module
  // row toggle no longer secretly sweeps them (which previously left the row stuck "indeterminate").
  const idsForModule = (key: string) =>
    [...(byModule.get(key)?.values() ?? [])].filter((p) => GRID_ACTIONS.has(p.action)).map((p) => p.id);
  const idsForAction = (action: string) => permissions.filter((p) => p.action === action).map((p) => p.id);

  return (
    <>
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr className={styles.theadRow}>
            <th className={styles.rowHead}>Module</th>
            {PERMISSION_ACTIONS.map((action) => {
              const ids = idsForAction(action);
              const state = triState(ids, selected);
              return (
                <th key={action} className={styles.colHead}>
                  <span className={styles.colHeadInner}>
                    {action}
                    <Checkbox
                      aria-label={`All ${action}`}
                      checked={state}
                      disabled={readOnly}
                      onCheckedChange={(c) => setMany(ids, c === true)}
                    />
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedModules.map((m) => {
            const rowIds = idsForModule(m.key);
            const rowState = triState(rowIds, selected);
            return (
              <tr key={m.id} className={styles.tr}>
                <th className={styles.rowHead} scope="row">
                  <span className={styles.moduleCell}>
                    <Checkbox
                      aria-label={`All ${m.name}`}
                      checked={rowState}
                      disabled={readOnly || rowIds.length === 0}
                      onCheckedChange={(c) => setMany(rowIds, c === true)}
                    />
                    <span className={styles.moduleName}>{m.name}</span>
                  </span>
                </th>
                {PERMISSION_ACTIONS.map((action) => {
                  const perm = byModule.get(m.key)?.get(action);
                  return (
                    <td key={action}>
                      {perm ? (
                        <Checkbox
                          aria-label={perm.key}
                          checked={selected.has(perm.id)}
                          disabled={readOnly}
                          onCheckedChange={(c) => setMany([perm.id], c === true)}
                        />
                      ) : (
                        <span className={styles.empty} aria-hidden>
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

      {offGrid.length > 0 && (
        <div className={styles.extras}>
          <p className={styles.extrasTitle}>Additional permissions</p>
          <ul className={styles.extrasList}>
            {offGrid.map((p) => (
              <li key={p.id} className={styles.extrasItem}>
                <Checkbox
                  aria-label={p.key}
                  checked={selected.has(p.id)}
                  disabled={readOnly}
                  onCheckedChange={(c) => setMany([p.id], c === true)}
                />
                <span className={styles.extrasLabel}>
                  {OFF_GRID_LABELS[p.key] ?? p.key}
                  <code className={`${styles.extrasKey} mono`}>{p.key}</code>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
