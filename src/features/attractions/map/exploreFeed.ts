/**
 * The sights feed as Explore reads it: the map's layer and the search group,
 * which on iOS share one MapViewModel (`loadAttractions`, `attractionsLoaded`,
 * `attractionsLoading`).
 *
 * The markers themselves live in the shared feed (../markersStore.ts), which
 * Home's Outside card fills too. What Explore adds on top is what iOS keeps on
 * the map's view model:
 *   - WHETHER EXPLORE HAS A READ OUT (`loading`): the map's quiet notice shows
 *     its spinner, and takes no second tap, while any Explore read is out, the
 *     search group's included (iOS `attractionsLoading` is set by
 *     `fetchAttractions` whoever asked). Home's reads are not Explore's, as on
 *     iOS, where Home asks through its own model.
 *   - WHICH READS SUCCEEDED, in order (`readMark`, `readSince`): a map counts
 *     a search group read that landed after it appeared as its own, so the
 *     map's retry schedule ends at its next step and its trails follow, as a
 *     search load sets iOS `attractionsLoaded` for the map. Without it the
 *     map would ask once more for markers it already has.
 *
 * Under the `mapPins` fixture nothing is asked: the fixture's sights stand in
 * (./mapPinsFixture.ts).
 */
import { createStore } from 'zustand/vanilla';

import type { Lang } from '../../../i18n';
import { loadAttractionMarkers, type MarkersLoadResult } from '../markersStore';
import { mapPinsFixture } from './mapPinsFixture';

export interface ExploreSightsFeedState {
  /** An Explore read of the markers (the map's or the search group's) is out. */
  readonly loading: boolean;
}

export const exploreSightsFeed = createStore<ExploreSightsFeedState>()(() => ({ loading: false }));

/** Explore reads out now. */
let outstanding = 0;
/** Successful Explore reads so far: each one's number is the count when it landed. */
let reads = 0;
/** The number of the last successful read, per language. */
const lastRead = new Map<Lang, number>();
/** Bumped by a reset, so a read from before it cannot touch the counts after it. */
let generation = 0;

/** Reads the markers for Explore (joining one already out). Never rejects. */
export async function loadExploreMarkers(locale: Lang): Promise<MarkersLoadResult> {
  const fixture = mapPinsFixture();
  if (fixture) return { ok: true, page: fixture.page };
  const mine = generation;
  outstanding += 1;
  if (outstanding === 1) exploreSightsFeed.setState({ loading: true });
  try {
    const result = await loadAttractionMarkers(locale);
    if (result.ok && mine === generation) {
      reads += 1;
      lastRead.set(locale, reads);
    }
    return result;
  } finally {
    if (mine === generation) {
      outstanding -= 1;
      if (outstanding === 0) exploreSightsFeed.setState({ loading: false });
    }
  }
}

/** Where the count of successful reads stands now: a reader keeps it to ask `readSince` later. */
export function readMark(): number {
  return reads;
}

/** Whether a read in `locale` succeeded after `mark` was taken. */
export function readSince(mark: number, locale: Lang): boolean {
  return (lastRead.get(locale) ?? 0) > mark;
}

/** Tests: forget the counts and any read on its way. */
export function resetExploreSightsFeed(): void {
  generation += 1;
  outstanding = 0;
  reads = 0;
  lastRead.clear();
  exploreSightsFeed.setState({ loading: false }, true);
}
