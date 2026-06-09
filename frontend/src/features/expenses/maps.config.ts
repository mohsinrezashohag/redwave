/**
 * Maps config — the browser-side Google Maps key for the expense KM entry. When unset, the KM form falls
 * back to manual address + total-km entry (the server still computes the authoritative amount and
 * re-derives the distance with its OWN key). The libraries array is module-level so useJsApiLoader gets a
 * stable reference (a new array each render forces a reload).
 */
export const MAPS_BROWSER_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '').trim();

/** True when a browser Maps key is configured → Places autocomplete + the route map are available. */
export const mapsEnabled = MAPS_BROWSER_KEY.length > 0;

export const MAPS_LOADER_ID = 'redwave-gmaps';
export const MAPS_LIBRARIES: 'places'[] = ['places'];
