import { ServiceUnavailableException } from '@nestjs/common';
import { StorageService, UploadedFile } from './storage.service';

const file: UploadedFile = {
  buffer: Buffer.from('receipt-bytes'),
  originalname: 'My Receipt #1.jpg',
  mimetype: 'image/jpeg',
  size: 13,
};

function make(env: Record<string, string | undefined>) {
  const config = { get: jest.fn((k: string) => env[k]) };
  return new StorageService(config as never);
}

describe('StorageService (env-gated, graceful)', () => {
  it('is not configured + the unified-pipeline gates FAIL 503 when Supabase env is absent', async () => {
    const storage = make({});
    expect(storage.isConfigured()).toBe(false);
    expect(() => storage.assertConfigured()).toThrow(ServiceUnavailableException);
    await expect(storage.uploadObject('receipts/2026/06/x.jpg', file.buffer, file.mimetype)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('reports configured when URL + service-role key are present', () => {
    const storage = make({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' });
    expect(storage.isConfigured()).toBe(true);
  });

  it('upload (unconfigured) returns a path-shaped local reference, sanitized + foldered', async () => {
    const storage = make({});
    const result = await storage.upload('documents', { ...file, originalname: 'Comp Agreement.pdf' });
    expect(result.stored).toBe(false);
    expect(result.path).toBe('local://documents/Comp_Agreement.pdf');
  });

  it('uploadBuffer (unconfigured) returns a local reference under the folder', async () => {
    const storage = make({});
    const result = await storage.uploadBuffer('documents/signed', 'signed.pdf', Buffer.from('x'), 'application/pdf');
    expect(result.stored).toBe(false);
    expect(result.path).toBe('local://documents/signed/signed.pdf');
  });

  it('signedUrl/download return null for a local ref or when unconfigured (graceful)', async () => {
    const storage = make({});
    expect(await storage.signedUrl('local://documents/x.pdf')).toBeNull();
    expect(await storage.signedUrl('documents/2026/abc-x.pdf')).toBeNull(); // unconfigured client
    expect(await storage.download('documents/2026/abc-x.pdf')).toBeNull();
  });
});
