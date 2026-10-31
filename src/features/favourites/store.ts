/**
 * The one favourites store every screen reads: the venue page's heart, the
 * Saved list, Home and the Coach. iOS keeps the state per view model
 * (VenueDetailViewModel.isFavourite, FavouritesViewModel), and every surface
 * re-reads `GET /favourites` when it appears; Android keeps ONE copy, so a
 * heart tapped on the venue page is already right on Saved, and no two
 * screens can disagree until a refetch (the first build's bug: each screen's
 * hook kept its own list).
 *
 * THE HEART (iOS VenueDetailViewModel.toggleFavourite):
 *   - it flips at once (optimistic), before the server answers;
 *   - a second tap on the same venue while its request is in flight is
 *     ignored (iOS `guard !isTogglingFavourite`), so a double tap can never
 *     send add-then-remove;
 *   - a failure puts the heart back and raises the "Heads up" alert with
 *     `venue.err.favourite` ("Could not update your favourites. Please try
 *     again.").
 * A caller that ports a surface where iOS reverts silently (the Coach's venue
 * cards, the Saved suggestions' heart) passes `{ alert: false }`.
 *
 * HOW THE OPTIMISTIC STATE MEETS THE SERVER'S. `rows` holds the last read;
 * `overrides` holds what the member asked for that a read has not confirmed
 * yet (venue id → saved). An override set by a write lives on after the write
 * succeeds until a read that STARTED after the write was confirmed lands: a
 * read that was already on its way when the member tapped knows nothing of
 * the tap and must not undo it. A write still in flight always keeps its
 * override. A successful add then reads the list again, so the new row (name,
 * photo, slug) reaches Saved and the Coach.
 *
 * A failed read keeps what was there; with nothing loaded, every venue reads
 * as not saved (iOS: "a failure there just means not favourited").
 *
 * SIGN-OUT. The list is the member's own: `reset()` (a sign-out cleaner,
 * ./register.ts) forgets it, and an answer still on its way for the member
 * who left is dropped (the generation check).
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

import { errorMessage, isCancellation } from '../../api';
// The dialog module itself, not the UI kit's barrel: the barrel pulls in the
// icon fonts, and this store loads with the sign-out cleaners (./register.ts).
import { showDialog } from '../../components/ui/Dialog';
import { t } from '../../i18n';
import {
  addFavouriteActivity,
  addFavouriteVenue,
  fetchFavourites,
  removeFavouriteActivity,
  removeFavouriteVenue,
  type FavouriteActivity,
  type FavouriteVenue,
  type FavouritesPayload,
} from './api';

export type FavouritesStatus = 'idle' | 'loading' | 'loaded' | 'failed';

/** What a toggle did. `ignored`: the venue already had a request in flight. */
export type FavouriteToggleResult = 'added' | 'removed' | 'ignored' | 'failed';

export interface FavouriteToggleOptions {
  /** Raise the "Heads up" alert on a failure (default true, as the venue page does). */
  readonly alert?: boolean;
}

export interface FavouritesStoreState {
  /** The last read's saved venues, exactly as the server listed them. */
  readonly rows: readonly FavouriteVenue[];
  /** The saved venues to show: `rows` less any the member has just unsaved. */
  readonly venues: readonly FavouriteVenue[];
  /** The last read's saved classes. */
  readonly activities: readonly FavouriteActivity[];
  /**
   * Every venue id that reads as saved right now: the last read with the
   * member's unconfirmed taps applied. One array per change, so a selector
   * can return it as is.
   */
  readonly savedIds: readonly string[];
  /** Venue ids with a write in flight (the heart ignores taps on these). */
  readonly inFlight: Readonly<Record<string, true>>;
  /** The member's taps that no read has confirmed yet: venue id → saved. */
  readonly overrides: Readonly<Record<string, boolean>>;
  readonly status: FavouritesStatus;
  /** True once a read has answered this session. */
  readonly loaded: boolean;
  /** The last read's failure in the language on screen, or null. */
  readonly error: string | null;

