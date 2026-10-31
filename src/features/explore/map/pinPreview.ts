// The venue card's two-tap rule on the Explore map, as a pure reducer: the
// Android port of iOS `VenuePinPreview` (Models/CategoryMapping.swift), the
// touch half of the web's `nextPreviewState`
// (apps/web/src/components/attractions/venue-preview.ts).
//
// The first tap on a pin pins its card; a second tap on the same pin, or a
// tap on the card, opens the venue; the map, the close button, another pin,
// a sight opening or a filter that takes the venue off the map change or
// clear it. TalkBack's one activation opens at once, since a two-step "tap
// again" is not something a screen reader user can see. Opening clears the
// pin, so coming back from the venue finds a clear map.
//
// ONE TOUCH, TWO HANDLERS. A tap on a pin can also reach the map's own tap
// handler, just before or just after the pin's. The map tap is held 80 ms
// and dropped when a pin tap landed within 0.35 s of it (`deliversMapTap`);
// and a pin tap within 0.35 s AFTER a map tap that closed that same pin's
// card is that touch's second tap, and opens the venue instead of pinning
// the card again. Times are milliseconds since the epoch.

/** A map tap this close in time to a pin tap (either side) is the same touch. */
export const MAP_TAP_WINDOW_MS = 350;
/** How long a map tap waits for a pin tap on the same touch before it counts. */
export const MAP_TAP_HOLD_MS = 80;

export interface PinPreviewState {
  /** The venue whose card is up. */
  readonly pinnedId: string | null;
  /** The pin the last map tap closed, and when that tap landed. */
  readonly closedByMapTap: { readonly id: string; readonly at: number } | null;
}

export type PinPreviewEvent =
  | { readonly kind: 'pinTap'; readonly id: string }
  /** TalkBack activated a pin: one activation opens the venue. */
  | { readonly kind: 'assistiveActivate'; readonly id: string }
  | { readonly kind: 'cardTap' }
  | { readonly kind: 'mapTap' }
  | { readonly kind: 'close' }
  | { readonly kind: 'sightOpened' }
  /** The venues on the map changed (a filter, a search): the ids still on it. */
  | { readonly kind: 'visibleChanged'; readonly ids: ReadonlySet<string> };

/** What an event asks for: open this venue. */
export interface PinPreviewEffect {
  readonly open: string;
}

export const INITIAL_PIN_PREVIEW: PinPreviewState = { pinnedId: null, closedByMapTap: null };

/**
 * Whether a map tap at `mapTap` is a tap on open map rather than the same
 * touch as the last pin tap.
 */
export function deliversMapTap(mapTap: number, lastPinTap: number | null): boolean {
  if (lastPinTap === null) return true;
  return Math.abs(mapTap - lastPinTap) >= MAP_TAP_WINDOW_MS;
}

/**
 * Applies an event; returns the next state and the venue to open, if any.
 * `at` is when the touch behind a `pinTap` or `mapTap` landed.
 */
export function sendPinPreview(
  state: PinPreviewState,
  event: PinPreviewEvent,
  at: number,
): { readonly state: PinPreviewState; readonly effect: PinPreviewEffect | null } {
  const closed = state.closedByMapTap;
  const next = (pinnedId: string | null, closedByMapTap: PinPreviewState['closedByMapTap'] = null) => ({
    pinnedId,
    closedByMapTap,
  });
  switch (event.kind) {
    case 'pinTap': {
      if (state.pinnedId === event.id) return { state: next(null), effect: { open: event.id } };
      if (state.pinnedId === null && closed && closed.id === event.id && !deliversMapTap(closed.at, at)) {
        return { state: next(null), effect: { open: event.id } };
      }
      return { state: next(event.id), effect: null };
    }
    case 'assistiveActivate':
      return { state: next(null), effect: { open: event.id } };
    case 'cardTap':
      if (state.pinnedId === null) return { state: next(null), effect: null };
      return { state: next(null), effect: { open: state.pinnedId } };
    case 'mapTap':
      return {
        state: next(null, state.pinnedId !== null ? { id: state.pinnedId, at } : null),
        effect: null,
      };
    case 'close':
    case 'sightOpened':
      return { state: next(null), effect: null };
    case 'visibleChanged': {
      const pinnedId = state.pinnedId !== null && !event.ids.has(state.pinnedId) ? null : state.pinnedId;
      // Not a tap: a map tap's touch may still reach its pin.
      const keep = closed && event.ids.has(closed.id) ? closed : null;
      return { state: next(pinnedId, keep), effect: null };
    }
  }
}

/** Two states that draw the same and answer the same. */
export function samePinPreview(a: PinPreviewState, b: PinPreviewState): boolean {
  return (
    a.pinnedId === b.pinnedId &&
    a.closedByMapTap?.id === b.closedByMapTap?.id &&
    a.closedByMapTap?.at === b.closedByMapTap?.at
  );
}
