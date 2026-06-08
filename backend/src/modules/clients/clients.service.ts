/**
 * ClientsService — program-partner CRUD with soft-deactivate. — SRS CLNT-001/006
 * Reuses the Auth patterns: PrismaService + explicit AuditService logging on mutations.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { buildPage, resolveOrderBy, toSkipTake } from '../../common/pagination/paginate';
import { ClientCustomFieldInput, CreateClientDto, ListClientsQuery, UpdateClientDto } from './dto/client.dto';

/** Prisma nested-create rows for a client's custom fields, ordered as supplied. */
function customFieldRows(fields: ClientCustomFieldInput[] | undefined) {
  return (fields ?? []).map((f, i) => ({
    field_name: f.field_name,
    field_value: f.field_value,
    display_order: i,
  }));
}

/** Build the is_active filter for list endpoints (default: active only). */
export function activeStatusWhere(status: 'active' | 'inactive' | 'all' | undefined): {
  is_active?: boolean;
} {
  if (status === 'all') {
    return {};
  }
  return { is_active: status === 'inactive' ? false : true };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class ClientsService {
  /** Columns a client may sort the list on (allowlist — the orderBy-injection guard). */
  private static readonly SORTABLE = ['client_code', 'name', 'market', 'is_active', 'created_at'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: ListClientsQuery) {
    const where: Prisma.ClientWhereInput = {
      ...activeStatusWhere(query.status),
      ...(query.search
        ? {
            OR: [
              { client_code: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { skip, take, page, limit } = toSkipTake(query);
    const orderBy = resolveOrderBy(query.sort, ClientsService.SORTABLE, { created_at: 'asc' });
    const [data, total] = await Promise.all([
      this.prisma.client.findMany({ where, orderBy, skip, take }),
      this.prisma.client.count({ where }),
    ]);
    return buildPage(data, total, page, limit);
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: { custom_fields: { orderBy: { display_order: 'asc' } } },
    });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    return client;
  }

  async create(dto: CreateClientDto, actorId: string) {
    try {
      const client = await this.prisma.client.create({
        data: {
          client_code: dto.client_code,
          name: dto.name,
          market: dto.market,
          supplies_mpu_id: dto.supplies_mpu_id,
          is_active: true,
          custom_fields: { create: customFieldRows(dto.custom_fields) },
        },
        include: { custom_fields: { orderBy: { display_order: 'asc' } } },
      });
      await this.audit.log({
        actorId,
        entityType: 'clients',
        entityId: client.id,
        action: 'create',
        after: { client_code: client.client_code, name: client.name, market: client.market },
      });
      return client;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('client_code already exists'); // never reused — CLNT-001
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateClientDto, actorId: string) {
    const before = await this.findOne(id);
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        // Replace-in-place: when custom_fields is provided, the whole set is rewritten (omit = leave as-is).
        if (dto.custom_fields !== undefined) {
          await tx.clientCustomField.deleteMany({ where: { client_id: id } });
          await tx.clientCustomField.createMany({
            data: customFieldRows(dto.custom_fields).map((f) => ({ ...f, client_id: id })),
          });
        }
        return tx.client.update({
          where: { id },
          data: {
            client_code: dto.client_code,
            name: dto.name,
            market: dto.market,
            supplies_mpu_id: dto.supplies_mpu_id,
            is_active: dto.is_active,
          },
          include: { custom_fields: { orderBy: { display_order: 'asc' } } },
        });
      });
      await this.audit.log({
        actorId,
        entityType: 'clients',
        entityId: id,
        // Deactivation is a soft status change — the row is preserved (CLNT-006).
        action: dto.is_active === false && before.is_active ? 'deactivate' : 'update',
        before,
        after: updated,
      });
      return updated;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('client_code already exists');
      }
      throw error;
    }
  }
}
