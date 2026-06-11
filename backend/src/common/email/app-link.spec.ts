import { appLink, DEV_APP_BASE_URL, resolveAppBaseUrl } from './app-link';

describe('resolveAppBaseUrl — APP_BASE_URL canonical, APP_URL legacy alias, NO prod default', () => {
  it('dev with nothing set → the localhost Vite default (zero local setup)', () => {
    expect(resolveAppBaseUrl({})).toEqual({ baseUrl: DEV_APP_BASE_URL, source: 'dev-default' });
    expect(resolveAppBaseUrl({ NODE_ENV: 'development' })).toEqual({ baseUrl: DEV_APP_BASE_URL, source: 'dev-default' });
  });

  it('PRODUCTION with nothing set → null (the fail-safe; never a localhost default)', () => {
    expect(resolveAppBaseUrl({ NODE_ENV: 'production' })).toEqual({ baseUrl: null, source: null });
  });

  it('APP_BASE_URL wins and is normalized (trailing slashes stripped, value trimmed)', () => {
    expect(resolveAppBaseUrl({ NODE_ENV: 'production', APP_BASE_URL: ' https://app.redwavemarketing.ca/// ' })).toEqual({
      baseUrl: 'https://app.redwavemarketing.ca',
      source: 'APP_BASE_URL',
    });
  });

  it('legacy APP_URL is honored as a deprecated alias when APP_BASE_URL is unset', () => {
    expect(resolveAppBaseUrl({ NODE_ENV: 'production', APP_URL: 'https://app.redwavemarketing.ca/' })).toEqual({
      baseUrl: 'https://app.redwavemarketing.ca',
      source: 'APP_URL',
    });
    // canonical takes precedence over the alias
    expect(
      resolveAppBaseUrl({ NODE_ENV: 'production', APP_BASE_URL: 'https://a.example', APP_URL: 'https://b.example' }).baseUrl,
    ).toBe('https://a.example');
  });

  it('an INVALID value counts as unset (prod → fail-safe; dev → the dev default)', () => {
    expect(resolveAppBaseUrl({ NODE_ENV: 'production', APP_BASE_URL: 'not a url' })).toEqual({ baseUrl: null, source: null });
    expect(resolveAppBaseUrl({ NODE_ENV: 'production', APP_BASE_URL: 'ftp://x.example' })).toEqual({ baseUrl: null, source: null });
    expect(resolveAppBaseUrl({ APP_BASE_URL: '   ' }).baseUrl).toBe(DEV_APP_BASE_URL);
  });
});

describe('appLink — exactly one slash + encoded query params', () => {
  it.each([
    ['https://app.example', '/reset-password'],
    ['https://app.example/', '/reset-password'],
    ['https://app.example', 'reset-password'],
    ['https://app.example//', 'reset-password'],
  ])('joins %s + %s with a single slash', (base, path) => {
    expect(appLink(base, path)).toBe('https://app.example/reset-password');
  });

  it('percent-encodes query params (tokens survive special characters)', () => {
    expect(appLink('https://app.example', '/reset-password', { token: 'a b+c&d' })).toBe(
      'https://app.example/reset-password?token=a+b%2Bc%26d',
    );
  });

  it('no params → no question mark', () => {
    expect(appLink('https://app.example', '/login', {})).toBe('https://app.example/login');
  });
});
