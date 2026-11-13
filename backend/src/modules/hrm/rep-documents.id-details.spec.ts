/**
 * HR-confirmed ID details + Data accuracy (2026-11-13): the document number is stored ENCRYPTED and only its
 * last four ever leave the server; the identity details are nulled for view-only callers; the comparison
 * flags a difference only when both sides are on file.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { decryptField } from '../../common/crypto/field-cipher';
import { RepDocumentsService, toDocView } from './rep-documents.service';

const KEY = randomBytes(32);

const make = (withKey = true) => {
  const prev = process.env.PII_ENCRYPTION_KEY;
  process.env.PII_ENCRYPTION_KEY = withKey ? KEY.toString('base64') : '';
  const prisma = {
    rep: { findUnique: jest.fn() },
    repDocument: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'd1', rep_id: 'r1', ...data })),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new RepDocumentsService(prisma as never, audit as never, {} as never, {} as never);
  process.env.PII_ENCRYPTION_KEY = prev;
  return { service, prisma, audit };
};

const passport = {
  id: 'd1',
  rep_id: 'r1',
  doc_type: 'passport',
  file_url: 'rep-docs/2026/p.pdf',
  uploaded_at: new Date('2026-01-01T00:00:00Z'),
  issued_on: new Date('2022-06-30T00:00:00Z'),
  expires_on: new Date('2032-06-30T00:00:00Z'),
  deleted_at: null,
  deleted_by: null,
  name_on_document: 'RIVERA RILEY',
  date_of_birth: new Date('1994-03-21T00:00:00Z'),
  document_number_ciphertext: 'v1.secret',
  document_number_last4: '4567',
};

describe('toDocView — what a response carries', () => {
  it('never carries the ciphertext; masks the number; nulls identity details without hrm:edit', () => {
    const hr = toDocView(passport as never, true) as Record<string, unknown>;
    expect(hr).not.toHaveProperty('document_number_ciphertext');
    expect(hr).not.toHaveProperty('document_number_last4');
    expect(hr.document_number_masked).toBe('••••4567');
    expect(hr.name_on_document).toBe('RIVERA RILEY');

    const viewer = toDocView(passport as never, false) as Record<string, unknown>;
    expect(viewer).toMatchObject({ file_url: null, name_on_document: null, date_of_birth: null, document_number_masked: null });
    expect(JSON.stringify(viewer)).not.toContain('secret');
  });
});

describe('saving confirmed ID details', () => {
  it('encrypts the document number, keeps the last four, and never logs the values', async () => {
    const { service, prisma, audit } = make();
    prisma.repDocument.findFirst.mockResolvedValue({ ...passport, name_on_document: null, document_number_ciphertext: null, document_number_last4: null });
    const res = (await service.update(
      'r1',
      'd1',
      { name_on_document: ' Riley Rivera ', date_of_birth: '1994-03-21', document_number: 'ab 123 4567' },
      'hr1',
    )) as Record<string, unknown>;
    const data = prisma.repDocument.update.mock.calls[0][0].data;
    expect(data.name_on_document).toBe('Riley Rivera');
    expect(data.date_of_birth).toEqual(new Date('1994-03-21T00:00:00.000Z'));
    expect(data.document_number_last4).toBe('4567');
    expect(decryptField(data.document_number_ciphertext, KEY)).toBe('AB1234567');
    expect(res.document_number_masked).toBe('••••4567');
    expect(JSON.stringify(res)).not.toContain('AB1234567');
    const logged = JSON.stringify(audit.log.mock.calls[0][0]);
    expect(logged).not.toContain('1234567');
    expect(logged).not.toContain('1994-03-21');
    expect(logged).toContain('"id_details_changed":true');
  });

  it('refuses to store a document number without the encryption key', async () => {
    const { service, prisma } = make(false);
    prisma.repDocument.findFirst.mockResolvedValue(passport);
    await expect(service.update('r1', 'd1', { document_number: 'AB1234567' }, 'hr1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});

describe('dataAccuracy — the comparison', () => {
  const rep = {
    full_name: 'Riley Rivera',
    date_of_birth: new Date('1994-03-21T00:00:00Z'),
    address_street: '1 Main St',
    address_city: 'Winnipeg',
    address_province: 'MB',
    address_postal: 'R3C 0A1',
  };

  it('compares the latest live ID of each kind; a missing value is never a mismatch', async () => {
    const { service, prisma } = make();
    prisma.rep.findUnique.mockResolvedValue(rep);
    prisma.repDocument.findMany.mockResolvedValue([
      { ...passport, id: 'new' },
      { ...passport, id: 'old', name_on_document: 'SOMEONE ELSE' },
      { ...passport, id: 'dl', doc_type: 'drivers_licence', name_on_document: null, date_of_birth: new Date('1995-03-21T00:00:00Z'), document_number_last4: null },
    ]);
    const res = await service.dataAccuracy('r1');
    expect(prisma.repDocument.findMany.mock.calls[0][0].where).toMatchObject({ rep_id: 'r1', deleted_at: null });
    expect(res.profile).toEqual({ name: 'Riley Rivera', date_of_birth: '1994-03-21', address: '1 Main St, Winnipeg, MB, R3C 0A1' });
    expect(res.sources.map((s) => s.document_id)).toEqual(['new', 'dl']);
    const [pass, dl] = res.sources;
    expect(pass.name).toEqual({ value: 'RIVERA RILEY', match: true });
    expect(pass.date_of_birth).toEqual({ value: '1994-03-21', match: true });
    expect(pass.document_number).toEqual({ value: '••••4567', match: null });
    expect(dl.name).toEqual({ value: null, match: null });
    expect(dl.date_of_birth.match).toBe(false);
    expect(res.differences).toBe(1);
    expect(JSON.stringify(res)).not.toContain('secret');
  });
});
