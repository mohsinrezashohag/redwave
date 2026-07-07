/**
 * FieldConfigService — the configurable expense-category catalogue (expense_field_configs) + its per-type
 * FIELD SCHEMA (EXP-002a) and soft caps (EXP-013). Each row sets a category's label, receipt rule, active
 * flag, the captured `fields`, and an `amount_soft_cap`. Config-driven, SA-editable — NOT hardcoded.
 * Items remain bound to the ExpenseCategory enum, so a key beyond the 7 enum values is catalogue-only until
 * an enum migration adds it (CLAUDE §12). — SRS EXP-002a/EXP-009
 */
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { CreateFieldConfigDto, ExpenseFieldDefDto, UpdateFieldConfigDto } from './dto/field-config.dto';
import { assertFieldDefs, ExpenseFieldDef } from './field-schema.logic';

@Injectable()
export class FieldConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.expenseFieldConfig.findMany({ orderBy: { category_key: 'asc' } });
  }

  /** Validate a field-def array (unique snake_case keys, valid type, select→options); 422 on any error. */
  private validateDefs(defs: ExpenseFieldDefDto[] | undefined): ExpenseFieldDef[] {
    const clean = (defs ?? []).map((d) => ({
      key: d.key,
      label: d.label,
      type: d.type,
      required: d.required,
      ...(d.options ? { options: d.options } : {}),
      ...(d.soft_cap ? { soft_cap: d.soft_cap } : {}),
    }));
    const errors = assertFieldDefs(clean);
    if (errors.length > 0) {
      throw new UnprocessableEntityException({ message: 'invalid field schema', errors });
    }
    return clean;
  }

  async create(dto: CreateFieldConfigDto, user: AuthUser) {
    const fields = this.validateDefs(dto.fields);
    try {
      const config = await this.prisma.expenseFieldConfig.create({
        data: {
          category_key: dto.category_key,
          label: dto.label,
          requires_receipt: dto.requires_receipt,
          is_active: dto.is_active ?? true,
          fields: fields as unknown as Prisma.InputJsonValue,
          amount_soft_cap: dto.amount_soft_cap ?? null,
          created_by: user.id,
        },
      });
      await this.audit.log({
        actorId: user.id,
        entityType: 'expense_field_configs',
        entityId: config.id,
        action: 'create',
        after: { category_key: config.category_key, requires_receipt: config.requires_receipt, is_active: config.is_active, field_count: fields.length },
      });
      return config;
    } catch (error) {
      // @unique(category_key) backstop — a duplicate key is a conflict, not a 500.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`category '${dto.category_key}' already exists`);
      }
      throw error;
    }
  }

  /** Update a category's config (label/receipt/active/fields/soft-cap). The category_key is immutable. */
  async update(categoryKey: string, dto: UpdateFieldConfigDto, user: AuthUser) {
    const existing = await this.prisma.expenseFieldConfig.findUnique({ where: { category_key: categoryKey } });
    if (!existing) {
      throw new NotFoundException(`category '${categoryKey}' not found`);
    }
    const data: Prisma.ExpenseFieldConfigUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.requires_receipt !== undefined) data.requires_receipt = dto.requires_receipt;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;
    if (dto.fields !== undefined) data.fields = this.validateDefs(dto.fields) as unknown as Prisma.InputJsonValue;
    if (dto.amount_soft_cap !== undefined) data.amount_soft_cap = dto.amount_soft_cap; // string or null (clear)

    const updated = await this.prisma.expenseFieldConfig.update({ where: { category_key: categoryKey }, data });
    await this.audit.log({
      actorId: user.id,
      entityType: 'expense_field_configs',
      entityId: updated.id,
      action: 'edit',
      before: { requires_receipt: existing.requires_receipt, is_active: existing.is_active },
      after: { category_key: updated.category_key, requires_receipt: updated.requires_receipt, is_active: updated.is_active },
    });
    return updated;
  }
}
