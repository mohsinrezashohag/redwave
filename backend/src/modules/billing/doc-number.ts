/**
 * Document-number formatting — the display form of the gapless statement/invoice numbers. The raw integer
 * is stored; this is presentation only. — BRD §8 (numbering scheme)
 */
export const pad5 = (n: number | null | undefined): string => String(n ?? 0).padStart(5, '0');

/** e.g. 1 → "STMT-00001". */
export const statementNo = (n: number | null | undefined): string => `STMT-${pad5(n)}`;

/** e.g. 1 → "INV-00001". */
export const invoiceNo = (n: number | null | undefined): string => `INV-${pad5(n)}`;

/** The client EXPENSE billing document (BILL-012). e.g. 1 → "CEXP-00001". */
export const expenseDocNo = (n: number | null | undefined): string => `CEXP-${pad5(n)}`;
