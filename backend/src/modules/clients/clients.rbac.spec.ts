import 'reflect-metadata';
import { ClientsController } from './clients.controller';
import { ProductsController } from './products.controller';
import { RBAC_KEY } from '../../common/decorators/require-permission.decorator';

const meta = (ctor: any, method: string) => Reflect.getMetadata(RBAC_KEY, ctor.prototype[method]);

describe('Clients & Products RBAC metadata', () => {
  it('every endpoint declares the expected (module, action) so the global guard enforces it', () => {
    expect(meta(ClientsController, 'list')).toEqual({ moduleKey: 'clients', action: 'view' });
    expect(meta(ClientsController, 'create')).toEqual({ moduleKey: 'clients', action: 'create' });
    expect(meta(ClientsController, 'findOne')).toEqual({ moduleKey: 'clients', action: 'view' });
    expect(meta(ClientsController, 'update')).toEqual({ moduleKey: 'clients', action: 'edit' });
    expect(meta(ClientsController, 'listProducts')).toEqual({
      moduleKey: 'clients',
      action: 'view',
    });
    expect(meta(ClientsController, 'createProduct')).toEqual({
      moduleKey: 'clients',
      action: 'edit',
    });
    // Billing rate cards are gated by the discrete billing_rates module (Super Admin only by default).
    expect(meta(ClientsController, 'listBillingRates')).toEqual({
      moduleKey: 'billing_rates',
      action: 'view',
    });
    expect(meta(ClientsController, 'createBillingRate')).toEqual({
      moduleKey: 'billing_rates',
      action: 'create',
    });
    expect(meta(ClientsController, 'updateBillingRate')).toEqual({
      moduleKey: 'billing_rates',
      action: 'edit',
    });
    expect(meta(ClientsController, 'removeBillingRate')).toEqual({
      moduleKey: 'billing_rates',
      action: 'delete',
    });
    expect(meta(ProductsController, 'update')).toEqual({ moduleKey: 'clients', action: 'edit' });
  });
});
