import { suggestMapping } from './suggest-mapping.logic';
import { TARGET_FIELDS } from './target-fields';

describe('suggest-mapping.logic', () => {
  it('matches headers to fields by exact alias / contains / token overlap', () => {
    const fields = TARGET_FIELDS['master_migration:sales'];
    const headers = ['Client', 'Agent Code', 'Service', 'Sale Date', 'Billed Amount', 'Customer Name'];
    const mapping = suggestMapping(headers, fields);
    expect(mapping.client_code).toBe('Client');
    expect(mapping.rep_code).toBe('Agent Code');
    expect(mapping.product_type).toBe('Service');
    expect(mapping.sale_date).toBe('Sale Date');
    expect(mapping.billed_amount).toBe('Billed Amount');
    expect(mapping.customer_name).toBe('Customer Name');
  });

  it('does not reuse a source column for two fields, and omits unmatched fields', () => {
    const fields = TARGET_FIELDS['master_migration:clients'];
    const mapping = suggestMapping(['Code', 'Name'], fields);
    expect(mapping.client_code).toBe('Code');
    expect(mapping.name).toBe('Name');
    const cols = Object.values(mapping);
    expect(new Set(cols).size).toBe(cols.length); // no column used twice
    expect(mapping.market).toBeUndefined(); // no matching header → omitted
  });

  it('matches the MPU column for a client report', () => {
    const fields = TARGET_FIELDS['client_report:sales'];
    expect(suggestMapping(['MPU #', 'Subscriber'], fields).mpu_id).toBe('MPU #');
  });
});
