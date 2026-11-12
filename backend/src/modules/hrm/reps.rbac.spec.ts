import 'reflect-metadata';
import { RepsController } from './reps.controller';
import { EquipmentController } from './equipment.controller';
import { RBAC_KEY } from '../../common/decorators/require-permission.decorator';

const meta = (ctor: any, method: string) => Reflect.getMetadata(RBAC_KEY, ctor.prototype[method]);

describe('HRM RBAC metadata', () => {
  it('every endpoint declares the expected (module, action) so the global guard enforces it', () => {
    expect(meta(RepsController, 'list')).toEqual({ moduleKey: 'hrm', action: 'view' });
    expect(meta(RepsController, 'create')).toEqual({ moduleKey: 'hrm', action: 'create' });
    expect(meta(RepsController, 'findOne')).toEqual({ moduleKey: 'hrm', action: 'view' });
    expect(meta(RepsController, 'update')).toEqual({ moduleKey: 'hrm', action: 'edit' });
    expect(meta(RepsController, 'listDocuments')).toEqual({ moduleKey: 'hrm', action: 'view' });
    expect(meta(RepsController, 'createDocument')).toEqual({ moduleKey: 'hrm', action: 'edit' });
    expect(meta(RepsController, 'documentFileUrl')).toEqual({ moduleKey: 'hrm', action: 'edit' });
    // Reading an ID's dates and saving them are HR-only, like opening the file. 2026-11-12
    expect(meta(RepsController, 'readDocumentUpload')).toEqual({ moduleKey: 'hrm', action: 'edit' });
    expect(meta(RepsController, 'readStoredDocument')).toEqual({ moduleKey: 'hrm', action: 'edit' });
    expect(meta(RepsController, 'updateDocumentDates')).toEqual({ moduleKey: 'hrm', action: 'edit' });
    expect(meta(RepsController, 'listEquipment')).toEqual({ moduleKey: 'hrm', action: 'view' });
    expect(meta(RepsController, 'assignEquipment')).toEqual({ moduleKey: 'hrm', action: 'edit' });
    expect(meta(EquipmentController, 'update')).toEqual({ moduleKey: 'hrm', action: 'edit' });
  });
});
