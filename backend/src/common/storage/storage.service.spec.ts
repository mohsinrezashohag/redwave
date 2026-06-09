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
  it('is not configured + returns a selection-only reference when Supabase env is absent', async () => {
    const storage = make({});
    expect(storage.isConfigured()).toBe(false);
    const result = await storage.uploadReceipt(file);
    expect(result.stored).toBe(false);
    expect(result.url).toContain('local://receipts/');
    // filename is sanitized (no spaces / unsafe chars), extension preserved
    expect(result.url).toMatch(/My_Receipt__1\.jpg$/);
  });

  it('reports configured when URL + service-role key are present', () => {
    const storage = make({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' });
    expect(storage.isConfigured()).toBe(true);
  });
});
