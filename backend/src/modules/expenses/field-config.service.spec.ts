import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { FieldConfigService } from './field-config.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { CreateFieldConfigDto, ExpenseFieldDefDto } from './dto/field-config.dto';

const user = { id: 'sa', isSuperAdmin: true } as AuthUser;

function make(existing: unknown = null) {
  const prisma = {
    expenseFieldConfig: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'c1', ...data })),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'c1', category_key: 'meals', requires_receipt: true, is_active: true, ...data })),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new FieldConfigService(prisma as never, audit as never), prisma };
}

const def = (over: Partial<ExpenseFieldDefDto> = {}): ExpenseFieldDefDto => ({ key: 'vendor', label: 'Vendor', type: 'text', required: true, ...over });
const createDto = (fields: ExpenseFieldDefDto[], over: Partial<CreateFieldConfigDto> = {}): CreateFieldConfigDto => ({
  category_key: 'meals',
  label: 'Meals',
  requires_receipt: true,
  fields,
  ...over,
});

describe('FieldConfigService.create', () => {
  it('persists a valid field schema + amount_soft_cap', async () => {
    const { service, prisma } = make();
    await service.create(createDto([def()], { amount_soft_cap: '30.00' }), user);
    const data = prisma.expenseFieldConfig.create.mock.calls[0][0].data;
    expect(data.fields).toEqual([{ key: 'vendor', label: 'Vendor', type: 'text', required: true }]);
    expect(data.amount_soft_cap).toBe('30.00');
  });

  it('rejects an invalid field schema (duplicate key) → 422', async () => {
    const { service } = make();
    await expect(service.create(createDto([def(), def({ label: 'V2' })]), user)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a select field without options → 422', async () => {
    const { service } = make();
    await expect(service.create(createDto([def({ key: 'method', label: 'Method', type: 'select' })]), user)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('FieldConfigService.update', () => {
  it('updates an existing category (fields + soft cap)', async () => {
    const { service, prisma } = make({ id: 'c1', category_key: 'meals', requires_receipt: true, is_active: true, fields: [] });
    await service.update('meals', { fields: [def({ key: 'city', label: 'City', required: false })], amount_soft_cap: '25.00' }, user);
    const data = prisma.expenseFieldConfig.update.mock.calls[0][0].data;
    expect(data.fields).toEqual([{ key: 'city', label: 'City', type: 'text', required: false }]);
    expect(data.amount_soft_cap).toBe('25.00');
  });

  it('404s an unknown category', async () => {
    const { service } = make(null);
    await expect(service.update('nope', { label: 'X' }, user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('clears the soft cap when passed null', async () => {
    const { service, prisma } = make({ id: 'c1', category_key: 'meals', requires_receipt: true, is_active: true, fields: [] });
    await service.update('meals', { amount_soft_cap: null }, user);
    expect(prisma.expenseFieldConfig.update.mock.calls[0][0].data.amount_soft_cap).toBeNull();
  });
});
