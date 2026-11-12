import 'reflect-metadata';
import {
  PayPeriodController,
  PayRunController,
} from './pay-run.controller';
import { RBAC_KEY } from '../../common/decorators/require-permission.decorator';

const meta = (ctor: any, method: string) => Reflect.getMetadata(RBAC_KEY, ctor.prototype[method]);

describe('Pay Run RBAC metadata', () => {
  it('declares the expected (payrun, action) on every endpoint — money actions require approve', () => {
    expect(meta(PayPeriodController, 'list')).toEqual({ moduleKey: 'payrun', action: 'view' });
    expect(meta(PayRunController, 'list')).toEqual({ moduleKey: 'payrun', action: 'view' });
    expect(meta(PayRunController, 'create')).toEqual({ moduleKey: 'payrun', action: 'create' });
    expect(meta(PayRunController, 'findOne')).toEqual({ moduleKey: 'payrun', action: 'view' });
    expect(meta(PayRunController, 'lines')).toEqual({ moduleKey: 'payrun', action: 'view' });
    expect(meta(PayRunController, 'setBonus')).toEqual({ moduleKey: 'payrun', action: 'approve' });
    expect(meta(PayRunController, 'finalize')).toEqual({ moduleKey: 'payrun', action: 'approve' });
    expect(meta(PayRunController, 'export')).toEqual({ moduleKey: 'payrun', action: 'export' });
  });
});
