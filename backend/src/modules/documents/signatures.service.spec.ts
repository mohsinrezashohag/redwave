import { ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SignaturesService } from './signatures.service';
import { AuthUser } from '../../common/rbac/auth-user.type';
import { SignDecision } from './dto/sign.dto';

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

const sigField = (over: Record<string, unknown> = {}) => ({
  id: 'f1', type: 'signature', page: 0, x: '0.1', y: '0.8', w: '0.25', h: '0.06', value_image_path: null, value_text: null, ...over,
});

function make() {
  // The recompute helpers run inside $transaction(cb) — model the tx client they touch.
  const tx = {
    documentSignature: { update: jest.fn() },
    signatureRequest: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'pending', document_signatures: [{ status: 'signed' }] }),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([{ status: 'completed', document_signatures: [{ status: 'signed' }] }]),
    },
    document: { update: jest.fn() },
  };
  const prisma = {
    signatureRequest: { findUnique: jest.fn(), update: jest.fn() },
    documentSignature: { findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    signatureField: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    userSignature: { findFirst: jest.fn() },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const storage = {
    upload: jest.fn().mockResolvedValue({ path: 'documents/signed/sig1/2026/x.pdf', stored: true }),
    uploadBuffer: jest.fn().mockResolvedValue({ path: 'signatures/u1/applied/2026/a.png', stored: true }),
    signedUrl: jest.fn().mockResolvedValue('https://signed/x.pdf'),
  };
  const stamp = { stamp: jest.fn().mockResolvedValue({ path: 'documents/signed/sig1/2026/x.pdf', stored: true }) };
  const emitter = { emit: jest.fn().mockResolvedValue(undefined) };
  const service = new SignaturesService(prisma as never, audit as never, storage as never, stamp as never, emitter as never);
  return { service, prisma, tx, audit, storage, stamp, emitter };
}

const pendingReq = {
  id: 'req1', status: 'pending', document_id: 'd1',
  document: { owner_user_id: 'owner', title: 'Comp', original_file_url: 'documents/2026/orig.pdf' },
};

describe('SignaturesService.act — sign (stamp) / decline (DOC-003/004/005)', () => {
  it('sign stamps a per-signer copy, sets status/method/ip, updates only the doc STATUS (original untouched), completes', async () => {
    const { service, prisma, tx, stamp, audit } = make();
    prisma.signatureRequest.findUnique.mockResolvedValue(pendingReq);
    prisma.documentSignature.findFirst.mockResolvedValue({ id: 'sig1', status: 'pending' });
    // 1st findMany = the signer's fields (pre-fill); 2nd = ALL fields (post-fill) for the final copy.
    prisma.signatureField.findMany
      .mockResolvedValueOnce([sigField()])
      .mockResolvedValueOnce([sigField({ value_image_path: 'signatures/u1/applied/2026/a.png' })]);

    await service.act('req1', { decision: SignDecision.sign, method: 'drawn', signature_image: 'data:image/png;base64,AAAA' }, user(), '1.2.3.4');

    // a per-signer copy was stamped from the ORIGINAL into a NEW object (original never mutated, DOC-004)
    expect(stamp.stamp).toHaveBeenCalledWith('documents/2026/orig.pdf', 'documents/signed/sig1', expect.any(Array));
    const data = (tx.documentSignature.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.status).toBe('signed');
    expect(data.signed_at).toBeInstanceOf(Date);
    expect(data.ip_address).toBe('1.2.3.4');
    expect(data.method).toBe('drawn');
    expect(data.signed_file_url).toBe('documents/signed/sig1/2026/x.pdf');
    // the document row is ONLY ever status-updated here — original_file_url is never touched
    expect(Object.keys((tx.document.update.mock.calls[0][0] as { data: Record<string, unknown> }).data)).toEqual(['status']);
    // completing the request stamps the final all-signatures copy → completed_file_path
    expect(prisma.signatureRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { completed_file_path: expect.any(String) } }),
    );
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'sign' }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'complete' }));
  });

  it('no fields → a simple click-to-sign (no stamping; signed_file_url null)', async () => {
    const { service, prisma, tx, stamp } = make();
    prisma.signatureRequest.findUnique.mockResolvedValue(pendingReq);
    prisma.documentSignature.findFirst.mockResolvedValue({ id: 'sig1', status: 'pending' });
    prisma.signatureField.findMany.mockResolvedValue([]); // no fields placed

    await service.act('req1', { decision: SignDecision.sign }, user(), undefined);

    expect(stamp.stamp).not.toHaveBeenCalled();
    const data = (tx.documentSignature.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.method).toBe('click_to_sign');
    expect(data.signed_file_url).toBeNull();
  });

  it('a signature field but no signature provided → 422', async () => {
    const { service, prisma } = make();
    prisma.signatureRequest.findUnique.mockResolvedValue(pendingReq);
    prisma.documentSignature.findFirst.mockResolvedValue({ id: 'sig1', status: 'pending' });
    prisma.signatureField.findMany.mockResolvedValue([sigField()]);
    await expect(service.act('req1', { decision: SignDecision.sign }, user(), undefined)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('decline → signer declined; no stamping; no complete audit', async () => {
    const { service, prisma, tx, stamp, audit } = make();
    prisma.signatureRequest.findUnique.mockResolvedValue(pendingReq);
    prisma.documentSignature.findFirst.mockResolvedValue({ id: 'sig1', status: 'pending' });
    tx.signatureRequest.findUniqueOrThrow.mockResolvedValue({ status: 'pending', document_signatures: [{ status: 'declined' }, { status: 'pending' }] });
    tx.signatureRequest.findMany.mockResolvedValue([{ status: 'declined', document_signatures: [{ status: 'declined' }, { status: 'pending' }] }]);

    const result = await service.act('req1', { decision: SignDecision.decline }, user(), '1.2.3.4');

    expect(stamp.stamp).not.toHaveBeenCalled();
    expect((tx.documentSignature.update.mock.calls[0][0] as { data: { status: string } }).data.status).toBe('declined');
    expect(result.documentStatus).toBe('declined');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'decline' }));
    expect(audit.log).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'complete' }));
  });

  it('a non-recipient → 403', async () => {
    const { service, prisma } = make();
    prisma.signatureRequest.findUnique.mockResolvedValue(pendingReq);
    prisma.documentSignature.findFirst.mockResolvedValue(null);
    await expect(service.act('req1', { decision: SignDecision.sign }, user(), undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('re-signing an already-acted signature → 409', async () => {
    const { service, prisma } = make();
    prisma.signatureRequest.findUnique.mockResolvedValue(pendingReq);
    prisma.documentSignature.findFirst.mockResolvedValue({ id: 'sig1', status: 'signed' });
    await expect(service.act('req1', { decision: SignDecision.sign }, user(), undefined)).rejects.toBeInstanceOf(ConflictException);
  });

  it('acting on a closed (non-pending) request → 409', async () => {
    const { service, prisma } = make();
    prisma.signatureRequest.findUnique.mockResolvedValue({ ...pendingReq, status: 'completed' });
    prisma.documentSignature.findFirst.mockResolvedValue({ id: 'sig1', status: 'pending' });
    await expect(service.act('req1', { decision: SignDecision.sign }, user(), undefined)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('SignaturesService.signUpload (externally-signed file)', () => {
  it('stores the uploaded PDF as the signer’s copy with method=uploaded', async () => {
    const { service, prisma, tx, storage } = make();
    prisma.signatureRequest.findUnique.mockResolvedValue(pendingReq);
    prisma.documentSignature.findFirst.mockResolvedValue({ id: 'sig1', status: 'pending' });
    const file = { buffer: Buffer.from('%PDF'), originalname: 'signed.pdf', mimetype: 'application/pdf', size: 4 };
    await service.signUpload('req1', file, user(), '9.9.9.9');
    expect(storage.upload).toHaveBeenCalledWith('documents/signed/sig1', file);
    const data = (tx.documentSignature.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.method).toBe('uploaded');
    expect(data.signed_file_url).toBe('documents/signed/sig1/2026/x.pdf');
  });
});

describe('SignaturesService.fileUrl (per-signer signed copy; visibility)', () => {
  it('the document owner gets a signed URL', async () => {
    const { service, prisma, storage } = make();
    prisma.documentSignature.findUnique.mockResolvedValue({
      signed_file_url: 'documents/signed/sig1/2026/x.pdf',
      signature_request: { document_id: 'd1', document: { owner_user_id: 'u1' } },
    });
    const res = await service.fileUrl('sig1', user());
    expect(res.url).toBe('https://signed/x.pdf');
    expect(storage.signedUrl).toHaveBeenCalledWith('documents/signed/sig1/2026/x.pdf');
  });

  it('a non-owner, non-recipient, non-admin → 404 (no leak)', async () => {
    const { service, prisma } = make();
    prisma.documentSignature.findUnique.mockResolvedValue({
      signed_file_url: 'documents/signed/sig1/2026/x.pdf',
      signature_request: { document_id: 'd1', document: { owner_user_id: 'owner' } },
    });
    prisma.documentSignature.count.mockResolvedValue(0); // not a recipient
    await expect(service.fileUrl('sig1', user())).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SignaturesService.cancel', () => {
  it('the requester cancels a pending request → cancelled', async () => {
    const { service, prisma, tx, audit } = make();
    prisma.signatureRequest.findUnique.mockResolvedValue({
      id: 'req1', status: 'pending', requested_by: 'u1', document_id: 'd1', document: { owner_user_id: 'owner' },
    });
    tx.signatureRequest.findMany.mockResolvedValue([{ status: 'cancelled', document_signatures: [{ status: 'pending' }] }]);
    const result = await service.cancel('req1', user());
    expect((tx.signatureRequest.update.mock.calls[0][0] as { data: { status: string } }).data.status).toBe('cancelled');
    expect(result.status).toBe('cancelled');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'cancel' }));
  });

  it('a non-requester non-owner non-admin → 403', async () => {
    const { service, prisma } = make();
    prisma.signatureRequest.findUnique.mockResolvedValue({
      id: 'req1', status: 'pending', requested_by: 'someone', document_id: 'd1', document: { owner_user_id: 'owner' },
    });
    await expect(service.cancel('req1', user())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cancelling a non-pending request → 409', async () => {
    const { service, prisma } = make();
    prisma.signatureRequest.findUnique.mockResolvedValue({
      id: 'req1', status: 'completed', requested_by: 'u1', document_id: 'd1', document: { owner_user_id: 'u1' },
    });
    await expect(service.cancel('req1', user())).rejects.toBeInstanceOf(ConflictException);
  });
});
