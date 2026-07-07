import { Decimal } from 'decimal.js';
import { buildExpenseDoc, ExpenseDocRow } from './expense-doc.logic';

const row = (over: Partial<ExpenseDocRow>): ExpenseDocRow => ({
  type: 'meals',
  rep_id: 'r1',
  rep_name: 'Alice',
  date: '2026-01-10',
  description: 'Lunch',
  amount: new Decimal('10.00'),
  ...over,
});

describe('buildExpenseDoc (pure, BILL-013/EXP-014)', () => {
  it('groups one line per (type × rep × day) and sums amounts in a cell', () => {
    const { lines, total_amount } = buildExpenseDoc([
      row({ type: 'meals', rep_id: 'r1', rep_name: 'Alice', date: '2026-01-10', amount: new Decimal('10') }),
      row({ type: 'meals', rep_id: 'r1', rep_name: 'Alice', date: '2026-01-10', amount: new Decimal('15'), description: 'Dinner' }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].amount.toFixed(2)).toBe('25.00'); // 10 + 15 in the same cell
    expect(lines[0].description).toBe('Lunch; Dinner');
    expect(total_amount.toFixed(2)).toBe('25.00');
  });

  it('keeps km and meals as separate lines and totals across all cells', () => {
    const { lines, total_amount } = buildExpenseDoc([
      row({ type: 'km', rep_id: 'r1', rep_name: 'Alice', date: '2026-01-10', amount: new Decimal('60'), description: '100 km' }),
      row({ type: 'meals', rep_id: 'r1', rep_name: 'Alice', date: '2026-01-10', amount: new Decimal('20') }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].type).toBe('km'); // km sorts first
    expect(lines[1].type).toBe('meals');
    expect(total_amount.toFixed(2)).toBe('80.00');
  });

  it('separates cells by rep and by day, sorted type → rep → date', () => {
    const { lines } = buildExpenseDoc([
      row({ type: 'meals', rep_id: 'r2', rep_name: 'Bob', date: '2026-01-11', amount: new Decimal('5') }),
      row({ type: 'meals', rep_id: 'r1', rep_name: 'Alice', date: '2026-01-11', amount: new Decimal('5') }),
      row({ type: 'meals', rep_id: 'r1', rep_name: 'Alice', date: '2026-01-10', amount: new Decimal('5') }),
    ]);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => `${l.rep_name}/${l.date}`)).toEqual([
      'Alice/2026-01-10',
      'Alice/2026-01-11',
      'Bob/2026-01-11',
    ]);
  });

  it('is empty for no rows', () => {
    const { lines, total_amount } = buildExpenseDoc([]);
    expect(lines).toHaveLength(0);
    expect(total_amount.toFixed(2)).toBe('0.00');
  });
});
