import 'reflect-metadata';
import { SalesController } from './sales.controller';
import { RBAC_KEY } from '../../common/decorators/require-permission.decorator';

const meta = (ctor: any, method: string) => Reflect.getMetadata(RBAC_KEY, ctor.prototype[method]);

describe('Sales RBAC metadata', () => {
  it('every endpoint declares the expected (sales, action) so the global guard enforces it', () => {
    expect(meta(SalesController, 'create')).toEqual({ moduleKey: 'sales', action: 'create' });
    expect(meta(SalesController, 'list')).toEqual({ moduleKey: 'sales', action: 'view' });
    expect(meta(SalesController, 'findOne')).toEqual({ moduleKey: 'sales', action: 'view' });
    expect(meta(SalesController, 'edit')).toEqual({ moduleKey: 'sales', action: 'edit' });
    expect(meta(SalesController, 'validate')).toEqual({ moduleKey: 'sales', action: 'approve' });
    expect(meta(SalesController, 'setGreenfield')).toEqual({
      moduleKey: 'sales',
      action: 'approve',
    });
    expect(meta(SalesController, 'bulkValidate')).toEqual({
      moduleKey: 'sales',
      action: 'approve',
    });
    expect(meta(SalesController, 'remove')).toEqual({ moduleKey: 'sales', action: 'delete' });
    // The export log (2026-11-11): every route rides sales:export.
    expect(meta(SalesController, 'exportSales')).toEqual({ moduleKey: 'sales', action: 'export' });
    expect(meta(SalesController, 'exportSummary')).toEqual({ moduleKey: 'sales', action: 'export' });
    expect(meta(SalesController, 'listExports')).toEqual({ moduleKey: 'sales', action: 'export' });
  });

  // `GET :id` would swallow `/sales/exports` if declared first (ParseUUIDPipe → 400).
  it('the export routes are declared BEFORE the :id route', () => {
    const order = Object.getOwnPropertyNames(SalesController.prototype);
    expect(order.indexOf('listExports')).toBeLessThan(order.indexOf('findOne'));
    expect(order.indexOf('exportSummary')).toBeLessThan(order.indexOf('findOne'));
  });
});
