/**
 * Cross-venue class discovery's state: the Android port of iOS
 * `ClassesViewModel` (ViewModels/ClassesViewModel.swift). It mirrors the web
 * /browse Classes tab: server-side search and category filter, client-side
 * distance filter and per-class distance (the member's location never leaves
 * the phone), a day-grouped list, cursor pagination, and a ticking "now" so
 * classes that start mid-browse drop off.
 *
 * One store per screen (`createClassesFeed`), as iOS gives each view its own
 * view model: the filters reset per visit and nothing is persisted.
 *
 * THE RULES IT KEEPS (each one is a past bug on some platform):
 *  - Stale-response guard: a request counter, and only the newest request may
 *    write. A reload supersedes a load-more in flight and owns resetting
 *    `isLoadingMore`, or the flag wedges and pagination dies.
 *  - A filter tap marks the feed loading in the SAME step as the filter
 *    change and only defers the fetch (`reloadNow`), so nothing can pair the
 *    new filters with the old feed (that would key a look-ahead on a request
 *    the reload is about to replace, and spend a GET on it). Two taps before
 *    the first fetch runs cost one GET, for the last filter.
 *  - The search is debounced 300 ms; a filter tap cancels a pending debounce,
 *    since its reload already carries the latest text.
 *  - A selected day that has gone stale (midnight) snaps back to the default
 *    window rather than fetch a day the feed no longer serves.
 *  - Opening the feed asks for nothing: the distance comes from `fix`, the
 *    GRANTED position the screen hands in, and only the "Near me" tap may ask
 *    for location.
 *  - One `fix` for the whole screen: the cards' distances, the "Near me"
 *    centre and the fallback note all read it, so revoking location flips the
 *    three at once.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  fetchClassFeedPage,
  firstMatch,
  type ClassFeedFetcher,
  type ClassFeedItem,
} from '../../../api/classFeed';
import { REYKJAVIK_CENTRE, type Coordinate } from '../../../lib/geo';
import { feedEntries, passesClientFilters, type FeedEntry } from './clientFilters';
import { DEFAULT_RADIUS_KM, isoDay, lookAheadWindow } from './days';
import { nextMatchKey, requestOrigin, sameRequest, type NextMatchRequest, type NextMatchState } from './nextMatch';

/** The server caps `q` at 80 characters: send a valid prefix rather than a 400 (`trimmedQuery`). */
export const MAX_QUERY_LENGTH = 80;
/** The search field's debounce (iOS 300 ms). */
export const SEARCH_DEBOUNCE_MS = 300;
/** The screen's heartbeat (iOS 30 s). */
export const TICK_MS = 30_000;
/**
 * Pages read to finish an empty day, and pages read for the fortnight after
 * it. Three each, as on the web: the feed allows about 60 reads a minute per
 * IP, and a member tapping through categories must stay well inside it.
 */
export const MAX_DAY_PAGES = 3;
export const MAX_LOOK_AHEAD_PAGES = 3;

/** A day of the list: its venue-local day and its classes, in feed order. */
export interface DayGroup {
  readonly dayIso: string;
  readonly entries: readonly FeedEntry[];
}

export interface ClassesFeedState {
  // Filters
  /** Bound to the search field; debounced into a reload. */
  readonly searchText: string;
  /** Active category slug (server-side), null for all. */
  readonly category: string | null;
  /** One venue-local day (`YYYY-MM-DD`), or null for the default upcoming-week window. */
  readonly selectedDateIso: string | null;
  /** "Near me": the radius filter, nothing more. The cards' distances do not depend on it. */
  readonly nearMeEnabled: boolean;
  readonly radiusKm: number;

  // Feed
  readonly items: readonly ClassFeedItem[];
  readonly nextCursor: string | null;
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly loadFailed: boolean;
  /**
   * The search the feed on screen was loaded with. The empty day's look-ahead
   * asks with this, not with the live `searchText`: typing must not fire a
   * look-ahead per keystroke ahead of its own debounced reload, and the day's
   * cursor belongs to this query.
   */
  readonly loadedQuery: string | null;
  /** Ticked every 30 s so started classes drop off. */
  readonly now: Date;
  /** The member's REAL position (granted), the only origin a card's distance is printed from. */
  readonly fix: Coordinate | null;

