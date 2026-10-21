// Mapbox for the Explore map: set up once, before the first map is drawn.
//
// PRIVACY. Mapbox's SDK sends usage telemetry (including location while the
// map shows the member's dot) unless it is told not to. LifePass does not
// track: iOS draws its map with MapKit and has no Mapbox at all since 2.5.0,
// and the member's precise fix never leaves the phone. So telemetry is
// switched off here, at import, which is app start: the tab shell imports
// the Explore screen, and with it this module, before any tab is drawn.
//
// THE TOKEN. The public `pk.` token is read at runtime (`env.mapboxToken`,
// restricted to this app; config/fragments/mapbox.js says where it lives). A
// build without it draws a blank map, never a crash.
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

let configured = false;

/** Switches telemetry off and hands Mapbox the token. Once; later calls do nothing. */
export function configureMapbox(target: MapboxSetupTarget = Mapbox, token: string | null = env.mapboxToken): void {
  if (configured) return;
  configured = true;
  // Telemetry first, so nothing is collected under the token.
  target.setTelemetryEnabled(false);
  const set = target.setAccessToken(token);
  if (set instanceof Promise) set.catch(() => undefined);
}

/** Tests only: lets `configureMapbox` run again. */
export function resetMapboxSetupForTests(): void {
  configured = false;
}

configureMapbox();
