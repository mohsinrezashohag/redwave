import { AuditQueryService } from './audit-query.service';
import { AuditQueryDto } from './dto/audit-query.dto';

function make() {
  const prisma = {
    auditLog: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };
  return { service: new AuditQueryService(prisma as never), prisma };
}

describe('AuditQueryService.buildWhere — filters (arch §security)', () => {
  it('maps actor / entity / action filters', () => {
    const { service } = make();
    const where = service.buildWhere(Object.assign(new AuditQueryDto(), {
      actor_id: 'u1',
      entity_type: 'pay_runs',
      entity_id: 'p1',
      action: 'finalize',
    }));
    expect(where).toMatchObject({ user_id: 'u1', entity_type: 'pay_runs', entity_id: 'p1', action: 'finalize' });
  });

  it('builds an inclusive created_at range from date_from/date_to', () => {
    const { service } = make();
    const where = service.buildWhere(Object.assign(new AuditQueryDto(), { date_from: '2026-01-01', date_to: '2026-01-31' }));
    const range = where.created_at as { gte: Date; lte: Date };
    expect(range.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(range.lte.toISOString()).toBe('2026-01-31T23:59:59.999Z');
  });

  it('search applies a case-insensitive OR over entity_type + action', () => {
    const { service } = make();
    const where = service.buildWhere(Object.assign(new AuditQueryDto(), { search: 'login' }));
    expect(where.OR).toEqual([
      { entity_type: { contains: 'login', mode: 'insensitive' } },
      { action: { contains: 'login', mode: 'insensitive' } },
    ]);
  });

  it('list returns the {data, meta} envelope and includes the actor', async () => {
    const { service, prisma } = make();
    prisma.auditLog.findMany.mockResolvedValue([{ id: 'a1', actor: { id: 'u1', full_name: 'Jane', email: 'j@x.co' } }]);
    prisma.auditLog.count.mockResolvedValue(1);
    const page = await service.list(Object.assign(new AuditQueryDto(), { page: 1, limit: 20 }));
    expect(page.meta).toEqual({ total: 1, page: 1, limit: 20, pageCount: 1 });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { actor: { select: { id: true, full_name: true, email: true, avatar_url: true } } } }),
    );
  });
});
