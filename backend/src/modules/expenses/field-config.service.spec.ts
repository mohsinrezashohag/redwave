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

// ── The invariant the form layer leans on (packet 10) ────────────────────────────────────────────
// `behaviour` decides mileage handling, and it is deliberately NOT settable through this API: an
// SA-created category is always `standard`, so the seeded `km` row stays the only km-behaviour category.
// That is what lets `expenseForm.schema.ts` keep its zod shape rules keyed on the `km` key. If these tests
// start failing because someone exposed `behaviour` on the DTOs, thread the catalogue behaviour through
// that form schema in the SAME change — otherwise the client silently disagrees with the server.
describe('FieldConfigService — behaviour/is_system are not client-settable', () => {
  it('create never writes behaviour or is_system, even when the payload carries them', async () => {
    const { service, prisma } = make();
    await service.create(
      { ...createDto([def()]), behaviour: 'km', is_system: true } as unknown as CreateFieldConfigDto,
      user,
    );
    const data = prisma.expenseFieldConfig.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('behaviour'); // → falls to the schema default `standard`
    expect(data).not.toHaveProperty('is_system');
  });

  it('update never writes behaviour or is_system either', async () => {
    const { service, prisma } = make({ category_key: 'meals', fields: [] });
    await service.update('meals', { label: 'Meals & entertainment', behaviour: 'km', is_system: true } as never, user);
    const data = prisma.expenseFieldConfig.update.mock.calls[0][0].data;
    expect(data.label).toBe('Meals & entertainment'); // the legitimate change still lands
    expect(data).not.toHaveProperty('behaviour');
    expect(data).not.toHaveProperty('is_system');
  });
});
