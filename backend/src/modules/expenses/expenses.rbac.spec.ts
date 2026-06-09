import 'reflect-metadata';
import {
  ExpenseItemsController,
  ExpenseFieldConfigsController,
  ExpenseExportsController,
  ExpenseReceiptsController,
} from './expenses.controller';
import { RBAC_KEY } from '../../common/decorators/require-permission.decorator';

const meta = (ctor: any, method: string) => Reflect.getMetadata(RBAC_KEY, ctor.prototype[method]);

describe('Expenses RBAC metadata', () => {
  it('expense-items declares the expected (expenses, action) on every endpoint', () => {
    expect(meta(ExpenseItemsController, 'create')).toEqual({ moduleKey: 'expenses', action: 'create' });
    expect(meta(ExpenseItemsController, 'list')).toEqual({ moduleKey: 'expenses', action: 'view' });
    expect(meta(ExpenseItemsController, 'findOne')).toEqual({ moduleKey: 'expenses', action: 'view' });
    expect(meta(ExpenseItemsController, 'edit')).toEqual({ moduleKey: 'expenses', action: 'edit' });
    expect(meta(ExpenseItemsController, 'remove')).toEqual({ moduleKey: 'expenses', action: 'delete' });
    expect(meta(ExpenseItemsController, 'review')).toEqual({ moduleKey: 'expenses', action: 'approve' });
    expect(meta(ExpenseItemsController, 'bulkReview')).toEqual({ moduleKey: 'expenses', action: 'approve' });
  });

  it('field-configs require expenses:view to read and expenses:edit to configure', () => {
    expect(meta(ExpenseFieldConfigsController, 'list')).toEqual({ moduleKey: 'expenses', action: 'view' });
    expect(meta(ExpenseFieldConfigsController, 'create')).toEqual({ moduleKey: 'expenses', action: 'edit' });
  });

  it('exports require expenses:view to list and expenses:export to generate', () => {
    expect(meta(ExpenseExportsController, 'list')).toEqual({ moduleKey: 'expenses', action: 'view' });
    expect(meta(ExpenseExportsController, 'create')).toEqual({ moduleKey: 'expenses', action: 'export' });
  });

  it('receipt upload requires expenses:create', () => {
    expect(meta(ExpenseReceiptsController, 'upload')).toEqual({ moduleKey: 'expenses', action: 'create' });
  });
});