  // Next match
  readonly nextMatchAttempt: number;
  readonly nextMatchResult: { readonly key: string; readonly state: NextMatchState } | null;

  // Actions
  setSearchText(text: string): void;
  /** The first load, unless the feed has classes or is loading. */
  loadInitial(): Promise<void>;
  reload(): Promise<void>;
  loadMore(): Promise<void>;
  /**
   * Preselect a category and a day BEFORE the first load, for a caller that
   * already knows what the member is looking for (Plan's class session). Set,
   * not toggled, and without a reload: the first load has not run yet, and
   * reloading here would fetch the unfiltered feed and throw it away.
   */
  applyInitialFilters(category: string | null | undefined, dateIso: string | null | undefined): void;
  toggleCategory(slug: string): void;
  /** Quick chip: select that day, or tap the active chip to clear back to the default window. */
  toggleDate(dayIso: string): void;
  /** The full-schedule picker: always sets, never toggles. */
  selectCustomDate(dayIso: string): void;
  /** Clear any active day: the only escape from a custom pick. */
  clearDate(): void;
  /** The 30 s heartbeat: refresh `now`; a selected day now in the past snaps back and reloads. */
  tick(): void;
  /** "Near me": the first tap may ask for location; a denial silently uses the Reykjavík centre. */
  toggleNearMe(): void;
  setRadius(km: number): void;
  /** The screen's granted position changed (a fix, a grant, a revocation). */
  setFix(fix: Coordinate | null): void;
  /**
   * Answer `request`: finish reading the selected day, then read the
   * fortnight after it. A cancelled run (`signal`) writes nothing.
   */
  findNextMatch(request: NextMatchRequest | null, signal?: AbortSignal): Promise<void>;
  /** The failed hint's "Try again": a new attempt is a new request. */
  retryNextMatch(): void;
  /** The hint's button: move the day selector to the next match's day (same filters) and load it. */
  showNextMatchDay(): void;
  /** The screen went away: no search debounce may fire after it. */
  dispose(): void;
}

export type ClassesFeedStore = StoreApi<ClassesFeedState>;

export interface ClassesFeedOptions {
  /** One page of `GET /classes`. Default: the app's client. */
  readonly fetchPage?: ClassFeedFetcher;
  /** The clock. Default: the phone's. */
  readonly clock?: () => Date;
  /** Asks for location (the "Near me" tap). Default: nothing. */
  readonly requestLocation?: () => void;
  /** The granted position when the screen opens. */
  readonly initialFix?: Coordinate | null;
  readonly searchDebounceMs?: number;
}

// MARK: - Derived (pure functions of the state)

/** The "Near me" radius's centre: the real position, or central Reykjavík without one. Null with it off. */
export function selectNearMeOrigin(state: Pick<ClassesFeedState, 'nearMeEnabled' | 'fix'>): Coordinate | null {
  if (!state.nearMeEnabled) return null;
  return state.fix ?? REYKJAVIK_CENTRE;
}

/**
 * True when "Near me" is on without a real fix: the radius is measured from
 * Reykjavík centre, the cards show no distance, and the note says so.
 */
export function selectUsingLocationFallback(state: Pick<ClassesFeedState, 'nearMeEnabled' | 'fix'>): boolean {
  return state.nearMeEnabled && state.fix === null;
}

/** How many filters narrow the feed: Near me, a day, a category (the Filters badge). */
export function selectActiveFilterCount(
  state: Pick<ClassesFeedState, 'nearMeEnabled' | 'selectedDateIso' | 'category'>,
): number {
  return (state.nearMeEnabled ? 1 : 0) + (state.selectedDateIso !== null ? 1 : 0) + (state.category !== null ? 1 : 0);
}

type GroupInputs = Pick<ClassesFeedState, 'items' | 'now' | 'fix' | 'nearMeEnabled' | 'radiusKm'>;

/**
 * The last answer per feed, keyed on the feed's `items` array (each store
 * owns its own), so two feeds on screen at once (Explore's Classes mode under
 * Plan's sheet) never evict each other's answer. A store that goes away
 * takes its entry with it.
 */
const lastGroupsByItems = new WeakMap<
  readonly ClassFeedItem[],
  { readonly inputs: GroupInputs; readonly groups: readonly DayGroup[] }
>();

