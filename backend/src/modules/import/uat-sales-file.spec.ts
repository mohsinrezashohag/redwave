/**
 * End-to-end regression for the file that exposed the defect: `docs/uat/Sales Upload.xlsx`.
 *
 * That workbook is 16 historical-sales rows whose `Product type` column reads `Internet`,
 * `Internet, TV` or `Internet, TV, Home Phone` — human spelling, sometimes several types in one cell.
 * Before the value-vocabulary layer, ALL 16 classified as `error` ("no Internet, TV product for client VF")
 * and the reconcile gate refused the commit.
 *
 * This spec rebuilds that exact shape as a real .xlsx and drives the whole parse → map → clean → classify
 * path, so the bug cannot come back. The expected totals are measured from the real file:
 * **16 rows → 23 sale_items → Σ billed 5880.00**.
 */
import * as ExcelJS from 'exceljs';
import { ParserService } from './parsing/parser.service';
import { UploadedFile } from '../../common/storage/storage.service';
import { applyMapping, RawRow } from './mapping.logic';
import { cleanMappedRow } from './clean.logic';
import { suggestMapping } from './suggest-mapping.logic';
import { fieldTypesFor, TARGET_FIELDS } from './target-fields';
import { classifyHistoricalSaleRow } from './matching.logic';
import { buildProductTypeVocab, resolveVocabValue } from './value-vocabulary.logic';
import { groupIssues } from './group-issues.logic';
import { evaluateGate } from './reconcile-gate.logic';

/** The seeded catalogue (bootstrap): key + human label + behaviour. */
const CATALOGUE = [
  { key: 'internet', label: 'Internet', behaviour: 'tiered' },
  { key: 'tv', label: 'TV', behaviour: 'standard_addon' },
  { key: 'home_phone', label: 'Home Phone', behaviour: 'standard_addon' },
  { key: 'greenfield_internet', label: 'Greenfield Internet', behaviour: 'greenfield' },
];
const VOCAB = buildProductTypeVocab(CATALOGUE);

/** The real column headers, verbatim. */
const HEADERS = ['Client code', 'Rep code', 'Product type', 'Sale date', 'Activation date', 'Billed amount', 'Customer', 'MPU ID', 'Greenfield'];

/**
 * The real `Product type` / `Billed amount` pairs, in file order and verbatim — 11 × Internet (one of them
 * $280, not $350), 3 × Internet+TV, 2 × Internet+TV+Home Phone. Copied rather than generated so the totals
 * below are the file's own, not a formula that could drift with it.
 */
const ROWS: [string, number][] = [
  ['Internet, TV', 400],
  ['Internet', 350],
  ['Internet', 350],
  ['Internet', 350],
  ['Internet', 350],
  ['Internet', 350],
  ['Internet', 350],
  ['Internet', 350],
  ['Internet, TV', 400],
  ['Internet, TV, Home Phone', 450],
  ['Internet', 350],
  ['Internet, TV, Home Phone', 450],
  ['Internet', 280],
  ['Internet', 350],
  ['Internet, TV', 400],
  ['Internet', 350],
];

async function uatWorkbook(): Promise<UploadedFile> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Historical Sales');
  ws.addRow(HEADERS);
  ROWS.forEach(([productType, amount], i) => {
    ws.addRow([
      'VF',
      `RW-D-000${(i % 7) + 1}`,
      productType,
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-06-01T00:00:00.000Z'),
      amount,
      `Customer ${i + 1}`,
      `VF-10${42 + i}`,
      'false',
    ]);
  });
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, originalname: 'Sales Upload.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: buffer.length };
}

