import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { AuthUser } from '../../common/rbac/auth-user.type';

const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u1',
  email: 'u@x.co',
  full_name: 'User',
  status: 'active',
  roleNames: [],
  isSuperAdmin: false,
  permissions: new Set(),
  repId: null,
  ...over,
});
const admin = user({ id: 'admin', roleNames: ['Admin'] });

const CLAIMED_PATH = 'documents/2026/06/abc.pdf';

function make() {
  const tx = {
    signatureRequest: {
      create: jest.fn().mockResolvedValue({ id: 'req1', document_signatures: [], signature_fields: [] }),
      findMany: jest.fn().mockResolvedValue([
        { status: 'pending', document_signatures: [{ status: 'pending' }, { status: 'pending' }] },
      ]),
    },
    document: { update: jest.fn() },
  };
  const prisma = {
    document: {
      create: jest.fn().mockResolvedValue({ id: 'doc1', original_file_url: 'documents/2026/abc-comp.pdf' }),
      update: jest.fn().mockResolvedValue({ id: 'doc1' }),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  // Storage stores the object PATH; the original is never re-written (DOC-001/004).
  const storage = {
    signedUrl: jest.fn().mockResolvedValue('https://signed/x.pdf'),
  };
  // The unified-pipeline claim (FilesService mocked — the claim rules have their own spec).
  const files = {
    claim: jest.fn().mockResolvedValue({ path: CLAIMED_PATH, mime: 'application/pdf', uploaded_by: 'u1' }),
  };
  const emitter = { emit: jest.fn().mockResolvedValue(undefined) };
  const service = new DocumentsService(prisma as never, audit as never, storage as never, files as never, emitter as never);
  return { service, prisma, tx, audit, storage, files, emitter };
}

describe('DocumentsService.upload (DOC-001 — claimed stored path, original never mutated)', () => {
  it('CLAIMS the uploaded path (own upload, PDF) and freezes it as the immutable original', async () => {
    const { service, prisma, files, audit } = make();
    const u = user();
    await service.upload({ title: 'Comp Agreement', doc_type: 'compensation_agreement', file_path: CLAIMED_PATH }, u);
    expect(files.claim).toHaveBeenCalledWith(CLAIMED_PATH, u, 'document');
    const createData = (prisma.document.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(createData.owner_user_id).toBe('u1');
    expect(createData.status).toBe('draft');
    expect(createData.original_file_url).toBe(CLAIMED_PATH);
    expect(prisma.document.update).not.toHaveBeenCalled(); // the original is written once, never re-mutated
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', entityType: 'documents' }));
  });

  it('a failed claim (unknown/foreign/non-PDF path) → 422, nothing created', async () => {
    const { service, prisma, files } = make();
    files.claim.mockRejectedValue(new UnprocessableEntityException('unknown document file reference'));
    await expect(
      service.upload({ title: 'X', doc_type: 'other', file_path: 'documents/2026/06/foreign.pdf' }, user()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.document.create).not.toHaveBeenCalled();
  });
});

describe('DocumentsService.requestSignature (DOC-002 share == signature request)', () => {
  const dto = { recipient_user_ids: ['r1', 'r2'] };

  it('owner shares → creates a request + one pending signature per recipient; audited', async () => {
    const { service, prisma, tx, audit } = make();
    prisma.document.findUnique.mockResolvedValue({ id: 'doc1', owner_user_id: 'u1' });
    await service.requestSignature('doc1', dto, user());
    const createArg = (tx.signatureRequest.create.mock.calls[0][0] as {
      data: { status: string; document_signatures: { create: { recipient_user_id: string; status: string }[] } };
    }).data;
    expect(createArg.status).toBe('pending');
    expect(createArg.document_signatures.create).toEqual([
      { recipient_user_id: 'r1', status: 'pending' },
      { recipient_user_id: 'r2', status: 'pending' },
    ]);
    expect(tx.document.update).toHaveBeenCalled(); // recompute → shared
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'share' }));
  });

  it('a non-owner non-admin sharing → 403 + audit', async () => {
    const { service, prisma, audit } = make();
    prisma.document.findUnique.mockResolvedValue({ id: 'doc1', owner_user_id: 'someone-else' });
    await expect(service.requestSignature('doc1', dto, user())).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'access_denied' }));
  });

  it('an admin may share a document they do not own', async () => {
    const { service, prisma } = make();
    prisma.document.findUnique.mockResolvedValue({ id: 'doc1', owner_user_id: 'someone-else' });
    await expect(service.requestSignature('doc1', dto, admin)).resolves.toBeDefined();
  });

  it('duplicate recipients → 422', async () => {
    const { service, prisma } = make();
    prisma.document.findUnique.mockResolvedValue({ id: 'doc1', owner_user_id: 'u1' });
    await expect(
      service.requestSignature('doc1', { recipient_user_ids: ['r1', 'r1'] }, user()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('unknown document → 404', async () => {
    const { service, prisma } = make();
    prisma.document.findUnique.mockResolvedValue(null);
    await expect(service.requestSignature('nope', dto, user())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('persists placed fields; a field targeting a non-recipient → 422 (DOC-003)', async () => {
    const { service, prisma, tx } = make();
    prisma.document.findUnique.mockResolvedValue({ id: 'doc1', owner_user_id: 'u1' });
    const field = { type: 'signature' as const, recipient_user_id: 'r1', page: 0, x: 0.1, y: 0.8, w: 0.25, h: 0.06 };
    await service.requestSignature('doc1', { ...dto, fields: [field] }, user());
    const createArg = (tx.signatureRequest.create.mock.calls[0][0] as {
      data: { signature_fields: { create: { recipient_user_id: string; x: string }[] } };
    }).data;
    expect(createArg.signature_fields.create).toEqual([
      { recipient_user_id: 'r1', type: 'signature', page: 0, x: '0.1', y: '0.8', w: '0.25', h: '0.06' },
    ]);

    await expect(
      service.requestSignature('doc1', { ...dto, fields: [{ ...field, recipient_user_id: 'not-a-recipient' }] }, user()),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('DocumentsService visibility scoping (§5)', () => {
  it('a non-admin list is scoped to owner OR recipient (never filtered after fetch)', async () => {
    const { service, prisma } = make();
    await service.list({}, user());
    const where = (prisma.document.findMany.mock.calls[0][0] as { where: { AND: unknown[] } }).where;
    expect(where.AND[0]).toEqual({
      OR: [
        { owner_user_id: 'u1' },
        { signature_requests: { some: { document_signatures: { some: { recipient_user_id: 'u1' } } } } },
      ],
    });
  });

  it('an admin list applies no visibility restriction', async () => {
    const { service, prisma } = make();
    await service.list({}, admin);
    const where = (prisma.document.findMany.mock.calls[0][0] as { where: { AND: unknown[] } }).where;
    expect(where.AND[0]).toEqual({});
  });

  it('detail returns 404 when the document is not visible to the caller', async () => {
    const { service, prisma } = make();
    prisma.document.findFirst.mockResolvedValue(null);
    await expect(service.findOne('doc1', user())).rejects.toBeInstanceOf(NotFoundException);
  });
});
