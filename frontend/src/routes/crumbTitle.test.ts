import { describe, expect, it } from 'vitest';
import { pageTitle } from './crumbTitle';

describe('pageTitle', () => {
  it('names the page, then its parent, then the app', () => {
    expect(pageTitle(['Administration', 'Reps', 'Riley Rivera'])).toBe('Riley Rivera · Reps · Redwave');
    expect(pageTitle(['Sales'])).toBe('Sales · Redwave');
    expect(pageTitle([])).toBe('Redwave');
    expect(pageTitle(['Reps', null])).toBe('Reps · Redwave'); // record name not loaded yet
  });
});
