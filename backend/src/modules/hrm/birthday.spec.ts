/** Birthdays (client meeting 2026-11-16): the pure rules, the daily announcement, the upcoming list. */
import { birthdayInYear, birthdayLabel, isBirthdayToday, nextBirthday } from './birthday.logic';
import { BirthdayService } from './birthday.service';

describe('birthday.logic (pure)', () => {
  it('Feb 29 is celebrated on Feb 28 in a non-leap year, Feb 29 in a leap year', () => {
    expect(birthdayInYear(2, 29, 2026)).toBe('2026-02-28');
    expect(birthdayInYear(2, 29, 2028)).toBe('2028-02-29');
    expect(isBirthdayToday('2000-02-29', '2027-02-28')).toBe(true);
    expect(isBirthdayToday('2000-02-29', '2028-02-28')).toBe(false);
    expect(isBirthdayToday('2000-02-29', '2028-02-29')).toBe(true);
  });

  it('nextBirthday counts days ahead and wraps into next year', () => {
    expect(nextBirthday('1994-11-16', '2026-11-16')).toEqual({ date: '2026-11-16', daysUntil: 0 });
    expect(nextBirthday('1994-11-20', '2026-11-16')).toEqual({ date: '2026-11-20', daysUntil: 4 });
    expect(nextBirthday('1994-01-02', '2026-12-30')).toEqual({ date: '2027-01-02', daysUntil: 3 });
    expect(nextBirthday('nope', '2026-11-16')).toBeNull();
  });

  it('the label is month/day only', () => {
    expect(birthdayLabel('1994-03-21')).toBe('03-21');
  });
});

function make(reps: unknown[], existing: unknown[] = []) {
  const prisma = {
    rep: { findMany: jest.fn().mockResolvedValue(reps) },
    notification: { findMany: jest.fn().mockResolvedValue(existing) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'sa' }, { id: 'admin' }]) },
  };
  const notifications = { notifyMany: jest.fn().mockResolvedValue(undefined) };
  const avatars = { withRepPhotos: async (rows: { rep_id: string }[]) => rows.map((r) => ({ ...r, photo_url: null })) };
  return { service: new BirthdayService(prisma as never, notifications as never, avatars as never), prisma, notifications };
}

const rep = (id: string, dob: string, code = id.toUpperCase()) => ({
  id,
  rep_code: code,
  full_name: `Rep ${id}`,
  date_of_birth: new Date(`${dob}T00:00:00.000Z`),
  field_manager_id: 'mgr',
});

// 2026-11-16 14:00 UTC = 08:00 Winnipeg (CST).
const NOW = new Date('2026-11-16T14:00:00.000Z');

describe('BirthdayService.notifyToday', () => {
  it('announces today’s birthdays to admins + the field manager, with rep_name/rep_code variables', async () => {
    const { service, notifications, prisma } = make([rep('a', '1990-11-16'), rep('b', '1990-11-17')]);
    expect(await service.notifyToday(NOW)).toBe(1);
    expect(prisma.rep.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'active', date_of_birth: { not: null } } }));
    expect(notifications.notifyMany).toHaveBeenCalledTimes(1);
    const [event, users, payload] = notifications.notifyMany.mock.calls[0];
    expect(event).toBe('birthday');
    expect(users).toEqual(['sa', 'admin', 'mgr']);
    expect(payload).toEqual(expect.objectContaining({ relatedEntityType: 'reps', relatedEntityId: 'a', variables: { rep_name: 'Rep a', rep_code: 'A' } }));
    // Never the year or the age.
    expect(JSON.stringify(payload)).not.toMatch(/1990|36/);
  });

  it('is idempotent: a rep already announced in the window is skipped', async () => {
    const { service, notifications } = make([rep('a', '1990-11-16')], [{ related_entity_id: 'a' }]);
    expect(await service.notifyToday(NOW)).toBe(0);
    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('uses the Winnipeg day: 23:30 Winnipeg on Nov 15 (05:30 UTC Nov 16) is still the 15th', async () => {
    const { service, notifications } = make([rep('a', '1990-11-16')]);
    expect(await service.notifyToday(new Date('2026-11-16T05:30:00.000Z'))).toBe(0);
    expect(notifications.notifyMany).not.toHaveBeenCalled();
  });

  it('the scheduled run never throws', async () => {
    const { service, prisma } = make([]);
    prisma.rep.findMany.mockRejectedValue(new Error('db down'));
    await expect(service.runScheduled()).resolves.toBeUndefined();
  });
});

describe('BirthdayService.upcoming', () => {
  it('lists birthdays in the window, soonest first, month/day only', async () => {
    const { service } = make([rep('far', '1980-12-31'), rep('soon', '1992-11-20'), rep('today', '2001-11-16')]);
    const rows = await service.upcoming(30, NOW);
    expect(rows.map((r) => r.rep_id)).toEqual(['today', 'soon']);
    expect(rows[1]).toEqual({
      rep_id: 'soon',
      rep_code: 'SOON',
      full_name: 'Rep soon',
      birthday: '11-20',
      next_date: '2026-11-20',
      days_until: 4,
      photo_url: null,
    });
    expect(JSON.stringify(rows)).not.toMatch(/1992|2001/);
  });
});
