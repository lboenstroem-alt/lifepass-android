// Mapbox for the Explore map: set up once, before the first map is drawn.
//
// PRIVACY. Mapbox's SDK sends usage telemetry (including location while the
// map shows the member's dot) unless it is told not to. LifePass does not
// track: iOS draws its map with MapKit and has no Mapbox at all since 2.5.0,
// and the member's precise fix never leaves the phone. So telemetry is
// switched off here, at import, which is app start: the tab shell imports
// the Explore screen, and with it this module, long before Explore can draw
// a map.
//
// THE ORDER MATTERS. On Android, @rnmapbox/maps turns telemetry off by
// building a throwaway native MapView (RNMBXModule.setTelemetryEnabled), and
// a Mapbox MapView built while the SDK has no token throws
// MapboxConfigurationException on the UI thread: a crash at launch. So the
// token goes first, and telemetry is switched off once Mapbox has taken it.
// Both run on the UI queue, in that order, before Explore mounts its map.
//
// THE TOKEN. The public `pk.` token is read at runtime (`env.mapboxToken`,
// restricted to this app; config/fragments/mapbox.js says where it lives). A
// build without it never builds a Mapbox view at all: no telemetry call here
// (there is no map, so nothing to collect), and ExploreMap draws a plain
// ink area in place of the map (`hasMapboxToken`).
import Mapbox from '@rnmapbox/maps';

import { env } from '../../../config/env';

/**
 * The basemap: Mapbox Light, as the web's map, whose ring contrasts were
 * measured on it (iOS draws MapKit's muted standard style, its equivalent).
 * Light only, as the app is.
 */
export const MAP_STYLE_URL = 'mapbox://styles/mapbox/light-v11';

/** The parts of the Mapbox module the setup calls (the real module in the app). */
export interface MapboxSetupTarget {
  setTelemetryEnabled(enabled: boolean): void;
  setAccessToken(token: string | null): unknown;
}

/** Whether this build can draw a Mapbox map at all (it has a runtime token). */
export function hasMapboxToken(token: string | null = env.mapboxToken): boolean {
  return typeof token === 'string' && token.trim().length > 0;
}

let configured = false;

/**
 * Hands Mapbox the token, then switches telemetry off once it has taken it.
 * Without a token, neither: no map is drawn. Once; later calls do nothing.
 * Returns when both are done (the app does not wait for it).
 */
export function configureMapbox(
  target: MapboxSetupTarget = Mapbox,
  token: string | null = env.mapboxToken,
): Promise<void> {
  if (configured) return Promise.resolve();
  configured = true;
  if (!hasMapboxToken(token)) return Promise.resolve();
  let set: unknown;
  try {
    set = target.setAccessToken(token);
  } catch {
    // A token Mapbox refuses: no map will draw, so there is no telemetry to stop.
    return Promise.resolve();
  }
  return Promise.resolve(set)
    .then(() => target.setTelemetryEnabled(false))
    .catch(() => undefined);
}

/** Tests only: lets `configureMapbox` run again. */
export function resetMapboxSetupForTests(): void {
  configured = false;
}

void configureMapbox();