/**
 * Upcoming classes, distance-annotated and -filtered, grouped by venue-local
 * day (days in order; classes in feed order inside a day). Remembers its last
 * answer: the list, the hint and the look-ahead ask for it on every render.
 */
export function selectDayGroups(state: GroupInputs): readonly DayGroup[] {
  const last = lastGroupsByItems.get(state.items);
  if (
    last &&
    last.inputs.now === state.now &&
    last.inputs.fix === state.fix &&
    last.inputs.nearMeEnabled === state.nearMeEnabled &&
    last.inputs.radiusKm === state.radiusKm
  ) {
    return last.groups;
  }
  const entries = feedEntries(state.items, state.now, state.fix, selectNearMeOrigin(state), state.radiusKm);
  const byDay = new Map<string, FeedEntry[]>();
  for (const entry of entries) {
    const day = isoDay(entry.item.startsAt);
    const list = byDay.get(day);
    if (list) list.push(entry);
    else byDay.set(day, [entry]);
  }
  const groups = [...byDay.keys()].sort().map((dayIso) => ({ dayIso, entries: byDay.get(dayIso)! }));
  lastGroupsByItems.set(state.items, {
    inputs: {
      items: state.items,
      now: state.now,
      fix: state.fix,
      nearMeEnabled: state.nearMeEnabled,
      radiusKm: state.radiusKm,
    },
    groups,
  });
  return groups;
}

/**
 * Non-null while a selected day shows no classes: what the look-ahead must
 * answer. Null while the day loads, after a failed load (the error UI owns
 * that), and in the default upcoming-week window.
 */
export function selectNextMatchRequest(state: ClassesFeedState): NextMatchRequest | null {
  if (state.isLoading || state.loadFailed || state.isLoadingMore) return null;
  const day = state.selectedDateIso;
  if (day === null || selectDayGroups(state).length > 0) return null;
  const origin = selectNearMeOrigin(state);
  return {
    dayIso: day,
    query: state.loadedQuery,
    category: state.category,
    originLatitude: origin?.latitude ?? null,
    originLongitude: origin?.longitude ?? null,
    radiusKm: state.nearMeEnabled ? state.radiusKm : 0,
    attempt: state.nextMatchAttempt,
  };
}

/**
 * What the empty day shows, or null when the hint does not apply. An answer
 * computed for another request is never shown: until the current one
 * answers, the state is "still looking".
 */
export function selectNextMatchState(state: ClassesFeedState): NextMatchState | null {
  const request = selectNextMatchRequest(state);
  if (!request) return null;
  const stored = state.nextMatchResult;
  if (stored && stored.key === nextMatchKey(request)) return stored.state;
  return state.nextCursor === null ? { kind: 'searching' } : { kind: 'checkingDay' };
}

/**
 * The search as sent: trimmed, empty is none, at most 80 characters.
 *
 * Counted in UTF-16 units, the strictest reading of the server's cap, but
 * never cut inside a surrogate pair: half an emoji is not valid text, and
 * `encodeURIComponent` throws on it, so the feed would fail before asking
 * (iOS `prefix(80)` cuts whole characters and cannot do this).
 */
