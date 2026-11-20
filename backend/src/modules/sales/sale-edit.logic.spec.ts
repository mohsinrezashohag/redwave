import { diffSaleChanges, editWindowEndsOn, isSaleEditable } from './sale-edit.logic';

describe('sale edit window (5 days, Winnipeg), 2026-11-16', () => {
  // 2026-11-10 23:30 Winnipeg (CST) = 2026-11-11 05:30 UTC: the Winnipeg day is the 10th.
  const lateNight = new Date('2026-11-11T05:30:00.000Z');

  it('counts from the Winnipeg day of entry, not the UTC day', () => {
    expect(editWindowEndsOn(lateNight)).toBe('2026-11-15');
  });

  it('is inclusive of the last day and closed the day after', () => {
    expect(isSaleEditable('entered', lateNight, '2026-11-15')).toBe(true);
    expect(isSaleEditable('entered', lateNight, '2026-11-16')).toBe(false);
  });

  it('only entered or validated sales are ever editable', () => {
    expect(isSaleEditable('validated', lateNight, '2026-11-12')).toBe(true);
    for (const status of ['in_pay_run', 'paid', 'clawed_back', 'historical', 'deleted']) {
      expect(isSaleEditable(status, lateNight, '2026-11-12')).toBe(false);
    }
  });
});

describe('diffSaleChanges', () => {
  const current = {
    customer_name: 'Jane Doe',
    customer_first_name: 'Jane',
    customer_last_name: 'Doe',
    street: '1 St',
    city: 'Winnipeg',
    province_state: 'MB',
    postal_code: 'R0R0R0',
    activation_date: new Date('2026-11-12T00:00:00.000Z'),
    is_greenfield: false,
    product_ids: ['p1', 'p2'],
  };

  it('keeps only what differs', () => {
    expect(
      diffSaleChanges(current, {
        street: '1 St',
        city: 'Brandon',
        activation_date: '2026-11-12',
        items: [{ product_id: 'p2' }, { product_id: 'p1' }],
        is_greenfield: false,
      }),
    ).toEqual({ city: 'Brandon' });
  });

  it('records a cleared optional field as null and a changed product list as ids', () => {
    expect(
      diffSaleChanges(current, { customer_last_name: '', activation_date: '', items: [{ product_id: 'p1' }] }),
    ).toEqual({ customer_last_name: null, activation_date: null, items: ['p1'] });
  });
});
