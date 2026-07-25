/**
 * IssueGroupsBanner — the blocking problems in an import, collapsed to one entry per DISTINCT issue.
 *
 * A 16-row file where every row hits the same unknown product type is ONE thing to fix; listing it 16 times
 * buries the signal and makes a small file look catastrophic. The server groups them (`group-issues.logic`)
 * and gives each group a count, example row numbers, and a message that names the FIX. Follows the same
 * structured-error pattern as `UnpricedBanner` / `MissingKmRateBanner`. Tokens only.
 */
import { Banner } from '../../../components/ui';
import styles from './import.module.css';
import type { ImportIssueGroup } from '../import.types';

export function IssueGroupsBanner({ groups, blocking = true }: { groups: ImportIssueGroup[]; blocking?: boolean }) {
  if (groups.length === 0) return null;
  const total = groups.reduce((sum, g) => sum + g.count, 0);

  return (
    <Banner
      tone={blocking ? 'danger' : 'warning'}
      title={`${total} row${total === 1 ? '' : 's'} need attention — ${groups.length} distinct issue${groups.length === 1 ? '' : 's'}`}
    >
      {blocking
        ? 'Every row must be matched or ignored before this batch can be committed. Fix the source file and re-upload, or resolve the rows below.'
        : 'These rows will be skipped unless you resolve them.'}
      <ul className={styles.issueGroupList}>
        {groups.map((group, i) => (
          <li key={`${group.match_status}-${i}`}>
            <strong>{group.count}×</strong> {group.sample_issue}{' '}
            <span className={styles.issueRows}>
              (row{group.row_numbers.length === 1 ? '' : 's'} {group.row_numbers.join(', ')}
              {group.count > group.row_numbers.length ? ', …' : ''})
            </span>
          </li>
        ))}
      </ul>
    </Banner>
  );
}
