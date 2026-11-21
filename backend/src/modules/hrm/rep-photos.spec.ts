/** Rep photo export (client meeting 2026-11-16): ZIP format, naming, skipped reps, audit. */
import { buildZip, crc32 } from './zip.logic';
import { photoFileName, RepPhotosService, safeNamePart } from './rep-photos.service';

/** Read a STORED zip back (enough to prove the structure is valid). */
function readZip(zip: Buffer): { name: string; data: Buffer }[] {
  const eocd = zip.length - 22;
  expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
    const localNameLen = zip.readUInt16LE(offset + 26);
    const data = zip.subarray(offset + 30 + localNameLen, offset + 30 + localNameLen + size);
    expect(crc32(Buffer.from(data))).toBe(crc);
    out.push({ name, data: Buffer.from(data) });
    p += 46 + nameLen;
  }
  return out;
}

describe('zip.logic', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips entries (STORED)', () => {
    const zip = buildZip(
      [
        { name: 'a.txt', data: Buffer.from('hello') },
        { name: 'é.jpg', data: Buffer.from([1, 2, 3]) },
      ],
      new Date('2026-11-16T12:00:00Z'),
    );
    expect(readZip(zip)).toEqual([
      { name: 'a.txt', data: Buffer.from('hello') },
      { name: 'é.jpg', data: Buffer.from([1, 2, 3]) },
    ]);
  });
});

describe('photo file names', () => {
  it('sanitizes and de-duplicates', () => {
    expect(safeNamePart('José O’Neil / Jr.')).toBe('Jose-O-Neil-Jr');
    const taken = new Set<string>();
    expect(photoFileName('REDWAVE2', 'Sam Field', 'jpg', taken)).toBe('REDWAVE2-Sam-Field.jpg');
    expect(photoFileName('REDWAVE2', 'Sam Field', 'jpg', taken)).toBe('REDWAVE2-Sam-Field-2.jpg');
  });
});

describe('RepPhotosService.exportZip', () => {
  function make() {
    const prisma = {
      rep: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r10', rep_code: 'REDWAVE10', full_name: 'Ten Rep' },
          { id: 'r2', rep_code: 'REDWAVE2', full_name: 'Two Rep' },
          { id: 'r3', rep_code: 'REDWAVE3', full_name: 'No Photo' },
          { id: 'r4', rep_code: 'REDWAVE4', full_name: 'Broken Photo' },
        ]),
      },
      repDocument: {
        findMany: jest.fn().mockResolvedValue([
          { rep_id: 'r2', file_url: 'rep-docs/new.png' },
          { rep_id: 'r2', file_url: 'rep-docs/old.jpg' },
          { rep_id: 'r10', file_url: 'rep-docs/ten.jpeg' },
          { rep_id: 'r4', file_url: 'rep-docs/gone.jpg' },
        ]),
      },
    };
    const audit = { log: jest.fn() };
    const storage = {
      assertConfigured: jest.fn(),
      download: jest.fn(async (path: string) => (path === 'rep-docs/gone.jpg' ? null : Buffer.from(path))),
    };
    return { service: new RepPhotosService(prisma as never, audit as never, storage as never), prisma, audit, storage };
  }

  it('zips the latest live headshot per rep, in natural code order, and lists skipped reps', async () => {
    const { service, prisma, audit, storage } = make();
    const file = await service.exportZip({}, 'admin-1', new Date('2026-11-16T15:00:00Z'));
    expect(file.filename).toBe('redwave-rep-photos-2026-11-16.zip');
    expect(prisma.rep.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'active' } }));
    expect(prisma.repDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ doc_type: 'headshot', deleted_at: null }) }),
    );
    expect(storage.download).not.toHaveBeenCalledWith('rep-docs/old.jpg');
    const entries = readZip(file.bytes);
    expect(entries.map((e) => e.name)).toEqual(['REDWAVE2-Two-Rep.png', 'REDWAVE10-Ten-Rep.jpg', 'manifest.txt']);
    const manifest = entries[2].data.toString('utf8');
    expect(manifest).toMatch(/2 photo\(s\) included, 2 rep\(s\) skipped/);
    expect(manifest).toMatch(/REDWAVE3 {2}No Photo {2}\(no photo on file\)/);
    expect(manifest).toMatch(/REDWAVE4 {2}Broken Photo {2}\(the photo file could not be read\)/);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'export_photos', after: expect.objectContaining({ included: 2, skipped: 2 }) }));
  });

  it('applies the list filters', async () => {
    const { service, prisma } = make();
    await service.exportZip({ status: 'all', fieldManagerId: 'm1', search: 'two' }, 'admin-1');
    expect(prisma.rep.findMany.mock.calls[0][0].where).toEqual({
      field_manager_id: 'm1',
      OR: [
        { full_name: { contains: 'two', mode: 'insensitive' } },
        { rep_code: { contains: 'two', mode: 'insensitive' } },
      ],
    });
  });
});
