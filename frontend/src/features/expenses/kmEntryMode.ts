/**
 * kmEntryMode — how the km form lets a rep enter a trip, given what Google Maps managed to do. Pure.
 *
 * The rule: a Maps problem must NEVER leave the rep unable to log a trip. Before this, a map that failed to
 * load showed only an error line (no stop inputs at all), and with the map up the distance was read-only and
 * filled solely by Directions — so a key rejected by Google, an API not enabled, or a route lookup failure
 * all made a km item impossible to complete. The server still re-derives the distance when it can and
 * computes the amount either way (EXP-004).
 */
export type KmEntryMode = {
  /** Render the Google map + Places stops (else the plain address + total-km inputs). */
  showMap: boolean;
  /** The rep may type the total distance (always true without the map). */
  distanceEditable: boolean;
  /** Why we fell back, shown to the rep; null when nothing went wrong. */
  warning: string | null;
};

export function kmEntryMode(state: { mapsEnabled: boolean; mapsFailed: boolean; routeFailed: boolean }): KmEntryMode {
  if (!state.mapsEnabled) {
    return { showMap: false, distanceEditable: true, warning: null };
  }
  if (state.mapsFailed) {
    return {
      showMap: false,
      distanceEditable: true,
      warning: 'Google Maps couldn’t load, so enter the stops and the total distance manually. The server computes the final amount.',
    };
  }
  if (state.routeFailed) {
    return {
      showMap: true,
      distanceEditable: true,
      warning: 'The route distance couldn’t be calculated for these stops, so enter the total distance manually.',
    };
  }
  return { showMap: true, distanceEditable: false, warning: null };
}