  /**
   * Reads `GET /favourites`. Joins a read already on its way unless `force`
   * (a write that just landed must read after itself).
   */
  load(options?: { readonly force?: boolean }): Promise<void>;
  /** Reads once if nothing has been read yet (or the last read failed). */
  ensureLoaded(): Promise<void>;
  isFavourite(venueId: string): boolean;
  isToggling(venueId: string): boolean;
  /** Saves or unsaves a venue, optimistically (see the file comment). */
  toggle(venueId: string, options?: FavouriteToggleOptions): Promise<FavouriteToggleResult>;
  /** Saves a venue (nothing is sent when it already reads as saved). */
  add(venueId: string, options?: FavouriteToggleOptions): Promise<FavouriteToggleResult>;
  /** Unsaves a venue (nothing is sent when it already reads as not saved). */
  remove(venueId: string, options?: FavouriteToggleOptions): Promise<FavouriteToggleResult>;
  /** Saves a class, then reads the list again. Throws on failure; the caller words it. */
  addActivity(activityId: string): Promise<void>;
  /** Unsaves a class, then reads the list again. Throws on failure; the caller words it. */
  removeActivity(activityId: string): Promise<void>;
  /** Forgets everything (sign-out). */
  reset(): void;
}

export type FavouritesStore = StoreApi<FavouritesStoreState>;

export interface FavouritesApi {
  readonly fetch: () => Promise<FavouritesPayload>;
  readonly addVenue: (venueId: string) => Promise<void>;
  readonly removeVenue: (venueId: string) => Promise<void>;
  readonly addActivity: (activityId: string) => Promise<void>;
  readonly removeActivity: (activityId: string) => Promise<void>;
}

export interface FavouritesStoreOptions {
  readonly api?: Partial<FavouritesApi>;
  /** How a failed toggle tells the member (default: the "Heads up" dialog). */
  readonly alert?: (message: string) => void;
}

const defaultApi: FavouritesApi = {
  fetch: () => fetchFavourites(),
  addVenue: addFavouriteVenue,
  removeVenue: removeFavouriteVenue,
  addActivity: addFavouriteActivity,
  removeActivity: removeFavouriteActivity,
};

/** iOS `.alert(appState.t("common.heads_up"))` with its OK button. */
export function showFavouriteAlert(message: string): void {
  showDialog({ title: t('common.heads_up'), message, buttons: [{ label: t('common.ok') }] });
}

const key = (id: string) => id.toLowerCase();

