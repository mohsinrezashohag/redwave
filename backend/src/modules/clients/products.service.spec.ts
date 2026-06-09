import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/product.dto';

describe('ProductsService', () => {
  function make() {
    const tx = {
      product: { create: jest.fn() },
      clientBillingRate: { create: jest.fn() },
    };
    const prisma = {
      client: { findUnique: jest.fn().mockResolvedValue({ id: 'c1' }) },
      productTypeCatalogue: { findUnique: jest.fn().mockResolvedValue({ is_active: true }) },
      product: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    return { service: new ProductsService(prisma as never, audit as never), prisma, audit, tx };
  }

  it('create attaches the product to the correct client_id', async () => {
    const { service, tx } = make();
    tx.product.create.mockResolvedValue({ id: 'p1', name: 'Fibre', product_type: 'internet' });
    await service.create('c1', { name: 'Fibre', product_type: 'internet' }, 'actor');
    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ client_id: 'c1', product_type: 'internet' }),
      }),
    );
    expect(tx.clientBillingRate.create).not.toHaveBeenCalled();
  });

  it('create writes an inline initial billing rate in the same transaction', async () => {
    const { service, tx } = make();
    tx.product.create.mockResolvedValue({ id: 'p9', name: 'Fibre', product_type: 'internet' });
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);
    await service.create(
      'c1',
      { name: 'Fibre', product_type: 'internet', initial_billing_rate: { amount: '49.99', effective_from: future.toISOString().slice(0, 10) } },
      'actor',
    );
    const arg = tx.clientBillingRate.create.mock.calls[0][0] as { data: { product_id: string; rate_kind: string; amount: string } };
    expect(arg.data).toEqual(expect.objectContaining({ product_id: 'p9', rate_kind: 'product', amount: '49.99' }));
  });

  it('create throws if the client does not exist', async () => {
    const { service, prisma } = make();
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(service.create('cX', { name: 'x', product_type: 'tv' }, 'actor')).rejects.toThrow();
  });

  it('create rejects an unknown / inactive product type (catalogue check)', async () => {
    const { service, prisma } = make();
    prisma.productTypeCatalogue.findUnique.mockResolvedValue(null); // not in the catalogue
    await expect(
      service.create('c1', { name: 'x', product_type: 'satellite' }, 'actor'),
    ).rejects.toThrow(/Unknown or inactive product type/);
  });
});

describe('CreateProductDto validation (product_type is a snake_case catalogue key)', () => {
  it('rejects a non-snake_case key (existence is checked in the service)', () => {
    const errors = validateSync(plainToInstance(CreateProductDto, { name: 'x', product_type: 'TV Plan' }));
    expect(errors.length).toBeGreaterThan(0);
  });
  it('accepts a well-formed key', () => {
    const errors = validateSync(plainToInstance(CreateProductDto, { name: 'x', product_type: 'internet' }));
    expect(errors).toHaveLength(0);
  });
});
