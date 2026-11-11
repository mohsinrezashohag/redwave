import 'reflect-metadata';
import { CommissionController, IncentivesController } from './commission.controller';
import { RBAC_KEY } from '../../common/decorators/require-permission.decorator';

const meta = (ctor: any, method: string) => Reflect.getMetadata(RBAC_KEY, ctor.prototype[method]);

describe('Commission Config RBAC metadata', () => {
  it('every endpoint declares the expected (commission, action) so the global guard enforces it', () => {
    expect(meta(CommissionController, 'listTiers')).toEqual({
      moduleKey: 'commission',
      action: 'view',
    });
    expect(meta(CommissionController, 'createTiers')).toEqual({
      moduleKey: 'commission',
      action: 'edit',
    });
    expect(meta(CommissionController, 'setBasePrices')).toEqual({
      moduleKey: 'commission',
      action: 'edit',
    });
    expect(meta(CommissionController, 'listFlatRates')).toEqual({
      moduleKey: 'commission',
      action: 'view',
    });
    expect(meta(CommissionController, 'createFlatRate')).toEqual({
      moduleKey: 'commission',
      action: 'edit',
    });
    expect(meta(CommissionController, 'listHoldbackConfig')).toEqual({
      moduleKey: 'commission',
      action: 'view',
    });
    expect(meta(CommissionController, 'setHoldbackConfig')).toEqual({
      moduleKey: 'commission',
      action: 'edit',
    });
    expect(meta(CommissionController, 'getReleaseSetting')).toEqual({
      moduleKey: 'commission',
      action: 'view',
    });
    expect(meta(CommissionController, 'setReleaseSetting')).toEqual({
      moduleKey: 'commission',
      action: 'edit',
    });
    expect(meta(IncentivesController, 'list')).toEqual({ moduleKey: 'commission', action: 'view' });
    expect(meta(IncentivesController, 'create')).toEqual({
      moduleKey: 'commission',
      action: 'edit',
    });
    expect(meta(IncentivesController, 'update')).toEqual({
      moduleKey: 'commission',
      action: 'edit',
    });
  });
});
