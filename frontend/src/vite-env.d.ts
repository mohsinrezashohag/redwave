/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  /**
   * Backend ORIGIN ONLY (no `/v1`, no trailing slash) for production builds where there is no Vite dev
   * proxy — e.g. `https://api.redwave.example`. Unset in development (the dev proxy forwards `/v1`).
   * See src/api/client.ts.
   */
  readonly VITE_API_BASE_URL?: string;
  /**
   * Google Maps browser key for the expense KM entry (Places autocomplete + route map). When unset, the
   * KM form falls back to manual address + total-km entry; the server still computes the authoritative
   * amount (and re-derives the distance with its own GOOGLE_MAPS_API_KEY).
   */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
