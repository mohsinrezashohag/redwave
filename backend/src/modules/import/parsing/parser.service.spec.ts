import * as ExcelJS from 'exceljs';
import { ParserService } from './parser.service';
import { UploadedFile } from '../../../common/storage/storage.service';
import { TARGET_FIELDS } from '../target-fields';

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

  // ── Real partner files are rarely a bare grid: they carry title banners and extra tabs. ──
  describe('awkward but relevant layouts', () => {
    const SALES_FIELDS = TARGET_FIELDS['master_migration:sales'];

    async function workbook(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
      const wb = new ExcelJS.Workbook();
      build(wb);
      return Buffer.from(await wb.xlsx.writeBuffer());
    }

    function addSalesSheet(wb: ExcelJS.Workbook, name: string): void {
      const ws = wb.addWorksheet(name);
      ws.addRow(['Client code', 'Rep code', 'Product type', 'Sale date', 'Billed amount']);
      ws.addRow(['VF', 'RW-D-0001', 'Internet, TV', new Date('2026-06-01T00:00:00.000Z'), 400]);
    }

    it('skips a title banner and blank rows above the real header', async () => {
      const buf = await workbook((wb) => {
        const ws = wb.addWorksheet('Data');
        ws.addRow(['Valley Fiber — Historical Sales Export']); // title banner
        ws.addRow([]); // blank
        ws.addRow(['Generated 2026-07-01']); // export stamp
        ws.addRow(['Client code', 'Rep code', 'Product type', 'Sale date', 'Billed amount']);
        ws.addRow(['VF', 'RW-D-0001', 'Internet', new Date('2026-06-01T00:00:00.000Z'), 350]);
      });
      const result = await parser.parse(file(buf, 'export.xlsx'), { expectedFields: SALES_FIELDS });
      expect(result.headerRow).toBe(4);
      expect(result.headers).toEqual(['Client code', 'Rep code', 'Product type', 'Sale date', 'Billed amount']);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]['Client code']).toBe('VF');
    });

    it('picks the data sheet over an Instructions tab that comes first', async () => {
      const buf = await workbook((wb) => {
        const instructions = wb.addWorksheet('Instructions');
        instructions.addRow(['How to use this template']);
        instructions.addRow(['Fill in one row per household, then send to Redwave.']);
        addSalesSheet(wb, 'Historical Sales');
      });
      const result = await parser.parse(file(buf, 'template.xlsx'), { expectedFields: SALES_FIELDS });
      expect(result.sheet).toBe('Historical Sales');
      expect(result.sheets).toEqual(['Instructions', 'Historical Sales']);
      expect(result.rows).toHaveLength(1);
    });

    it('an explicitly requested sheet always wins', async () => {
      const buf = await workbook((wb) => {
        addSalesSheet(wb, 'Historical Sales');
        const other = wb.addWorksheet('Last Year');
        other.addRow(['Client code', 'Rep code', 'Product type', 'Sale date', 'Billed amount']);
        other.addRow(['RF', 'RW-D-0002', 'Internet', new Date('2025-06-01T00:00:00.000Z'), 300]);
      });
      const result = await parser.parse(file(buf, 'two-years.xlsx'), { sheet: 'Last Year', expectedFields: SALES_FIELDS });
      expect(result.sheet).toBe('Last Year');
      expect(result.rows[0]['Client code']).toBe('RF');
    });

    it('names the available sheets when the requested one is absent', async () => {
      const buf = await workbook((wb) => addSalesSheet(wb, 'Historical Sales'));
      await expect(parser.parse(file(buf, 'x.xlsx'), { sheet: 'Nope' })).rejects.toThrow(/Historical Sales/);
    });

    it('lists every sheet without parsing rows', async () => {
      const buf = await workbook((wb) => {
        wb.addWorksheet('Instructions').addRow(['hi']);
        addSalesSheet(wb, 'Historical Sales');
      });
      expect(await parser.listSheets(file(buf, 'x.xlsx'))).toEqual(['Instructions', 'Historical Sales']);
    });

    it('skips a title banner in a CSV too', async () => {
      const csv = 'Valley Fiber Export\n\nClient code,Rep code,Product type,Sale date,Billed amount\nVF,RW-D-0001,Internet,2026-06-01,350\n';
      const result = await parser.parse(file(Buffer.from(csv), 'export.csv', 'text/csv'), { expectedFields: SALES_FIELDS });
      expect(result.headers).toEqual(['Client code', 'Rep code', 'Product type', 'Sale date', 'Billed amount']);
      expect(result.rows).toHaveLength(1);
    });

    it('with no expected fields it still takes the first non-empty row (unchanged default)', async () => {
      const result = await parser.parse(file(await xlsxBuffer(), 'report.xlsx'));
      expect(result.headerRow).toBe(1);
      expect(result.headers).toEqual(['Client', 'MPU #', 'Sale Date']);
    });
  });
});
