/**
 * Documents helpers for the signing page and the field placer (2026-11-16): reading order for "Next field",
 * human field labels (the API has none), and the "recipient has no signature box" warning.
 */
import { describe, expect, it } from 'vitest';
import { fieldLabels, orderFields, recipientsWithoutSignature } from './documents.logic';

const f = (id: string, type: 'signature' | 'initial' | 'date' | 'text', page: number, x = '0.1', y = '0.1') => ({ id, type, page, x, y });

describe('orderFields', () => {
  it('orders by page, then top to bottom, then left to right', () => {
    const out = orderFields([f('c', 'text', 1, '0.1', '0.1'), f('b', 'date', 0, '0.6', '0.5'), f('a', 'signature', 0, '0.1', '0.5'), f('z', 'initial', 0, '0.9', '0.05')]);
    expect(out.map((x) => x.id)).toEqual(['z', 'a', 'b', 'c']);
  });
});

describe('fieldLabels', () => {
  it('names a field by type and 1-based page, numbering repeats on the same page', () => {
    const labels = fieldLabels([f('1', 'text', 0), f('2', 'text', 0), f('3', 'text', 2), f('4', 'signature', 0), f('5', 'initial', 1)]);
    expect(labels).toEqual({
      '1': 'Text on page 1 (1)',
      '2': 'Text on page 1 (2)',
      '3': 'Text on page 3',
      '4': 'Signature on page 1',
      '5': 'Initials on page 2',
    });
  });
});

describe('recipientsWithoutSignature', () => {
  it('flags a recipient with only a date/text box', () => {
    const fields = [
      { recipient_user_id: 'a', type: 'signature' },
      { recipient_user_id: 'b', type: 'date' },
    ];
    expect(recipientsWithoutSignature(['a', 'b', 'c'], fields)).toEqual(['b', 'c']);
  });

  it('accepts initials as a signature box', () => {
    expect(recipientsWithoutSignature(['a'], [{ recipient_user_id: 'a', type: 'initial' }])).toEqual([]);
  });

  it('no placed fields at all is a plain click-to-sign request, not a warning', () => {
    expect(recipientsWithoutSignature(['a', 'b'], [])).toEqual([]);
  });
});
