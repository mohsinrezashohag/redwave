# Packet 09 — Admin-configurable export columns

**Do this last.** Depends on packet 02 — do not build configurability around a format that
does not exist yet.

## Goal
Let an admin control exported report columns, so a Redwave format change is a settings change
rather than a dev ticket. Mohsin flagged this himself in the meeting.

## The precedent to mirror
Import already does both halves of this:
- `frontend/src/features/import/templates.ts` — static templates: columns, two example rows, a data dictionary
- `ImportFieldMapping` — server-side saved mappings users create themselves

Build the export equivalent of both.

## The asymmetry — plan for it
- **Client-generated exports** (`frontend/src/features/reports/exportDefs.ts`, `features/sales/saleExport.ts`,
  expense exports) take column arrays. Straightforward to make configurable.
- **Server-rendered Excel** (`statement-excel.renderer.ts`, and packet 02's payroll renderer) is not.
  Those workbooks carry a live `SUBTOTAL` / `COUNTIF` strip above an autofiltered range — column
  **order and identity are load-bearing**. Formulas reference columns positionally.

So: make column **selection, order and label** configurable. Keep the layout engine fixed. When a
configured layout would break a formula reference, reject it with a clear message rather than emitting
a workbook with `#REF!` in it.

## What to build
- `export_layouts` table + dated migration, mirroring `ImportFieldMapping` (scope: report type,
  optional per-client).
- A registry of available fields per report type, the way the import target-field registry works.
- Admin screen: pick fields, order them, rename headers, preview.
- Downloadable **export samples** per report type — the direct analogue of import templates.
- Renderers read the layout; fall back to the built-in default when none is configured.

## Invariants at risk
- **#3** — the field registry for a payroll report must not expose client-rate fields, and vice versa.
  This is where a configurable layout could quietly reunite the two streams. Enforce the split in the
  registry itself, not in the UI.
- **#2** — configuring a layout must not re-render or alter an already-issued document. Issued
  documents keep the layout they were issued with.

## Definition of done
- An admin can add, remove, reorder and rename columns on the sales and expense exports.
- The statement and payroll workbooks accept a configured layout, and reject one that would break the
  SUBTOTAL strip with a named error.
- A re-downloaded historical statement is byte-identical to the original issue.
- The payroll field registry contains no client-rate field. Assert in a spec.
