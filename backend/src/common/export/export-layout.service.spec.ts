/**
 * ExportLayoutService — saved column layouts, and the two properties that keep them safe.
 *
 *   #3 — a layout can only name fields its OWN report owns. Enforced by the registry and re-checked here
 *        at write time, so "add the client rate to the payroll export" is rejected rather than discouraged.
 *   #2 — an issued document keeps the layout it was ISSUED with. Changing a layout today can never alter a
 *        historical statement, which is what makes a re-download byte-identical to the original.
 *
 * Per §14 rule 10: if one of these fails, an invariant broke — fix the code, not the spec.
 */
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ExportLayoutService } from './export-layout.service';
import { defaultLayout } from './export-fields.registry';

function make(opts: { layouts?: unknown[] } = {}) {
  const prisma = {
    exportLayout: {
      findMany: jest.fn().mockResolvedValue(opts.layouts ?? []),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'layout-1', ...data }),
      ),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'layout-1', columns: [], ...data }),
      ),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  return { service: new ExportLayoutService(prisma as never, audit as never), prisma, audit };
}

const user = { id: 'admin-1' } as never;
const payrollCols = defaultLayout('payroll');

describe('saving a layout', () => {
  it('stores a valid layout and audits it', async () => {
    const { service, prisma, audit } = make();
    await service.save({ name: 'Standard', report_type: 'payroll', columns: payrollCols }, user);
    expect(prisma.exportLayout.create).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'export_layouts' }));
  });

  // #3 — the boundary, enforced at write time rather than merely hidden from a picker.
  it('REJECTS a payroll layout naming a client-billing field', async () => {
    const { service, prisma } = make();
    await expect(
      service.save(
        { name: 'Sneaky', report_type: 'payroll', columns: [...payrollCols, { field: 'line_total' }] },
        user,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.exportLayout.create).not.toHaveBeenCalled();
  });

  // Validation runs BEFORE the write, so a download never fails in front of whoever needed the file.
  it('rejects an unrenderable layout without writing it', async () => {
    const { service, prisma } = make();
    await expect(
      service.save(
        { name: 'Broken', report_type: 'payroll', columns: payrollCols.filter((c) => c.field !== 'total_100') },
        user,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.exportLayout.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown report type', async () => {
    const { service } = make();
    await expect(
      service.save({ name: 'X', report_type: 'margin', columns: [{ field: 'sale_date' }] }, user),
    ).rejects.toThrow(/unknown report type/);
  });
});

describe('resolving the layout to use now', () => {
  it('falls back to the built-in default when nothing is configured', async () => {
    const { service } = make({ layouts: [] });
    const resolved = await service.resolve('payroll');
    expect(resolved.id).toBeNull();
    expect(resolved.columns).toEqual(defaultLayout('payroll'));
  });

  it("prefers a client's own layout over the report-wide one", async () => {
    const trimmed = payrollCols.filter((c) => c.field !== 'address');
    const { service } = make({
      layouts: [
        { id: 'global', client_id: null, columns: payrollCols, created_at: new Date() },
        { id: 'vf', client_id: 'client-vf', columns: trimmed, created_at: new Date() },
      ],
    });
    expect((await service.resolve('payroll', 'client-vf')).id).toBe('vf');
    expect((await service.resolve('payroll', 'client-other')).id).toBe('global');
  });

  // A retired field would otherwise emit a broken workbook at download time.
  it('falls back to the default when a STORED layout no longer validates', async () => {
    const { service } = make({
      layouts: [{ id: 'stale', client_id: null, columns: [{ field: 'a_field_that_no_longer_exists' }], created_at: new Date() }],
    });
    const resolved = await service.resolve('payroll');
    expect(resolved.id).toBeNull();
    expect(resolved.columns).toEqual(defaultLayout('payroll'));
  });

  it('survives a malformed stored column list rather than crashing a render', async () => {
    const { service } = make({
      layouts: [{ id: 'junk', client_id: null, columns: 'not-an-array', created_at: new Date() }],
    });
    expect((await service.resolve('payroll')).columns).toEqual(defaultLayout('payroll'));
  });
});

/**
 * #2 — the property the packet's definition of done names: "a re-downloaded historical statement is
 * byte-identical to the original issue."
 */
describe('an issued document keeps the layout it was ISSUED with', () => {
  it('a document with NO frozen layout re-renders with the built-in default', async () => {
    const { service } = make();
    // Every statement issued before layouts existed carries null — so it re-renders exactly as issued.
    expect(await service.resolveFrozen('statement', null)).toEqual(defaultLayout('statement'));
  });

  it('a document re-renders with ITS OWN frozen layout, not whatever is configured today', async () => {
    const frozen = defaultLayout('statement').filter((c) => c.field !== 'address');
    const { service, prisma } = make({
      // Today's active layout is different — and must not be used for this document.
      layouts: [{ id: 'todays', client_id: null, columns: defaultLayout('statement'), created_at: new Date() }],
    });
    prisma.exportLayout.findUnique.mockResolvedValue({ id: 'issued-with', columns: frozen });

    const rendered = await service.resolveFrozen('statement', 'issued-with');
    expect(rendered).toEqual(frozen);
    expect(rendered.some((c) => c.field === 'address')).toBe(false);
  });

  it('a deleted frozen layout still renders — falls back rather than failing a historical download', async () => {
    const { service, prisma } = make();
    prisma.exportLayout.findUnique.mockResolvedValue(null);
    expect(await service.resolveFrozen('statement', 'gone')).toEqual(defaultLayout('statement'));
  });

  // Deactivating rather than deleting is what keeps a referencing document reproducible.
  it('deactivates rather than deletes', async () => {
    const { service, prisma } = make();
    prisma.exportLayout.findUnique.mockResolvedValue({ id: 'layout-1', is_active: true, columns: [] });
    await service.deactivate('layout-1', user);
    expect(prisma.exportLayout.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { is_active: false } }),
    );
  });

  it('404s an unknown layout', async () => {
    const { service } = make();
    await expect(service.deactivate('nope', user)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('the registry surface', () => {
  it('exposes every report with its fields, default layout and sample row', () => {
    const { service } = make();
    const registry = service.registry();
    expect(registry.map((r) => r.report_type).sort()).toEqual(['expenses', 'payroll', 'sales', 'statement']);
    const payroll = registry.find((r) => r.report_type === 'payroll')!;
    expect(payroll.has_formula_strip).toBe(true);
    expect(payroll.default_columns.length).toBeGreaterThan(0);
    expect(Object.keys(payroll.sample_row)).toContain('total_100');
    // The boundary is visible in what the picker can even offer.
    expect(payroll.fields.map((f) => f.key)).not.toContain('line_total');
  });
});
