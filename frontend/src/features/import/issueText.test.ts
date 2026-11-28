import { describe, expect, it } from 'vitest';
import { splitIssue } from './issueText';

describe('splitIssue', () => {
  it('splits a standard issue into column and message', () => {
    expect(splitIssue('Rep: "Abdul Malak" was not found among active reps. Add the rep.')).toEqual({
      column: 'Rep',
      message: '"Abdul Malak" was not found among active reps. Add the rep.',
    });
    expect(splitIssue('Product types: no internet on this sale.').column).toBe('Product types');
  });

  it('leaves other text alone', () => {
    expect(splitIssue('Will create client VF when you commit.')).toEqual({ column: null, message: 'Will create client VF when you commit.' });
    expect(splitIssue('client VF not found').column).toBeNull();
  });
});
