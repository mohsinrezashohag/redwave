import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'crypto';
import { FilesService } from './files.service';
import type { AuthUser } from '../../common/rbac/auth-user.type';

const user = { id: 'u-1' } as AuthUser;

const file = (over: Partial<{ buffer: Buffer; originalname: string; mimetype: string; size: number }> = {}) => ({
  buffer: Buffer.from('receipt-bytes'),
  originalname: 'IMG_0001.jpg',
  mimetype: 'image/jpeg',
  size: 1234,
  ...over,
});

function makeService(opts: { configured?: boolean } = {}) {
  const configured = opts.configured ?? true;
  const prisma = {
    storedFile: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'f-1', ...data, created_at: new Date() })),
    },
  };
  const storage = {
    bucketName: 'receipts',
    assertConfigured: jest.fn().mockImplementation(() => {
      if (!configured) throw new ServiceUnavailableException('file storage not configured');
    }),
    uploadObject: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new FilesService(prisma as never, storage as never, audit as never);
  return { service, prisma, storage, audit };
}

describe('FilesService.upload — the unified pipeline (StorageService MOCKED — never real Supabase)', () => {
  it('uploads bytes to a SERVER-generated path and records the metadata row + audit', async () => {
    const { service, prisma, storage, audit } = makeService();
    const f = file();
    const row = await service.upload(f, { purpose: 'receipt', display_name: 'Lunch receipt' }, user);

    // path shape: receipts/yyyy/mm/uuid.jpg — server-generated, no client filename inside
    const path = storage.uploadObject.mock.calls[0][0] as string;
    expect(path).toMatch(/^receipts\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    expect(path).not.toContain('IMG_0001');
    expect(storage.uploadObject).toHaveBeenCalledWith(path, f.buffer, 'image/jpeg');

    expect(prisma.storedFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bucket: 'receipts',
        path,
        original_name: 'IMG_0001.jpg',
        display_name: 'Lunch receipt',
        mime: 'image/jpeg',
        size_bytes: 1234,
        sha256: createHash('sha256').update(f.buffer).digest('hex'),
        uploaded_by: 'u-1',
      }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'upload', entityType: 'stored_files', entityId: 'f-1' }),
    );
    expect(row.path).toBe(path);
  });

  it('document purpose builds documents/... with the pdf extension', async () => {
    const { service, storage } = makeService();
    await service.upload(file({ mimetype: 'application/pdf', originalname: 'agreement.pdf' }), { purpose: 'document' }, user);
    expect(storage.uploadObject.mock.calls[0][0]).toMatch(/^documents\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
  });

  it('FAIL-SAFE: storage unconfigured → 503, nothing uploaded or recorded (never a stub ref)', async () => {
    const { service, prisma, storage } = makeService({ configured: false });
    await expect(service.upload(file(), { purpose: 'receipt' }, user)).rejects.toThrow(ServiceUnavailableException);
    expect(storage.uploadObject).not.toHaveBeenCalled();
    expect(prisma.storedFile.create).not.toHaveBeenCalled();
  });

  it('rejects a disallowed mime (422) and an oversized file (422) — defense in depth behind the pipe', async () => {
    const { service, prisma } = makeService();
    await expect(service.upload(file({ mimetype: 'image/heic' }), { purpose: 'receipt' }, user)).rejects.toThrow(
      UnprocessableEntityException,
    );
    await expect(
      service.upload(file({ size: 10 * 1024 * 1024 + 1 }), { purpose: 'receipt' }, user),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(prisma.storedFile.create).not.toHaveBeenCalled();
  });
});
