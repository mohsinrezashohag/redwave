import { describe, expect, it } from 'vitest';
import { profileFieldLabel, profileFieldValue } from './profileFields';

describe('profile change display', () => {
  it('a photo change reads as words, never a storage path', () => {
    expect(profileFieldLabel('avatar_url')).toBe('Photo');
    expect(profileFieldValue('avatar_url', 'avatars/2026/11/a.jpg')).toBe('New photo');
    expect(profileFieldValue('avatar_url', '')).toBe('Removed');
  });
  it('other fields show their value, or a dash when blank', () => {
    expect(profileFieldValue('phone', '204 555 0142')).toBe('204 555 0142');
    expect(profileFieldValue('phone', '')).toBe('—');
  });
});
