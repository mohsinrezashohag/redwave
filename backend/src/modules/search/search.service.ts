/**
 * SearchService — the global, RBAC-SCOPED search behind the top-bar box (BRD; arch §7). Authenticated,
 * but each entity group is populated ONLY when the caller is entitled to it: reps need `hrm:view`,
 * clients need `clients:view`, and sales are scoped to the caller's data (rep=own / manager=roster /
 * admin=all) via ScopeService — never by filtering after the fact (§5). Case-insensitive substring match;
 * each group capped. No money is returned.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { SearchResponse } from './dto/search.response';

const CAP = 6; // max results per group
const MIN_LEN = 2;

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async search(rawQuery: string, user: AuthUser): Promise<SearchResponse> {
    const term = (rawQuery ?? '').trim();
    const out: SearchResponse = { reps: [], clients: [], sales: [] };
    if (term.length < MIN_LEN) return out;
    const like = { contains: term, mode: 'insensitive' as Prisma.QueryMode };

    if (user.permissions.has('hrm:view')) {
      out.reps = await this.prisma.rep.findMany({
        where: { OR: [{ full_name: like }, { rep_code: like }] },
        select: { id: true, rep_code: true, full_name: true },
        take: CAP,
        orderBy: { full_name: 'asc' },
      });
    }

    if (user.permissions.has('clients:view')) {
      out.clients = await this.prisma.client.findMany({
        where: { OR: [{ name: like }, { client_code: like }] },
        select: { id: true, client_code: true, name: true },
        take: CAP,
        orderBy: { name: 'asc' },
      });
    }

    if (user.permissions.has('sales:view')) {
      const scope = await this.scope.getRepScope(user);
      const scopeWhere: Prisma.SaleWhereInput = scope.level === 'all' ? {} : { rep_id: { in: scope.repIds } };
      out.sales = await this.prisma.sale.findMany({
        where: {
          AND: [
            scopeWhere, // scope in the query (§5)
            { status: { not: 'deleted' } },
            { OR: [{ sale_code: like }, { customer_name: like }, { street: like }, { mpu_id: like }] },
          ],
        },
        select: { id: true, sale_code: true, customer_name: true },
        take: CAP,
        orderBy: { sale_date: 'desc' },
      });
    }

    return out;
  }
}
