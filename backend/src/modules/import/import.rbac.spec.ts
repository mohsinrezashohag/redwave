import 'reflect-metadata';
import { ImportController, ImportMappingsController } from './import.controller';
import { RBAC_KEY } from '../../common/decorators/require-permission.decorator';

const meta = (ctor: any, method: string) => Reflect.getMetadata(RBAC_KEY, ctor.prototype[method]);

describe('Import RBAC metadata', () => {
  it('declares the expected (import, action) per arch §6.11 — commit is the high-stakes approve', () => {
    expect(meta(ImportController, 'create')).toEqual({ moduleKey: 'import', action: 'create' });
    expect(meta(ImportController, 'list')).toEqual({ moduleKey: 'import', action: 'view' });
    expect(meta(ImportController, 'findOne')).toEqual({ moduleKey: 'import', action: 'view' });
    expect(meta(ImportController, 'errorReport')).toEqual({ moduleKey: 'import', action: 'view' });
    expect(meta(ImportController, 'remap')).toEqual({ moduleKey: 'import', action: 'edit' });
    expect(meta(ImportController, 'reconcile')).toEqual({ moduleKey: 'import', action: 'edit' });
    expect(meta(ImportController, 'commit')).toEqual({ moduleKey: 'import', action: 'approve' });
  });

  // The dry run reads a file the caller is about to stage — same gate as staging, and no new permission.
  it('preview rides import:create (it writes nothing, but sees the same data as staging)', () => {
    expect(meta(ImportController, 'preview')).toEqual({ moduleKey: 'import', action: 'create' });
  });

  it('mapping CRUD rides the same import permissions (no new permission)', () => {
    expect(meta(ImportMappingsController, 'list')).toEqual({ moduleKey: 'import', action: 'view' });
    expect(meta(ImportMappingsController, 'create')).toEqual({ moduleKey: 'import', action: 'create' });
    expect(meta(ImportMappingsController, 'update')).toEqual({ moduleKey: 'import', action: 'edit' });
    expect(meta(ImportMappingsController, 'remove')).toEqual({ moduleKey: 'import', action: 'edit' });
  });
});
