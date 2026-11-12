/**
 * AuditQueryService — READ-ONLY access to the append-only audit_log (Super Admin via audit:view).
 *
 * Filters by actor / entity_type / entity_id / action / date range; the same query with entity_type +
 * entity_id powers the per-record History tab. There are NO write/update/delete paths here — the trail is
 * append-only and stays so. — arch §security (audit)
 */
import { Injectable, Optional } from '@nestjs/common';
import { AvatarService } from '../../common/avatar/avatar.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPage, resolveOrderBy, toSkipTake } from '../../common/pagination/paginate';
import { AuditQueryDto } from './dto/audit-query.dto';

const SORTABLE = ['created_at', 'action', 'entity_type'] as const;

@Injectable()
export class AuditQueryService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly avatars?: AvatarService,
  ) {}

  buildWhere(query: AuditQueryDto): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.actor_id) where.user_id = query.actor_id;
    if (query.entity_type) where.entity_type = query.entity_type;
    if (query.entity_id) where.entity_id = query.entity_id;
    if (query.action) where.action = query.action;
    if (query.date_from || query.date_to) {
      where.created_at = {
        ...(query.date_from ? { gte: new Date(`${query.date_from}T00:00:00.000Z`) } : {}),
        ...(query.date_to ? { lte: new Date(`${query.date_to}T23:59:59.999Z`) } : {}),
      };
    }
    if (query.search) {
      where.OR = [
        { entity_type: { contains: query.search, mode: 'insensitive' } },
        { action: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  async list(query: AuditQueryDto) {
    const { skip, take, page, limit } = toSkipTake(query);
    const where = this.buildWhere(query);
    const orderBy = resolveOrderBy(query.sort, SORTABLE, { created_at: 'desc' });
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { actor: { select: { id: true, full_name: true, email: true, avatar_url: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    // The actor's photo as a display URL (never the stored path). 2026-11-12
    const actors = rows.flatMap((r) => (r.actor ? [r.actor] : []));
    const urls = this.avatars ? await this.avatars.resolve(actors) : new Map<string, string | null>();
    const withPhotos = rows.map((r) => (r.actor ? { ...r, actor: { ...r.actor, avatar_url: urls.get(r.actor.id) ?? null } } : r));
    return buildPage(withPhotos, total, page, limit);
  }
}
