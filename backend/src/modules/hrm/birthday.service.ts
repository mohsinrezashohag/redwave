/**
 * BirthdayService — rep birthdays. — client meeting 2026-11-16 ("Birthday scheduling")
 *
 *   - Daily at 08:00 America/Winnipeg (@nestjs/schedule, like the document purge), every ACTIVE rep whose
 *     birthday is today (Winnipeg calendar; Feb 29 → Feb 28 in a non-leap year) is announced in-app to the
 *     Super Admins, the Admins and the rep's field manager, via NotificationsService (event 'birthday',
 *     variables rep_name + rep_code). Best-effort: a failure is logged, never thrown.
 *   - Idempotent: a rep who already has a 'birthday' notification from the last 7 days is skipped, so a
 *     restart, a second instance or a catch-up run never announces the same birthday twice.
 *   - `upcoming(days)` lists the birthdays in the next N days for the dashboard card (hrm:view).
 *
 * PII: only the month and day of the DOB leave this service (`birthday` 'MM-DD' + the upcoming date in the
 * CURRENT/next year). The birth year and the age are never returned or written into a notification.
 * Owns no table; reads reps, writes notifications through NotificationsService.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AvatarService } from '../../common/avatar/avatar.service';
import { BUILTIN_ROLES } from '../../common/rbac/rbac.constants';
import { todayInWinnipeg, WINNIPEG_TZ } from '../../common/timezone';
import { NotificationsService } from '../reporting/notifications.service';
import { birthdayLabel, isBirthdayToday, nextBirthday } from './birthday.logic';
import { compareRepCodes } from './rep-code.logic';

export const BIRTHDAY_EVENT = 'birthday';
/** A birthday is announced at most once in this window (a year apart in practice; 7 days is ample). */
const DEDUPE_WINDOW_MS = 7 * 86_400_000;
export const MAX_UPCOMING_DAYS = 366;

export interface UpcomingBirthday {
  rep_id: string;
  rep_code: string;
  full_name: string;
  /** 'MM-DD' — never the year. */
  birthday: string;
  /** The coming occurrence ('YYYY-MM-DD', this year or next — not the birth year). */
  next_date: string;
  /** 0 = today. */
  days_until: number;
  photo_url: string | null;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The hour of `now` on the Winnipeg clock (0–23). */
function winnipegHour(now: Date): number {
  const h = new Intl.DateTimeFormat('en-CA', { timeZone: WINNIPEG_TZ, hour: '2-digit', hourCycle: 'h23' }).format(now);
  return Number(h);
}

@Injectable()
export class BirthdayService {
  private readonly logger = new Logger(BirthdayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly avatars: AvatarService,
  ) {}

  /** The daily 08:00 run. Never throws. */
  @Cron('0 8 * * *', { name: 'rep-birthdays', timeZone: 'America/Winnipeg' })
  async runScheduled(): Promise<void> {
    try {
      const n = await this.notifyToday(new Date());
      if (n > 0) this.logger.log(`Birthdays: ${n} rep(s) announced`);
    } catch (err) {
      this.logger.error(`Birthday run failed: ${(err as Error).message}`);
    }
  }

  /**
   * For a catch-up call after the server wakes (an instance that slept through 08:00): runs only from 08:00
   * Winnipeg on, so nobody is told before the usual time. Safe to call any number of times (idempotent).
   */
  async runCatchUp(now: Date = new Date()): Promise<void> {
    if (winnipegHour(now) >= 8) await this.runScheduled();
  }

  /** Announce today's birthdays; returns how many reps were announced (skipping already-announced ones). */
  async notifyToday(now: Date): Promise<number> {
    const today = todayInWinnipeg(now);
    const reps = await this.prisma.rep.findMany({
      where: { status: 'active', date_of_birth: { not: null } },
      select: { id: true, rep_code: true, full_name: true, date_of_birth: true, field_manager_id: true },
    });
    const due = reps.filter((r) => r.date_of_birth && isBirthdayToday(isoDay(r.date_of_birth), today));
    if (due.length === 0) return 0;

    const already = await this.prisma.notification.findMany({
      where: {
        type: BIRTHDAY_EVENT,
        related_entity_type: 'reps',
        related_entity_id: { in: due.map((r) => r.id) },
        created_at: { gte: new Date(now.getTime() - DEDUPE_WINDOW_MS) },
      },
      select: { related_entity_id: true },
    });
    const announced = new Set(already.map((n) => n.related_entity_id));
    const pending = due.filter((r) => !announced.has(r.id));
    if (pending.length === 0) return 0;

    const admins = await this.prisma.user.findMany({
      where: {
        status: 'active',
        user_roles: { some: { role: { name: { in: [BUILTIN_ROLES.SUPER_ADMIN, BUILTIN_ROLES.ADMIN] } } } },
      },
      select: { id: true },
    });
    const adminIds = admins.map((u) => u.id);
    for (const rep of pending) {
      await this.notifications.notifyMany(BIRTHDAY_EVENT, [...adminIds, rep.field_manager_id], {
        title: `Birthday today: ${rep.full_name}`,
        body: `${rep.full_name} (${rep.rep_code}) has a birthday today.`,
        relatedEntityType: 'reps',
        relatedEntityId: rep.id,
        variables: { rep_name: rep.full_name, rep_code: rep.rep_code },
      });
    }
    return pending.length;
  }

  /** Active reps with a birthday in the next `days` days (0 = today only), soonest first. */
  async upcoming(days: number, now: Date = new Date()): Promise<UpcomingBirthday[]> {
    const window = Math.min(Math.max(Math.trunc(days) || 0, 0), MAX_UPCOMING_DAYS);
    const today = todayInWinnipeg(now);
    const reps = await this.prisma.rep.findMany({
      where: { status: 'active', date_of_birth: { not: null } },
      select: { id: true, rep_code: true, full_name: true, date_of_birth: true },
    });
    const rows = reps
      .map((r) => {
        const dob = isoDay(r.date_of_birth!);
        const next = nextBirthday(dob, today);
        const label = birthdayLabel(dob);
        return next && label && next.daysUntil <= window
          ? { rep_id: r.id, rep_code: r.rep_code, full_name: r.full_name, birthday: label, next_date: next.date, days_until: next.daysUntil }
          : null;
      })
      .filter((r): r is Omit<UpcomingBirthday, 'photo_url'> => r !== null)
      .sort((a, b) => a.days_until - b.days_until || compareRepCodes(a.rep_code, b.rep_code));
    return this.avatars.withRepPhotos(rows, (r) => r.rep_id);
  }
}
