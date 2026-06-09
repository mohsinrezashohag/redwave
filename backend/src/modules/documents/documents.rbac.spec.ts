import 'reflect-metadata';
import { DocumentsController } from './documents.controller';
import { SignatureRequestsController, SignaturesController } from './signature-requests.controller';
import { RBAC_KEY } from '../../common/decorators/require-permission.decorator';

const meta = (ctor: any, method: string) => Reflect.getMetadata(RBAC_KEY, ctor.prototype[method]);

describe('Documents RBAC metadata', () => {
  it('upload + request-signature require documents:create; reads + file-urls require documents:view', () => {
    expect(meta(DocumentsController, 'upload')).toEqual({ moduleKey: 'documents', action: 'create' });
    expect(meta(DocumentsController, 'list')).toEqual({ moduleKey: 'documents', action: 'view' });
    expect(meta(DocumentsController, 'findOne')).toEqual({ moduleKey: 'documents', action: 'view' });
    expect(meta(DocumentsController, 'requestSignature')).toEqual({ moduleKey: 'documents', action: 'create' });
    expect(meta(DocumentsController, 'fileUrl')).toEqual({ moduleKey: 'documents', action: 'view' });
    expect(meta(DocumentsController, 'completedFileUrl')).toEqual({ moduleKey: 'documents', action: 'view' });
  });

  it('sign / sign-upload / cancel / signed-copy carry NO RBAC metadata (recipient / row-level — "any recipient")', () => {
    expect(meta(SignatureRequestsController, 'sign')).toBeUndefined();
    expect(meta(SignatureRequestsController, 'signUpload')).toBeUndefined();
    expect(meta(SignatureRequestsController, 'cancel')).toBeUndefined();
    expect(meta(SignaturesController, 'fileUrl')).toBeUndefined();
  });
});