export function trimmedQuery(searchText: string): string | null {
  const trimmed = searchText.trim();
  if (!trimmed) return null;
  const cut = trimmed.slice(0, MAX_QUERY_LENGTH);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

// MARK: - The store

/** Runs `work` after the caller's synchronous step (Swift `Task { ... }`). */
function defer(work: () => void): void {
  void Promise.resolve().then(work);
}

export function createClassesFeed(options: ClassesFeedOptions = {}): ClassesFeedStore {
  const fetchPage = options.fetchPage ?? fetchClassFeedPage;
  const clock = options.clock ?? (() => new Date());
  const requestLocation = options.requestLocation ?? (() => undefined);
  const debounceMs = options.searchDebounceMs ?? SEARCH_DEBOUNCE_MS;

  /** Stale-response guard: only the newest request may write state. */
  let requestCounter = 0;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The read of the selected day's later pages, shared by every look-ahead
   * of one feed (`generation` = `requestCounter`). Not cancelled with a
   * look-ahead on purpose: one cancelled by a filter change must not strand
   * the read half done, and the next look-ahead waits for it rather than
   * fetching the same cursor again.
   */
  let dayDrain: { readonly generation: number; readonly promise: Promise<boolean> } | null = null;

  return createStore<ClassesFeedState>()((set, get) => {
    const cancelSearch = () => {
      if (searchTimer !== null) {
        clearTimeout(searchTimer);
        searchTimer = null;
      }
    };

    /**
     * Supersede whatever is in flight and mark the feed loading. Kept apart
     * from `load` so a filter tap can do this in the same synchronous step as
     * the filter change (`reloadNow`).
     */
    const beginReload = (): number => {
      requestCounter += 1;
      // Advancing the counter supersedes any load-more in flight: its guarded
      // continuation returns before its own reset, so this reload owns it.
      set({ isLoading: true, loadFailed: false, isLoadingMore: false });
      dayDrain = null;
      return requestCounter;
    };

    const load = async (requestId: number): Promise<void> => {
      // A newer reload began before this one ran: it asks for itself.
      if (requestId !== requestCounter) return;
      // A selection can silently go stale at midnight: snap back to the
      // default window rather than fetch a day the feed no longer serves.
      const selected = get().selectedDateIso;
      if (selected !== null && selected < isoDay(clock())) set({ selectedDateIso: null });
      const { category, selectedDateIso } = get();
      const query = trimmedQuery(get().searchText);
      try {
        const page = await fetchPage({ query, category, start: selectedDateIso, end: selectedDateIso });
        if (requestId !== requestCounter) return;
        set({ loadedQuery: query, items: page.classes, nextCursor: page.nextCursor, now: clock() });
      } catch {
        if (requestId !== requestCounter) return;
        set({ loadFailed: true });
      }
      if (requestId === requestCounter) set({ isLoading: false });
    };

    /**
     * Reload at once, cancelling a pending search debounce first: this reload
     * already carries the latest text. The feed is marked loading NOW, in the
     * caller's step; only the fetch is deferred.
     */
    const reloadNow = () => {
      cancelSearch();
      const requestId = beginReload();
      defer(() => void load(requestId));
    };

    const scheduleSearchReload = () => {
      cancelSearch();
      searchTimer = setTimeout(() => {
        searchTimer = null;
        void load(beginReload());
      }, debounceMs);
    };

    const store = (state: NextMatchState, request: NextMatchRequest) => {
      set({ nextMatchResult: { key: nextMatchKey(request), state } });
    };

    /**
     * Read the selected day's later pages until one holds a class that passes
     * the client filters, the day ends, or `MAX_DAY_PAGES` were read. False
     * when a page failed to load.
     */
    const drainSelectedDay = async (): Promise<boolean> => {
      const generation = requestCounter;
      if (dayDrain && dayDrain.generation === generation) return dayDrain.promise;
      const { loadedQuery: query, category, selectedDateIso: day } = get();
      const promise = (async (): Promise<boolean> => {
        let pages = 0;
        for (;;) {
          const cursor = get().nextCursor;
          if (selectDayGroups(get()).length > 0 || cursor === null || pages >= MAX_DAY_PAGES) return true;
          try {
            const page = await fetchPage({ query, category, start: day, end: day, cursor });
            if (generation !== requestCounter) return true;
            set({ items: [...get().items, ...page.classes], nextCursor: page.nextCursor });
            pages += 1;
          } catch {
            return generation !== requestCounter;
          }
        }
      })();
      dayDrain = { generation, promise };
      const readOK = await promise;
      if (dayDrain?.generation === generation) dayDrain = null;
      return readOK;
    };

    return {
      searchText: '',
      category: null,
      selectedDateIso: null,
      nearMeEnabled: false,
      radiusKm: DEFAULT_RADIUS_KM,
      items: [],
      nextCursor: null,
      isLoading: false,
      isLoadingMore: false,
      loadFailed: false,
      loadedQuery: null,
      now: clock(),
      fix: options.initialFix ?? null,
      nextMatchAttempt: 0,
      nextMatchResult: null,

      setSearchText(text) {
        if (text === get().searchText) return;
        set({ searchText: text });
        scheduleSearchReload();
      },

      async loadInitial() {
        const { items, isLoading } = get();
        if (items.length > 0 || isLoading) return;
        await load(beginReload());
      },

      async reload() {
        await load(beginReload());
      },

      async loadMore() {
        const { nextCursor: cursor, isLoadingMore, isLoading } = get();
        if (cursor === null || isLoadingMore || isLoading || dayDrain !== null) return;
        const requestId = requestCounter;
        set({ isLoadingMore: true });
        const { category, selectedDateIso } = get();
        try {
          const page = await fetchPage({
            query: trimmedQuery(get().searchText),
            category,
            start: selectedDateIso,
            end: selectedDateIso,
            cursor,
          });
          if (requestId !== requestCounter) return;
          set({ items: [...get().items, ...page.classes], nextCursor: page.nextCursor });
        } catch {
          // Appending failed: keep the cursor so the button can retry.
        }
        if (requestId === requestCounter) set({ isLoadingMore: false });
      },

      applyInitialFilters(category, dateIso) {
        if (category) set({ category });
        if (dateIso) set({ selectedDateIso: dateIso });
      },

      toggleCategory(slug) {
        set({ category: get().category === slug ? null : slug });
        reloadNow();
      },

      toggleDate(dayIso) {
        set({ selectedDateIso: get().selectedDateIso === dayIso ? null : dayIso });
        reloadNow();
      },

      selectCustomDate(dayIso) {
        set({ selectedDateIso: dayIso });
        reloadNow();
      },

      clearDate() {
        if (get().selectedDateIso === null) return;
        set({ selectedDateIso: null });
        reloadNow();
      },

      tick() {
        const now = clock();
        set({ now });
        const selected = get().selectedDateIso;
        if (selected !== null && selected < isoDay(now)) {
          set({ selectedDateIso: null });
          reloadNow();
        }
      },

      toggleNearMe() {
        const enabled = !get().nearMeEnabled;
        set({ nearMeEnabled: enabled });
        // Asks on first use, refreshes the fix otherwise. A denial silently
        // degrades to the Reykjavík-centre fallback.
        if (enabled) requestLocation();
      },

      setRadius(km) {
        if (km !== get().radiusKm) set({ radiusKm: km });
      },

      setFix(fix) {
        const current = get().fix;
        if (current === fix) return;
        if (current && fix && current.latitude === fix.latitude && current.longitude === fix.longitude) return;
        set({ fix });
      },

      async findNextMatch(request, signal) {
        if (!request || !sameRequest(request, selectNextMatchRequest(get()))) return;

        // 1. The rest of the selected day.
        if (get().nextCursor !== null) {
          const readOK = await drainSelectedDay();
          if (signal?.aborted) return;
          if (!readOK) {
            store({ kind: 'failed' }, request);
            return;
          }
          // The day had a class after all (the list shows it, no hint), or a
          // reload replaced the feed and asks for itself.
          if (!sameRequest(request, selectNextMatchRequest(get()))) return;
          if (get().nextCursor !== null) {
            store({ kind: 'gaveUp' }, request);
            return;
          }
        }

        // 2. The fortnight after it.
        const window = lookAheadWindow(request.dayIso);
        if (!window) return;
        const origin = requestOrigin(request);
        const radius = request.radiusKm;
        const now = get().now;
        try {
          const outcome = await firstMatch({
            query: request.query,
            category: request.category,
            start: window.start,
            end: window.end,
            maxPages: MAX_LOOK_AHEAD_PAGES,
            accept: (item) => passesClientFilters(item, now, origin, radius),
            signal,
            fetchPage,
          });
          if (signal?.aborted) return;
          switch (outcome.kind) {
            case 'found':
              store({ kind: 'found', item: outcome.item }, request);
              break;
            case 'exhausted':
              store({ kind: 'noneInWindow' }, request);
              break;
            case 'gaveUp':
              store({ kind: 'gaveUp' }, request);
              break;
          }
        } catch {
          if (signal?.aborted) return;
          store({ kind: 'failed' }, request);
        }
      },

      retryNextMatch() {
        set({ nextMatchAttempt: get().nextMatchAttempt + 1 });
      },

      showNextMatchDay() {
        const state = selectNextMatchState(get());
        if (state?.kind !== 'found') return;
        set({ selectedDateIso: isoDay(state.item.startsAt) });
        reloadNow();
      },

      dispose() {
        // Only the debounce: a request still in flight may land in a store
        // nobody shows, which is harmless, and a remount (React's strict
        // mode) keeps the same store and must find its load still running.
        cancelSearch();
      },
    };
  });
}
