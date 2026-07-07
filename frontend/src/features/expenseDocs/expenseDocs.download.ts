/**
 * Expense-document file downloads/exports — thin wrappers over `lib/api/downloadFile`. Download (GET,
 * billing:view) re-renders the PDF from the frozen record; export (POST, billing:export) additionally records
 * a billing_exports artifact. Both stream the PDF as an attachment. — arch §6.9 / SRS BILL-012
 */
import { downloadFile } from '../../lib/api/downloadFile';

/** The display number CEXP-00001 (mirrors backend doc-number.ts). */
export const expenseDocNo = (n: number | null | undefined): string => `CEXP-${String(n ?? 0).padStart(5, '0')}`;

/** Re-download the expense document PDF (billing:view). */
export const downloadExpenseDocPdf = (id: string) => downloadFile(`/v1/expense-documents/${id}/download`);

/** Export the expense document PDF as a recorded artifact (billing:export). */
export const exportExpenseDocPdf = (id: string) => downloadFile(`/v1/expense-documents/${id}/export`, { method: 'POST' });
