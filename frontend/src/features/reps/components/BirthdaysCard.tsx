/**
 * BirthdaysCard — rep birthdays in the coming days, for the admin dashboard (client meeting 2026-11-16,
 * "Birthday scheduling"). Reads GET /v1/reps/birthdays/upcoming (hrm:view, server-enforced): active reps,
 * soonest first, MONTH AND DAY ONLY (the birth year and age never reach the browser). Each rep shows with
 * their photo (PersonName) and links to their profile. Loading / error / empty states via DataState. Tokens
 * only. The admins and the rep's field manager also get an in-app notification on the day (server job).
 */
import { Link } from 'react-router-dom';
import { Cake } from 'lucide-react';
import { Card, PersonName, Skeleton } from '../../../components/ui';
import { DataState } from '../../../components/data/DataState';
import { useCan } from '../../../auth/useCan';
import { useUpcomingBirthdays } from '../api/useReps';
import { birthdayDate, birthdayWhen } from '../birthdays';
import styles from './BirthdaysCard.module.css';

export function BirthdaysCard({ days = 30, className }: { days?: number; className?: string }) {
  const canView = useCan('hrm:view');
  const q = useUpcomingBirthdays(days, canView);
  if (!canView) return null;
  const rows = q.data ?? [];
  return (
    <Card
      className={className}
      title={
        <span className={styles.title}>
          <Cake size={16} aria-hidden="true" /> Birthdays
        </span>
      }
      actions={<span className={styles.window}>Next {days} days</span>}
    >
      <DataState
        isLoading={q.isLoading}
        isError={q.isError}
        isEmpty={rows.length === 0}
        onRetry={() => q.refetch()}
        errorMessage="Couldn’t load birthdays."
        loadingNode={
          <div className={styles.list} aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height="var(--space-8)" />
            ))}
          </div>
        }
        emptyNode={<p className={styles.empty}>No rep birthdays in the next {days} days.</p>}
      >
        <ul className={styles.list}>
          {rows.map((b) => (
            <li key={b.rep_id} className={styles.row}>
              <PersonName
                name={b.full_name}
                photoUrl={b.photo_url}
                detail={<span className="mono">{b.rep_code}</span>}
                renderName={(name) => (
                  <Link to={`/admin/reps/${b.rep_id}`} className={styles.link}>
                    {name}
                  </Link>
                )}
              />
              <span className={styles.when}>
                <span className={b.days_until === 0 ? styles.today : styles.relative}>{birthdayWhen(b.days_until)}</span>
                <span className={styles.date}>{birthdayDate(b.next_date)}</span>
              </span>
            </li>
          ))}
        </ul>
      </DataState>
    </Card>
  );
}
