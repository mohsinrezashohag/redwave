/*
 * No-flash theme boot — runs BEFORE the app so the first paint uses the correct theme. Externalised from
 * index.html (rather than inline) so the production Content-Security-Policy can use `script-src 'self'`
 * with NO `unsafe-inline`. Mirrors src/theme: reads the stored preference (default 'system'), resolves via
 * the OS, and sets <html data-theme>. Keep the storage key in sync with theme.types.ts (THEME_STORAGE_KEY).
 */
(function () {
  try {
    var pref = localStorage.getItem('redwave-theme') || 'system';
    var dark =
      pref === 'dark' ||
      (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();
