import { describe, expect, it } from 'vitest';
import { AVATAR_PRESETS, presetFromUrl } from './avatarPresets';

describe('presetFromUrl', () => {
  it('maps the server photo URL back to the chosen preset', () => {
    expect(AVATAR_PRESETS).toHaveLength(3);
    expect(presetFromUrl('/avatars/wave.svg')).toBe('preset:wave');
    expect(presetFromUrl('https://app.example.ca/avatars/summit.svg')).toBe('preset:summit');
    expect(presetFromUrl('https://signed/avatars/2026/11/a.jpg')).toBeNull();
    expect(presetFromUrl(null)).toBeNull();
  });
});
