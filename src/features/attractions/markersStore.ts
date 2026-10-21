/**
 * The sights' marker feed (`GET /attractions?locale=`), held in memory and
 * shared by everything that lists sights: Home's Outside card here, and the
 * Explore map's layer and search group (ATTR-2), so two surfaces asking at
 * once make one request.
 *
 * As on iOS (Home's `outsideMarkers`, MapViewModel's markers):
 *   - nothing is persisted; the feed is public and the same for everyone;
 *   - a failed read is SILENT and keeps what is shown: a refresh that fails
 *     must not blank a card the member is reading. The server never answers
 *     an empty 200 for a failure (it is a 503 with Retry-After), so an empty
 *     list never replaces a good one by accident;
 *   - the latest language asked for wins: a read for the language the member
 *     just left never lands over one in the new language (iOS cancels the
 *     old task when `.task(id: language)` changes);
 *   - a read that brings back the feed already held changes nothing. Android
 *     reads at every Home focus, closing a sight card opened from Home
 *     included (on iOS that card is a sheet, and closing it does not re-run
 *     Home's task), so most reads return the same feed. Handing every
 *     subscriber a fresh array each time would re-rank Home's picks and
 *     rebuild ATTR-2's map layer and search, which stay mounted behind
 *     another tab, over thousands of sights for nothing.
 *
 * Callers that need to know about a failure (ATTR-2's retry notice) read the
 * result `loadAttractionMarkers` resolves to; it never rejects.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { fetchAttractionMarkers, type AttractionMarker, type AttractionMarkerPage } from '../../api/attractions';
import type { Lang } from '../../i18n';

export interface AttractionMarkersState {
  /** The last feed that loaded, or null before any has. */
  readonly page: AttractionMarkerPage | null;
  /** The language that feed was read in. */
  readonly locale: Lang | null;
}

export type MarkersLoadResult =
  | { readonly ok: true; readonly page: AttractionMarkerPage }
  | { readonly ok: false; readonly error: unknown };

const INITIAL: AttractionMarkersState = { page: null, locale: null };

export const attractionMarkersStore = createStore<AttractionMarkersState>()(() => INITIAL);

/** One read per language at a time: a second caller joins the one in flight. */
const inFlight = new Map<Lang, Promise<MarkersLoadResult>>();
/** The language most recently asked for; only its answer lands. */
let wanted: Lang | null = null;

/** Reads the feed in `locale` (joining a read already on its way). Never rejects. */
export function loadAttractionMarkers(locale: Lang): Promise<MarkersLoadResult> {
  wanted = locale;
  const running = inFlight.get(locale);
  if (running) return running;
  const attempt = (async (): Promise<MarkersLoadResult> => {
    try {
      const page = await fetchAttractionMarkers(locale);
      if (wanted !== locale) return { ok: true, page };
      const held = attractionMarkersStore.getState();
      // The same feed in the same language: keep the arrays readers hold.
      if (held.locale === locale && held.page && samePage(held.page, page)) return { ok: true, page: held.page };
      attractionMarkersStore.setState({ page, locale });
      return { ok: true, page };
    } catch (error) {
      // Keep what is showing (see the file comment).
      return { ok: false, error };
    } finally {
      inFlight.delete(locale);
    }
  })();
  inFlight.set(locale, attempt);
  return attempt;
}

/**
 * The marker fields a read is compared on: every field, so one added to
 * `AttractionMarker` is a type error here until it is listed. `searchKeys`
 * is folded from the two names at decode, so equal names mean equal keys.
 */
const COMPARED_FIELDS: Readonly<Record<Exclude<keyof AttractionMarker, 'searchKeys'>, true>> = {
  slug: true,
  name: true,
  nameEn: true,
  kind: true,
  region: true,
  latitude: true,
  longitude: true,
  hasPage: true,
  tier: true,
  rankScore: true,
};
const COMPARED = Object.keys(COMPARED_FIELDS) as (keyof typeof COMPARED_FIELDS)[];

/** The same feed: the same notice and the same markers, field for field, in order. */
function samePage(a: AttractionMarkerPage, b: AttractionMarkerPage): boolean {
  if (a === b) return true;
  if (a.attribution !== b.attribution || a.attractions.length !== b.attractions.length) return false;
  return a.attractions.every((marker, index) => {
    const other = b.attractions[index];
    return COMPARED.every((field) => marker[field] === other[field]);
  });
}

const NO_MARKERS: readonly AttractionMarker[] = [];

/** React: the markers held now (empty before the first load). */
export function useAttractionMarkers(): readonly AttractionMarker[] {
  return useStore(attractionMarkersStore, (state) => state.page?.attractions ?? NO_MARKERS);
}

/** Tests: forget the feed and any read on its way. */
export function resetAttractionMarkers(): void {
  inFlight.clear();
  wanted = null;
  attractionMarkersStore.setState(INITIAL, true);
}
