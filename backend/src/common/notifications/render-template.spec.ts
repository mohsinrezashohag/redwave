import { renderTemplate } from './render-template';

describe('renderTemplate', () => {
  it('substitutes {var} placeholders from the values map', () => {
    expect(renderTemplate('Sale {sale_code} for {customer}', { sale_code: 'VF-1', customer: 'Ann' }, 'x')).toBe(
      'Sale VF-1 for Ann',
    );
  });

  it('falls back to the call-site text when the template is null/empty', () => {
    expect(renderTemplate(null, { a: '1' }, 'fallback text')).toBe('fallback text');
    expect(renderTemplate('', undefined, 'fallback text')).toBe('fallback text');
  });

  it('leaves an unknown token intact (no vars or missing key)', () => {
    expect(renderTemplate('Hi {name}', undefined, 'f')).toBe('Hi {name}');
    expect(renderTemplate('Hi {name} {missing}', { name: 'Sam' }, 'f')).toBe('Hi Sam {missing}');
  });
});