describe('UAT file — docs/uat/Sales Upload.xlsx (historical sales)', () => {
  const parser = new ParserService();
  const fields = TARGET_FIELDS['master_migration:sales'];
  const types = fieldTypesFor('master_migration', 'sales');

  /** The service's real pipeline, with the DB lookups stubbed to a seeded VF that has all four products. */
  async function run() {
    const parsed = await parser.parse(await uatWorkbook(), { expectedFields: fields });
    const mapping = suggestMapping(parsed.headers, fields);
    const mappedRows = parsed.rows.map((raw) => cleanMappedRow(applyMapping(raw as RawRow, mapping), types));
    const classifications = mappedRows.map((row) => {
      // Mirrors `ImportService.classifyHistoricalSales`: resolve, write back, classify.
      const resolved = resolveVocabValue(row.product_types, VOCAB);
      if (resolved.keys.length > 0 && resolved.unknown.length === 0) {
        row.product_types = resolved.keys.join(',');
      }
      return classifyHistoricalSaleRow(row, {
        clientExists: true,
        repExists: true,
        unknownProductTypes: resolved.unknown,
        resolvedCount: resolved.keys.length,
        suggestion: resolved.suggestion,
        missingProductTypes: [], // VF stocks all four catalogue types
      });
    });
    return { parsed, mapping, mappedRows, classifications };
  }

  it('parses the sheet and auto-maps every column with nothing left over', async () => {
    const { parsed, mapping } = await run();
    expect(parsed.sheet).toBe('Historical Sales');
    expect(parsed.headerRow).toBe(1);
    expect(parsed.rows).toHaveLength(16);
    expect(fields.filter((f) => f.required && !mapping[f.field])).toEqual([]);
    expect(mapping.product_types).toBe('Product type'); // the singular header still maps
    expect(mapping.billed_amount).toBe('Billed amount');
  });

  it('cleans dates, money and codes as the pipeline promises', async () => {
    const { mappedRows } = await run();
    expect(mappedRows[0].sale_date).toBe('2026-06-01'); // the cell's own day — no timezone drift (#7)
    expect(mappedRows[0].billed_amount).toBe('400.00'); // exact decimal string (#1) — row 1 is Internet+TV
    expect(mappedRows[1].billed_amount).toBe('350.00');
    expect(mappedRows[0].client_code).toBe('VF'); // UPPER-cased
    expect(mappedRows[0].is_greenfield).toBe('false'); // the new `bool` type
  });

  it('THE REGRESSION: all 16 rows classify as matched (they were all `error`)', async () => {
    const { classifications } = await run();
    expect(classifications).toHaveLength(16);
    expect(classifications.filter((c) => c.match_status === 'matched')).toHaveLength(16);
    expect(classifications.filter((c) => c.match_status === 'error')).toHaveLength(0);
  });

  it('canonicalises each cell shape into catalogue keys', async () => {
    const { mappedRows } = await run();
    const distinct = [...new Set(mappedRows.map((r) => String(r.product_types)))].sort();
    expect(distinct).toEqual(['internet', 'internet,tv', 'internet,tv,home_phone']);
  });

  it('the reconcile gate now ALLOWS the commit', async () => {
    const { classifications } = await run();
    const rows = classifications.map((c, i) => ({ row_number: i + 1, match_status: c.match_status, issue: c.issue }));
    expect(groupIssues(rows)).toEqual([]); // nothing needs attention
    expect(evaluateGate(rows.map((r) => ({ match_status: r.match_status as never }))).ok).toBe(true);
  });

  it('produces 23 sale_items across 16 sales, and Σ billed is exactly the file total', async () => {
    const { mappedRows } = await run();
    const itemCount = mappedRows.reduce((n, r) => n + String(r.product_types).split(',').length, 0);
    expect(itemCount).toBe(23); // 11×1 + 3×2 + 2×3

    // The amount is recorded ONCE per row (on the base item), so the sale total is the row total (#1/#3).
    const total = mappedRows.reduce((sum, r) => sum + Number(r.billed_amount), 0);
    expect(total.toFixed(2)).toBe('5880.00');
  });

  it('an unknown type is reported as ONE actionable group, and still blocks the commit', async () => {
    const parsed = await parser.parse(await uatWorkbook(), { expectedFields: fields });
    const mapping = suggestMapping(parsed.headers, fields);
    const mappedRows = parsed.rows.map((raw) => cleanMappedRow(applyMapping(raw as RawRow, mapping), types));
    for (const row of mappedRows) row.product_types = 'Fibre Optic'; // a type nobody stocks

    const classifications = mappedRows.map((row) => {
      const resolved = resolveVocabValue(row.product_types, VOCAB);
      return classifyHistoricalSaleRow(row, {
        clientExists: true,
        repExists: true,
        unknownProductTypes: resolved.unknown,
        resolvedCount: resolved.keys.length,
        suggestion: resolved.suggestion,
        missingProductTypes: [],
      });
    });
    const rows = classifications.map((c, i) => ({ row_number: i + 1, match_status: c.match_status, issue: c.issue }));

    const groups = groupIssues(rows);
    expect(groups).toHaveLength(1); // ONE problem, not 16
    expect(groups[0].count).toBe(16);
    expect(groups[0].sample_issue).toContain('unknown product type');
    // …and it must NOT send the operator off to re-import their product master.
    expect(groups[0].sample_issue).not.toContain('import products first');
    expect(evaluateGate(rows.map((r) => ({ match_status: r.match_status as never }))).ok).toBe(false);
  });
});
