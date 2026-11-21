import { describe, expect, it } from 'vitest';
import { joinDistinct, sameLabel } from './text';

describe('sameLabel', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(sameLabel('TV', 'tv')).toBe(true);
    expect(sameLabel('Home Phone', 'home-phone')).toBe(true);
    expect(sameLabel('Internet', 'Internet')).toBe(true);
  });
  it('treats different labels and blanks as different', () => {
    expect(sameLabel('AURORA 500', 'Internet')).toBe(false);
    expect(sameLabel(null, 'TV')).toBe(false);
    expect(sameLabel('', '')).toBe(false);
  });
});

describe('joinDistinct', () => {
  it('drops blanks and repeats', () => {
    expect(joinDistinct(['TV', 'tv'])).toBe('TV');
    expect(joinDistinct(['AURORA 500', null, 'Internet', ' '])).toBe('AURORA 500 · Internet');
  });
});