/** The venue ids that read as saved: the rows' ids with the overrides applied. */
function computeSavedIds(rows: readonly FavouriteVenue[], overrides: Readonly<Record<string, boolean>>): string[] {
  const ids = rows.map((v) => v.venueId).filter((id) => overrides[id] !== false);
  for (const [id, saved] of Object.entries(overrides)) {
    if (saved && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function without<T>(record: Readonly<Record<string, T>>, id: string): Record<string, T> {
  const next = { ...record };
  delete next[id];
  return next;
}

const EMPTY = {
  rows: [],
  venues: [],
  activities: [],
  savedIds: [],
  inFlight: {},
  overrides: {},
  status: 'idle',
  loaded: false,
  error: null,
} as const satisfies Partial<FavouritesStoreState>;

export function createFavouritesStore(options: FavouritesStoreOptions = {}): FavouritesStore {
  const api: FavouritesApi = { ...defaultApi, ...options.api };
  const alert = options.alert ?? showFavouriteAlert;

  /** Bumps on reset: an answer for an earlier generation is the previous member's. */
  let generation = 0;
  /** Bumps with every read started; only the latest read lands. */
  let latestRead = 0;
  let pendingRead: Promise<void> | null = null;
  /** Counts confirmed writes; `confirmedAt[id]` is the count when that venue's last write was confirmed. */
  let confirmations = 0;
  let confirmedAt: Record<string, number> = {};

  return createStore<FavouritesStoreState>()((set, get) => {
    /** Applies new rows and/or overrides, recomputing what reads as saved. */
    const commit = (
      patch: Partial<Pick<FavouritesStoreState, 'rows' | 'overrides' | 'inFlight' | 'activities' | 'status' | 'loaded' | 'error'>>,
    ) => {
      const state = get();
      const rows = patch.rows ?? state.rows;
      const overrides = patch.overrides ?? state.overrides;
      set({
        ...patch,
        venues: rows.filter((v) => overrides[v.venueId] !== false),
        savedIds: computeSavedIds(rows, overrides),
      });
    };

    const read = async (): Promise<void> => {
      const mine = ++latestRead;
      const gen = generation;
      const confirmationsAtStart = confirmations;
      set({ status: 'loading' });
      try {
        const payload = await api.fetch();
        if (gen !== generation || mine !== latestRead) return;
        const state = get();
        // Keep the taps this read cannot know about: writes in flight, and
        // writes confirmed after it started. Drop the rest: the server says.
        const overrides: Record<string, boolean> = {};
        for (const [id, saved] of Object.entries(state.overrides)) {
          const confirmed = confirmedAt[id];
          if (state.inFlight[id] || confirmed === undefined || confirmed > confirmationsAtStart) {
            overrides[id] = saved;
          } else {
            delete confirmedAt[id];
          }
        }
        commit({
          rows: payload.venues,
          overrides,
          activities: payload.activities,
          status: 'loaded',
          loaded: true,
          error: null,
        });
      } catch (error) {
        if (gen !== generation || mine !== latestRead) return;
        set({ status: 'failed', error: errorMessage(error) });
      }
    };

    const write = async (
      id: string,
      target: boolean,
      opts: FavouriteToggleOptions | undefined,
    ): Promise<FavouriteToggleResult> => {
      const state = get();
      const gen = generation;
      const previous = Object.prototype.hasOwnProperty.call(state.overrides, id) ? state.overrides[id] : undefined;
      commit({ overrides: { ...state.overrides, [id]: target }, inFlight: { ...state.inFlight, [id]: true } });
      try {
        await (target ? api.addVenue(id) : api.removeVenue(id));
      } catch (error) {
        if (gen !== generation) return 'failed';
        const now = get();
        // Back to what the heart showed before the tap.
        const overrides = previous === undefined ? without(now.overrides, id) : { ...now.overrides, [id]: previous };
        commit({ overrides, inFlight: without(now.inFlight, id) });
        // A call the app cancelled (a sign-out on the way) is never an alert.
        if ((opts?.alert ?? true) && !isCancellation(error)) alert(t('venue.err.favourite'));
        return 'failed';
      }
      if (gen !== generation) return target ? 'added' : 'removed';
      confirmations += 1;
      confirmedAt[id] = confirmations;
      commit({ inFlight: without(get().inFlight, id) });
      // An add has no row yet (name, photo, slug for Saved and the Coach): read it.
      if (target) void get().load({ force: true });
      return target ? 'added' : 'removed';
    };

    /** Runs a write unless this venue already has one in flight. */
    const guarded = (venueId: string, decide: (savedNow: boolean) => boolean | null, opts?: FavouriteToggleOptions) => {
      const id = key(venueId);
      if (get().inFlight[id]) return Promise.resolve<FavouriteToggleResult>('ignored');
      const savedNow = get().savedIds.includes(id);
      const target = decide(savedNow);
      if (target === null) return Promise.resolve<FavouriteToggleResult>(savedNow ? 'added' : 'removed');
      return write(id, target, opts);
    };

    return {
      ...EMPTY,

      load(loadOptions) {
        if (pendingRead && !loadOptions?.force) return pendingRead;
        const promise = read().finally(() => {
          if (pendingRead === promise) pendingRead = null;
        });
        pendingRead = promise;
        return promise;
      },

      ensureLoaded() {
        const { status } = get();
        if (status === 'idle' || status === 'failed') return get().load();
        return pendingRead ?? Promise.resolve();
      },

      isFavourite(venueId) {
        return get().savedIds.includes(key(venueId));
      },

      isToggling(venueId) {
        return get().inFlight[key(venueId)] === true;
      },

      toggle(venueId, opts) {
        return guarded(venueId, (savedNow) => !savedNow, opts);
      },

      add(venueId, opts) {
        return guarded(venueId, (savedNow) => (savedNow ? null : true), opts);
      },

      remove(venueId, opts) {
        return guarded(venueId, (savedNow) => (savedNow ? false : null), opts);
      },

      async addActivity(activityId) {
        const gen = generation;
        await api.addActivity(key(activityId));
        if (gen === generation) await get().load({ force: true });
      },

      async removeActivity(activityId) {
        const gen = generation;
        await api.removeActivity(key(activityId));
        if (gen === generation) await get().load({ force: true });
      },

      reset() {
        generation += 1;
        latestRead += 1;
        pendingRead = null;
        confirmations = 0;
        confirmedAt = {};
        set({ ...EMPTY });
      },
    };
  });
}

/** The app's one favourites store. */
export const favouritesStore: FavouritesStore = createFavouritesStore();
