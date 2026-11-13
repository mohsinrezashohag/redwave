/**
 * Reading an ID's dates (2026-11-12): what the reader returns is a SUGGESTION for HR — nothing read is
 * stored, the audit row never carries the values, and only HR-confirmed dates are saved.
 */
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { DocumentReaderService, parseReadJson } from './document-reader.service';
import { mimeFromPath, RepDocumentsService } from './rep-documents.service';

describe('parseReadJson — what the model returned', () => {
  it('keeps real dates and the name; drops anything malformed', () => {
    expect(
      parseReadJson(JSON.stringify({ full_name: ' Riley Rivera ', issued_on: '2022-06-30', expires_on: '30/06/2032', mrz_lines: ['P<CAN', 7] })),
    ).toEqual({
      name_on_document: 'Riley Rivera', issued_on: '2022-06-30', expires_on: null, date_of_birth: null, document_number: null, mrz_lines: ['P<CAN'],
    });
    expect(() => parseReadJson('not json')).toThrow();
  });
});

describe('DocumentReaderService guards', () => {
  const reader = (key = '') => new DocumentReaderService({ get: () => key } as never);
  it('no API key → 503 (the UI falls back to typing the dates)', async () => {
    await expect(reader().read(Buffer.from('x'), 'image/jpeg', 'passport')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('refuses a file type it cannot read', async () => {
    await expect(reader('k').read(Buffer.from('x'), 'text/plain', 'passport')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('RepDocumentsService — read + save dates', () => {
  const make = () => {
    const prisma = {
      rep: { findUnique: jest.fn().mockResolvedValue({ id: 'r1', full_name: 'Riley Rivera' }) },
      repDocument: {
        findFirst: jest.fn(),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'd1', ...data })),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const storage = { download: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    const reader = {
      read: jest.fn().mockResolvedValue({ name_on_document: 'RIVERA Riley', issued_on: '2022-06-30', expires_on: '2099-06-30', mrz_lines: null }),
    };
    const service = new RepDocumentsService(prisma as never, audit as never, storage as never, reader as never);
    return { service, prisma, audit, storage, reader };
  };

  it('returns suggestions + checks, stores nothing, and audits WITHOUT the values', async () => {
    const { service, prisma, audit } = make();
    const res = await service.readUpload('r1', 'passport', { buffer: Buffer.from('img'), mimetype: 'image/jpeg', originalname: 'p.jpg', size: 3 } as never, 'hr1');
    expect(res.issued_on).toBe('2022-06-30');
    expect(res.checks.find((c) => c.key === 'name')?.ok).toBe(true);
    expect(prisma.repDocument.update).not.toHaveBeenCalled();
    const logged = JSON.stringify(audit.log.mock.calls[0][0]);
    expect(logged).toContain('document_read');
    expect(logged).not.toContain('2022-06-30');
    expect(logged).not.toContain('RIVERA');
  });

  it('only ID documents can be read', async () => {
    const { service } = make();
    await expect(
      service.readUpload('r1', 'contract', { buffer: Buffer.from('x'), mimetype: 'application/pdf' } as never, 'hr1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('reads a document already on file from storage', async () => {
    const { service, prisma, storage, reader } = make();
    prisma.repDocument.findFirst.mockResolvedValue({ doc_type: 'passport', file_url: 'rep-docs/2026/abc-pass.pdf' });
    await service.readStored('r1', 'd1', 'hr1');
    expect(storage.download).toHaveBeenCalledWith('rep-docs/2026/abc-pass.pdf');
    expect(reader.read).toHaveBeenCalledWith(expect.any(Buffer), 'application/pdf', 'passport');
  });

  it('saves HR-confirmed dates (null clears, omitted keeps) and refuses impossible ones', async () => {
    const { service, prisma, audit } = make();
    prisma.repDocument.findFirst.mockResolvedValue({ id: 'd1', doc_type: 'passport', file_url: 'rep-docs/2026/p.pdf', issued_on: null, expires_on: new Date('2030-01-01T00:00:00Z') });
    await service.update('r1', 'd1', { issued_on: '2020-01-01' }, 'hr1');
    expect(prisma.repDocument.update.mock.calls[0][0].data).toEqual({
      doc_type: 'passport',
      issued_on: new Date('2020-01-01T00:00:00.000Z'),
      expires_on: new Date('2030-01-01T00:00:00.000Z'),
    });
    expect(audit.log.mock.calls[0][0].after).toEqual({
      doc_type: 'passport', issued_on: '2020-01-01', expires_on: '2030-01-01', id_details_changed: false,
    });

    await expect(service.update('r1', 'd1', { issued_on: '2031-01-01' }, 'hr1')).rejects.toThrow(/after the issue date/);
    prisma.repDocument.findFirst.mockResolvedValue({ id: 'd2', doc_type: 'contract', file_url: 'rep-docs/2026/c.pdf', issued_on: null, expires_on: null });
    await expect(service.update('r1', 'd2', { expires_on: '2030-01-01' }, 'hr1')).rejects.toThrow(/carry issue and expiry/);
  });

  it('guesses the stored file type from its name', () => {
    expect(mimeFromPath('rep-docs/2026/x-scan.PDF')).toBe('application/pdf');
    expect(mimeFromPath('rep-docs/2026/x.png')).toBe('image/png');
    expect(mimeFromPath('rep-docs/2026/x.jpeg')).toBe('image/jpeg');
  });
});
