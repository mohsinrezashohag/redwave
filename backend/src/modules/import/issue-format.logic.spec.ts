import { clientNotFoundIssue, fieldLabel, invalidIssue, missingIssue, quote, repNotFoundIssue, rowIssue } from './issue-format.logic';

describe('import row issues read "<Column>: <problem>. <fix>." (2026-11-28)', () => {
  it('names the column a person sees, never the key', () => {
    expect(fieldLabel('client_code')).toBe('Client');
    expect(fieldLabel('rep_code')).toBe('Rep');
    expect(fieldLabel('some_new_field')).toBe('Some new field');
  });

  it('builds the standard sentence, adding the full stops once', () => {
    expect(rowIssue('status', '"done" is not valid', 'Use entered or validated')).toBe('Status: "done" is not valid. Use entered or validated.');
    expect(rowIssue('status', 'already ends.', 'So does this.')).toBe('Status: already ends. So does this.');
    expect(rowIssue('status', 'no fix given')).toBe('Status: no fix given.');
  });

  it('quotes the value the file actually held', () => {
    expect(quote('VF')).toBe('"VF"');
    expect(quote('  ')).toBe('(blank)');
    expect(missingIssue('sale_date', '2026-11-24')).toBe('Sale date: missing. Fill in the sale date (for example 2026-11-24).');
    expect(invalidIssue('sale_date', 'date', '45/99/2026')).toBe('Sale date: "45/99/2026" is not a valid date. Use YYYY-MM-DD, for example 2026-11-24.');
    expect(clientNotFoundIssue('XX')).toBe('Client: "XX" was not found. Add the client under Clients, or fix the code.');
    expect(repNotFoundIssue('Abdul Malak')).toBe('Rep: "Abdul Malak" was not found among active reps. Add the rep, or use their rep code or partner code.');
  });
});
