import * as ExcelJS from 'exceljs';
import { ParserService } from './parser.service';
import { UploadedFile } from '../../../common/storage/storage.service';

const file = (buffer: Buffer, originalname: string, mimetype = 'application/octet-stream'): UploadedFile => ({
  buffer,
  originalname,
  mimetype,
  size: buffer.length,
});

async function xlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['Client', 'MPU #', 'Sale Date']);
  ws.addRow(['VF', 'MPU-1', new Date('2026-03-12T00:00:00.000Z')]);
  ws.addRow(['RF', 'MPU-2', new Date('2026-03-13T00:00:00.000Z')]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('ParserService', () => {
  const parser = new ParserService();

  it('parses an .xlsx — first sheet, first row as headers, objects keyed by header', async () => {
    const result = await parser.parse(file(await xlsxBuffer(), 'report.xlsx'));
    expect(result.headers).toEqual(['Client', 'MPU #', 'Sale Date']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].Client).toBe('VF');
    expect(result.rows[0]['MPU #']).toBe('MPU-1');
    expect(result.rows[0]['Sale Date']).toBeInstanceOf(Date); // a Date — the cleaner formats it
  });

  it('parses a .csv with a header row', async () => {
    const csv = 'Client,MPU #,Sale Date\nVF,MPU-1,2026-03-12\nRF,MPU-2,2026-03-13\n';
    const result = await parser.parse(file(Buffer.from(csv), 'report.csv', 'text/csv'));
    expect(result.headers).toEqual(['Client', 'MPU #', 'Sale Date']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1].Client).toBe('RF');
  });

  it('rejects an empty file (422, never a crash)', async () => {
    const csv = 'Client,MPU #\n';
    await expect(parser.parse(file(Buffer.from(csv), 'empty.csv', 'text/csv'))).rejects.toThrow(/no data rows/);
  });

  it('rejects a non-Excel buffer cleanly', async () => {
    await expect(parser.parse(file(Buffer.from('not excel'), 'bad.xlsx'))).rejects.toThrow(/Excel/);
  });
});
