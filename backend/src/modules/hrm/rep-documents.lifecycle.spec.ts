/**
 * Rep documents: edit, replace, Recently deleted (30 days) and the purge (2026-11-12).
 * A deleted document is invisible to every live read, restorable for 30 days, then removed for good: the stored
 * object FIRST, the row only after; a refused object keeps its row for the next run.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RepDocumentsService } from './rep-documents.service';
import { RepDocumentPurgeService } from './rep-document-purge.service';
import { DELETED_RETENTION_DAYS, isRestorable, purgeCutoff, purgeDueDate } from './rep-documents.logic';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-12T12:00:00.000Z');

describe('retention window', () => {
  it('is 30 days, and restore stops exactly when the purge becomes due', () => {
    expect(DELETED_RETENTION_DAYS).toBe(30);
    const deleted = new Date('2026-10-01T10:00:00.000Z');
    expect(purgeDueDate(deleted).toISOString()).toBe('2026-10-31T10:00:00.000Z');
    expect(isRestorable(deleted, new Date('2026-10-31T09:59:59.000Z'))).toBe(true);
    expect(isRestorable(deleted, new Date('2026-10-31T10:00:00.000Z'))).toBe(false);
    expect(purgeCutoff(NOW).getTime()).toBe(NOW.getTime() - 30 * DAY);
  });
});

describe('RepDocumentsService — edit / replace / delete / restore', () => {
  const make = () => {
    const prisma = {
      rep: { findUnique: jest.fn().mockResolvedValue({ id: 'r1', full_name: 'Riley Rivera' }) },
      repDocument: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'new', ...data })),
        update: jest.fn().mockImplementation(({ where, data }) => ({ id: where.id, ...data })),
      },
      $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const storage = { upload: jest.fn().mockResolvedValue({ path: 'rep-docs/2026/new-pass.pdf', stored: true }) };
    const service = new RepDocumentsService(prisma as never, audit as never, storage as never, {} as never);
    return { service, prisma, audit, storage };
  };
  const passport = {
    id: 'd1',
    rep_id: 'r1',
    doc_type: 'passport',
    file_url: 'rep-docs/2026/old-pass.pdf',
    issued_on: new Date('2020-01-01T00:00:00Z'),
    expires_on: new Date('2030-01-01T00:00:00Z'),
    deleted_at: null,
  };

  it('every live read filters out deleted documents', async () => {
    const { service, prisma } = make();
    await service.list('r1', { permissions: new Set() } as never);
    expect(prisma.repDocument.findMany.mock.calls[0][0].where).toEqual({ rep_id: 'r1', deleted_at: null });
    prisma.repDocument.findFirst.mockResolvedValue(null);
    await expect(service.fileUrl('r1', 'd1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.repDocument.findFirst.mock.calls[0][0].where).toEqual({ id: 'd1', rep_id: 'r1', deleted_at: null });
    await expect(service.update('r1', 'd1', {}, 'hr1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('r1', 'd1', 'hr1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('edits the type; a type without dates clears them, and a PDF cannot become the headshot', async () => {
    const { service, prisma } = make();
    prisma.repDocument.findFirst.mockResolvedValue(passport);
    await service.update('r1', 'd1', { doc_type: 'contract' }, 'hr1');
    expect(prisma.repDocument.update.mock.calls[0][0].data).toEqual({ doc_type: 'contract', issued_on: null, expires_on: null });
    await expect(service.update('r1', 'd1', { doc_type: 'headshot' }, 'hr1')).rejects.toThrow(/JPG or PNG/);
    await expect(service.update('r1', 'd1', { doc_type: 'contract', expires_on: '2031-01-01' }, 'hr1')).rejects.toThrow(
      /carry issue and expiry/,
    );
  });

  it('replace: the new file goes live and the old one moves to Recently deleted, in one transaction', async () => {
    const { service, prisma, audit } = make();
    prisma.repDocument.findFirst.mockResolvedValue(passport);
    const file = { buffer: Buffer.from('x'), mimetype: 'application/pdf', originalname: 'p.pdf' } as never;
    await service.replaceFile('r1', 'd1', { expires_on: '2035-01-01' }, file, 'hr1');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.repDocument.create.mock.calls[0][0].data).toEqual({
      rep_id: 'r1',
      doc_type: 'passport',
      file_url: 'rep-docs/2026/new-pass.pdf',
      issued_on: new Date('2020-01-01T00:00:00.000Z'), // omitted → carried over
      expires_on: new Date('2035-01-01T00:00:00.000Z'),
    });
    expect(prisma.repDocument.update.mock.calls[0][0]).toEqual({
      where: { id: 'd1' },
      data: { deleted_at: expect.any(Date), deleted_by: 'hr1' },
    });
    expect(JSON.stringify(audit.log.mock.calls[0][0])).not.toContain('rep-docs/'); // never the path
  });

  it('delete is a soft delete with a purge date 30 days out; the audit carries no path', async () => {
    const { service, prisma, audit } = make();
    prisma.repDocument.findFirst.mockResolvedValue(passport);
    const r = await service.remove('r1', 'd1', 'hr1');
    const data = prisma.repDocument.update.mock.calls[0][0].data;
    expect(data.deleted_by).toBe('hr1');
    expect(new Date(r.purge_on).getTime() - data.deleted_at.getTime()).toBe(30 * DAY);
    expect(audit.log.mock.calls[0][0]).toMatchObject({ action: 'delete', after: { rep_id: 'r1', doc_type: 'passport' } });
    expect(JSON.stringify(audit.log.mock.calls[0][0])).not.toContain('rep-docs/');
  });

  it('Recently deleted lists who deleted it and when it goes, never the storage path', async () => {
    const { service, prisma } = make();
    prisma.repDocument.findMany.mockResolvedValue([
      { ...passport, deleted_at: new Date('2026-11-01T00:00:00Z'), deleted_by: 'hr1', deleter: { full_name: 'Hana HR' } },
    ]);
    const [row] = await service.listDeleted('r1');
    expect(row).toMatchObject({ file_url: null, deleted_by_name: 'Hana HR', purge_on: '2026-12-01T00:00:00.000Z' });
    expect(row).not.toHaveProperty('deleter');
  });

  it('restore works inside 30 days and is refused (409) after', async () => {
    const { service, prisma } = make();
    prisma.repDocument.findFirst.mockResolvedValue({ ...passport, deleted_at: new Date(NOW.getTime() - 29 * DAY) });
    await service.restore('r1', 'd1', 'hr1', NOW);
    expect(prisma.repDocument.update.mock.calls[0][0].data).toEqual({ deleted_at: null, deleted_by: null });

    prisma.repDocument.findFirst.mockResolvedValue({ ...passport, deleted_at: new Date(NOW.getTime() - 31 * DAY) });
    await expect(service.restore('r1', 'd1', 'hr1', NOW)).rejects.toBeInstanceOf(ConflictException);
    prisma.repDocument.findFirst.mockResolvedValue(null);
    await expect(service.restore('r1', 'd1', 'hr1', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RepDocumentPurgeService — removes for good after 30 days', () => {
  const make = (removeOk: boolean[]) => {
    const due = [
      { id: 'a', file_url: 'rep-docs/2026/a.pdf' },
      { id: 'b', file_url: 'rep-docs/2026/b.jpg' },
    ];
    const prisma = {
      repDocument: {
        // First call returns the due rows; later calls see what is left (none once deleted, or skipped ones excluded).
        findMany: jest.fn().mockImplementation(({ where }) => {
          const skip: string[] = where.id?.notIn ?? [];
          return Promise.resolve(prisma.repDocument._left.filter((d) => !skip.includes(d.id)));
        }),
        deleteMany: jest.fn().mockImplementation(({ where }) => {
          const ids: string[] = where.id.in;
          prisma.repDocument._left = prisma.repDocument._left.filter((d) => !ids.includes(d.id));
          return Promise.resolve({ count: ids.length });
        }),
        count: jest.fn().mockResolvedValue(2),
        _left: [...due],
      },
    };
    const results = [...removeOk];
    const storage = { remove: jest.fn().mockImplementation(() => Promise.resolve(results.shift() ?? true)) };
    return { service: new RepDocumentPurgeService(prisma as never, storage as never), prisma, storage };
  };

  it('only rows past the cutoff: objects removed first, then the rows (re-checking deleted_at)', async () => {
    const { service, prisma, storage } = make([true]);
    const r = await service.purgeExpired(NOW);
    expect(r).toEqual({ due: 2, purged: 2, failed: 0 });
    const cutoff = purgeCutoff(NOW);
    expect(prisma.repDocument.findMany.mock.calls[0][0].where).toEqual({ deleted_at: { lt: cutoff }, id: { notIn: [] } });
    expect(storage.remove).toHaveBeenCalledWith(['rep-docs/2026/a.pdf', 'rep-docs/2026/b.jpg']);
    expect(storage.remove.mock.invocationCallOrder[0]).toBeLessThan(prisma.repDocument.deleteMany.mock.invocationCallOrder[0]);
    expect(prisma.repDocument.deleteMany.mock.calls[0][0].where).toEqual({ id: { in: ['a', 'b'] }, deleted_at: { lt: cutoff } });
  });

  it('storage refuses → the rows are kept for the next run (no orphaned file, no endless loop)', async () => {
    const { service, prisma } = make([false]);
    const r = await service.purgeExpired(NOW);
    expect(r).toEqual({ due: 2, purged: 0, failed: 2 });
    expect(prisma.repDocument.deleteMany).not.toHaveBeenCalled();
  });

  it('the nightly run never throws', async () => {
    const { service, prisma } = make([true]);
    prisma.repDocument.findMany.mockRejectedValueOnce(new Error('db down'));
    await expect(service.runScheduled()).resolves.toBeUndefined();
  });

  it('dry run only counts', async () => {
    const { service, prisma } = make([true]);
    expect(await service.countDue(NOW)).toBe(2);
    expect(prisma.repDocument.count.mock.calls[0][0].where).toEqual({ deleted_at: { lt: purgeCutoff(NOW) } });
  });
});
