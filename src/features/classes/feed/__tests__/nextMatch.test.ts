/**
 * An empty selected day in class discovery names the next day with a match
 * ("No Pilates today. Next: Mon 5 Oct · Hress 06:00") and can jump there
 * (2.5.1): the port of iOS ClassesNextMatchTests, case for case.
 *
 * The look-ahead runs against the stub server: what the phone ASKS (the
 * window, the filters, the cursor) is asserted as closely as what it does
 * with the answer, because the server refuses a window wider than 14 days and
 * a wrong window would fail in production, not here.
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { tables } from '../../../../i18n/tables';
import { classItem, classJSON, day, HRESS, NEARBY, page, REYKJAVIK } from '../../__tests__/feedFixtures';
import {
  createClassesFeed,
  selectDayGroups,
  selectNextMatchRequest,
  selectNextMatchState,
  type ClassesFeedStore,
} from '../classesFeedStore';
import { passesClientFilters } from '../clientFilters';
import { FEATURED_CATEGORIES, isoDay, lookAheadIsTheNextTwoWeeks, lookAheadWindow, MAX_PICKER_DAYS, pickerRange } from '../days';
import type { NextMatchRequest } from '../nextMatch';
import {
  accessibilityLabel,
  headline,
  nextLine,
  noneInWindowLines,
  showDayAccessibilityLabel,
  showDayTitle,
  whenPhrase,
} from '../nextMatchCopy';

stubApiClientPerTest();

const todayIso = () => isoDay(new Date());

function makeFeed(): ClassesFeedStore {
  return createClassesFeed();
}

function request(
  dayIso: string,
  { query = null, category = null, nearMe = false, radiusKm = 5 }: { query?: string | null; category?: string | null; nearMe?: boolean; radiusKm?: number } = {},
): NextMatchRequest {
  return {
    dayIso,
    query,
    category,
    originLatitude: nearMe ? REYKJAVIK.latitude : null,
    originLongitude: nearMe ? REYKJAVIK.longitude : null,
    radiusKm: nearMe ? radiusKm : 0,
    attempt: 0,
  };
}

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Friday 2 October 2026, noon in Reykjavík. */
const friday = new Date('2026-10-02T12:00:00.000Z');

/** Monday 5 October 2026, 06:00 in Reykjavík (UTC+0). */
const hressMonday = () => classItem({ startsAt: new Date('2026-10-05T06:00:00.000Z') });

// MARK: - The window

describe('the window', () => {
  /**
   * The fortnight after the day, in one request the server accepts: its span
   * rule is floor((end 23:59:59.999 - start 00:00) / day) + 1 <= 14.
   */
  it('is the fortnight after the day, and the server accepts it', () => {
    const window = lookAheadWindow('2026-10-02')!;
    expect(window).toEqual({ start: '2026-10-03', end: '2026-10-16' });
    const from = Date.parse(`${window.start}T00:00:00Z`);
    const to = Date.parse(`${window.end}T00:00:00Z`) + 86_399_999;
    const span = Math.floor((to - from) / 86_400_000) + 1;
    expect(span).toBe(14);

    expect(lookAheadWindow('2026-12-25')).toEqual({ start: '2026-12-26', end: '2027-01-08' });
    expect(lookAheadWindow('not-a-day')).toBeNull();
    expect(lookAheadWindow('2026-02-31')).toBeNull();
  });
});

// MARK: - The client filters

describe('the client filters', () => {
  it("the look-ahead uses the list's own client filters", () => {
    const now = new Date();
    const started = classItem({ venue: NEARBY, startsAt: new Date(now.getTime() - 60_000) });
    const near = classItem({ venue: NEARBY, startsAt: new Date(now.getTime() + 3_600_000) });
    const far = classItem({ venue: HRESS, startsAt: new Date(now.getTime() + 3_600_000) });
    const unplaced = classItem({ venue: { name: 'Nowhere', lat: null, lon: null }, startsAt: new Date(now.getTime() + 3_600_000) });

    expect(passesClientFilters(started, now, null, 5)).toBe(false);
    expect(passesClientFilters(far, now, null, 5)).toBe(true);
    expect(passesClientFilters(unplaced, now, null, 5)).toBe(true);

    expect(passesClientFilters(near, now, REYKJAVIK, 1)).toBe(true);
    expect(passesClientFilters(far, now, REYKJAVIK, 5)).toBe(false);
    expect(passesClientFilters(far, now, REYKJAVIK, 10)).toBe(true);
    expect(passesClientFilters(unplaced, now, REYKJAVIK, 10)).toBe(false);
  });
});

// MARK: - The feed, end to end

describe('the feed, end to end', () => {
  it('an empty Pilates day names the next day with a match', async () => {
    const today = todayIso();
    const match = day(3, 6);
    api.on('GET', '/classes', (r) =>
      r.query.start === today
        ? page([])
        : page([classJSON({ startsAt: match }), classJSON({ name: 'Pilates later', startsAt: day(5, 7) })]),
    );
    const feed = makeFeed();
    feed.getState().applyInitialFilters('pilates', today);
    await feed.getState().reload();

    const pending = selectNextMatchRequest(feed.getState());
    expect(pending).not.toBeNull();
    expect(pending!.category).toBe('pilates');
    expect(pending!.query).toBeNull();
    expect(pending!.originLatitude).toBeNull();
    expect(selectNextMatchState(feed.getState())).toEqual({ kind: 'searching' });

    await feed.getState().findNextMatch(pending);

    const state = selectNextMatchState(feed.getState());
    expect(state?.kind).toBe('found');
    if (state?.kind !== 'found') return;
    expect(state.item.venue.name).toBe('Hress');
    expect(state.item.startsAt.getTime()).toBe(match.getTime());

    // What the phone asked: the day, then the fortnight after it, with the
    // same server-side filters.
    expect(api.requests).toHaveLength(2);
    const lookAhead = api.requests[1]!;
    expect(lookAhead.path).toBe('/classes');
    const window = lookAheadWindow(today)!;
    expect(lookAhead.query.start).toBe(window.start);
    expect(lookAhead.query.end).toBe(window.end);
    expect(lookAhead.query.category).toBe('pilates');
    expect(lookAhead.query.q).toBeUndefined();
    expect(lookAhead.query.cursor).toBeUndefined();
    expect(lookAhead.query.limit).toBe('100');

    // The button jumps the day selector to the match's day, filters kept.
    feed.getState().showNextMatchDay();
    expect(feed.getState().selectedDateIso).toBe(isoDay(match));
    expect(feed.getState().category).toBe('pilates');
  });

  it('the search text travels with the look-ahead', async () => {
    const today = todayIso();
    api.on('GET', '/classes', page([]));
    const feed = makeFeed();
    feed.getState().applyInitialFilters(null, today);
    // Typing schedules the feed's own debounced reload; wait for it rather than race it.
    feed.getState().setSearchText('  morning flow  ');
    await until(() => api.requests.length > 0 && !feed.getState().isLoading);
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]!.query.q).toBe('morning flow');
    const pending = selectNextMatchRequest(feed.getState());
    expect(pending?.query).toBe('morning flow');
    await feed.getState().findNextMatch(pending);
    expect(api.requests[api.requests.length - 1]!.query.q).toBe('morning flow');
    expect(selectNextMatchState(feed.getState())).toEqual({ kind: 'noneInWindow' });
  });

  it('nothing in the fortnight says so', async () => {
    const today = todayIso();
    api.on('GET', '/classes', page([]));
    const feed = makeFeed();
    feed.getState().applyInitialFilters('pilates', today);
    await feed.getState().reload();
    const pending = selectNextMatchRequest(feed.getState())!;
    await feed.getState().findNextMatch(pending);

    expect(selectNextMatchState(feed.getState())).toEqual({ kind: 'noneInWindow' });
    expect(noneInWindowLines(pending, new Date(), 'en')).toEqual(['No Pilates in the next two weeks.']);
    expect(noneInWindowLines(pending, new Date(), 'is')).toEqual(['Engir Pilates-tímar næstu tvær vikurnar.']);
  });

  /**
   * The feed's schedule reaches about a fortnight ahead. From today the
   * look-ahead reads exactly that, so "nothing in the next two weeks" is what
   * the data says. From a later day the window runs past the synced days (up
   * to today + 27), so the words name the day and say only that nothing later
   * is on the schedule yet.
   */
  it('nothing from a later day says no more than the schedule shows', () => {
    expect(lookAheadIsTheNextTwoWeeks('2026-10-02', friday)).toBe(true);
    expect(lookAheadIsTheNextTwoWeeks('2026-10-03', friday)).toBe(false);
    expect(lookAheadIsTheNextTwoWeeks('2026-10-15', friday)).toBe(false);
    // Reykjavík's day decides "today": 23:30 UTC on Friday is Friday.
    const lateFriday = new Date('2026-10-02T23:30:00.000Z');
    expect(lookAheadIsTheNextTwoWeeks('2026-10-02', lateFriday)).toBe(true);

    expect(noneInWindowLines(request('2026-10-02', { category: 'pilates' }), friday, 'en')).toEqual([
      'No Pilates in the next two weeks.',
    ]);

    const tomorrow = request('2026-10-03', { category: 'pilates' });
    expect(noneInWindowLines(tomorrow, friday, 'en')).toEqual(['No Pilates tomorrow.', 'Nothing later is on the schedule yet.']);
    expect(noneInWindowLines(tomorrow, friday, 'is')).toEqual([
      'Engir Pilates-tímar á morgun.',
      'Ekkert meira er komið á dagskrá enn.',
    ]);

    // The picker's last day (today + 13): its window is today + 14 ... 27.
    const lastPickable = request('2026-10-15', { category: 'yoga', nearMe: true, radiusKm: 10 });
    expect(noneInWindowLines(lastPickable, friday, 'en')).toEqual([
      'No yoga within 10 km on Thursday 15 October.',
      'Nothing later is on the schedule yet.',
    ]);
    expect(noneInWindowLines(lastPickable, friday, 'is')).toEqual([
      'Engir jógatímar innan 10 km fimmtudaginn 15. október.',
      'Ekkert meira er komið á dagskrá enn.',
    ]);
  });

  /**
   * A filter tap marks the feed loading in the same step as the filter
   * change, so nothing pairs the new category with the old feed (which would
   * start a look-ahead the reload then throws away). Two taps before the
   * first reload runs cost one GET, for the last filter.
   */
  it("a filter tap retires the old hint before its reload runs", async () => {
    const today = todayIso();
    api.on('GET', '/classes', page([]));
    const feed = makeFeed();
    feed.getState().applyInitialFilters(null, today);
    await feed.getState().reload();
    expect(selectNextMatchRequest(feed.getState())?.category).toBeNull();

    feed.getState().toggleCategory('pilates');
    expect(feed.getState().isLoading).toBe(true);
    expect(selectNextMatchRequest(feed.getState())).toBeNull();
    expect(selectNextMatchState(feed.getState())).toBeNull();

    feed.getState().toggleCategory('yoga');
    await until(() => !feed.getState().isLoading);
    expect(selectNextMatchRequest(feed.getState())?.category).toBe('yoga');
    expect(api.requests).toHaveLength(2);
    expect(api.requests[1]!.query.category).toBe('yoga');
  });

  /**
   * A network error keeps the feed's error UI (state `failed`); "Try again"
   * is a new request, so the stale failure is not shown for it, and a working
   * retry finds the match.
   */
  it('a network error shows the error state, and retry asks again', async () => {
    const today = todayIso();
    const match = day(2, 6);
    api.on('GET', '/classes', (r) => (r.query.start === today ? page([]) : Reply.raw(502, '<html>Bad gateway</html>')));
    const feed = makeFeed();
    feed.getState().applyInitialFilters('pilates', today);
    await feed.getState().reload();
    const first = selectNextMatchRequest(feed.getState())!;
    await feed.getState().findNextMatch(first);
    expect(selectNextMatchState(feed.getState())).toEqual({ kind: 'failed' });
    expect(feed.getState().loadFailed).toBe(false);

    api.on('GET', '/classes', (r) => (r.query.start === today ? page([]) : page([classJSON({ startsAt: match })])));
    feed.getState().retryNextMatch();
    const second = selectNextMatchRequest(feed.getState())!;
    expect(second).not.toEqual(first);
    expect(selectNextMatchState(feed.getState())).toEqual({ kind: 'searching' });

    // An answer for a request that is no longer current is dropped.
    await feed.getState().findNextMatch(first);
    expect(selectNextMatchState(feed.getState())).toEqual({ kind: 'searching' });

    await feed.getState().findNextMatch(second);
    const state = selectNextMatchState(feed.getState());
    expect(state?.kind).toBe('found');
    if (state?.kind === 'found') expect(state.item.startsAt.getTime()).toBe(match.getTime());
  });

  /**
   * A first page whose classes all fail the phone's own filters is not an
   * empty day while more pages exist: the rest of the day is read first, and
   * a class found there is listed instead of a hint.
   */
  it('an empty first page is not an empty day', async () => {
    const today = todayIso();
    const started = new Date(Date.now() - 3_600_000);
    const later = new Date(Date.now() + 2 * 3_600_000);
    api.on('GET', '/classes', (r) => {
      if (r.query.start !== today) return page([]);
      if (r.query.cursor === 'day-2') return page([classJSON({ startsAt: later })]);
      return page([classJSON({ startsAt: started })], 'day-2');
    });
    const feed = makeFeed();
    feed.getState().applyInitialFilters('pilates', today);
    await feed.getState().reload();
    expect(selectDayGroups(feed.getState())).toHaveLength(0);
    expect(selectNextMatchState(feed.getState())).toEqual({ kind: 'checkingDay' });

    await feed.getState().findNextMatch(selectNextMatchRequest(feed.getState()));

    expect(selectDayGroups(feed.getState()).length).toBeGreaterThan(0);
    expect(selectNextMatchRequest(feed.getState())).toBeNull();
    expect(api.requests.every((r) => r.query.start === today)).toBe(true);
    expect(api.requests[api.requests.length - 1]!.query.cursor).toBe('day-2');
  });

  it('a day still unread after three more pages gives up, and the day is read once', async () => {
    const today = todayIso();
    const started = new Date(Date.now() - 3_600_000);
    let next = 0;
    api.on('GET', '/classes', () => {
      next += 1;
      return page([classJSON({ startsAt: started })], `day-${next + 1}`);
    });
    const feed = makeFeed();
    feed.getState().applyInitialFilters(null, today);
    await feed.getState().reload();
    const pending = selectNextMatchRequest(feed.getState());
    // Two look-aheads for the same feed share one read of the day.
    await Promise.all([feed.getState().findNextMatch(pending), feed.getState().findNextMatch(pending)]);
    expect(selectNextMatchState(feed.getState())).toEqual({ kind: 'gaveUp' });
    expect(api.requests).toHaveLength(1 + 3);
  });

  it('a cancelled look-ahead writes nothing', async () => {
    const today = todayIso();
    api.on('GET', '/classes', (r) => (r.query.start === today ? page([]) : Reply.delayed(50, page([classJSON({ startsAt: day(2, 6) })]))));
    const feed = makeFeed();
    feed.getState().applyInitialFilters(null, today);
    await feed.getState().reload();
    const controller = new AbortController();
    const running = feed.getState().findNextMatch(selectNextMatchRequest(feed.getState()), controller.signal);
    controller.abort();
    await running;
    expect(feed.getState().nextMatchResult).toBeNull();
    expect(selectNextMatchState(feed.getState())).toEqual({ kind: 'searching' });
  });

  /** The jump can land on a day past the picker's 14-day horizon (from today + 14 on): the picker still shows it. */
  it('the picker reaches a day past the horizon', () => {
    const now = new Date();
    const past = isoDay(day(MAX_PICKER_DAYS));
    const feed = makeFeed();
    feed.getState().applyInitialFilters(null, past);
    expect(pickerRange(now, feed.getState().selectedDateIso).last).toBe(past);
    expect(pickerRange(now, makeFeed().getState().selectedDateIso).last).toBe(isoDay(day(MAX_PICKER_DAYS - 1)));
  });
});

// MARK: - The words

describe('the words', () => {
  it("the owner's example, in both languages", () => {
    const item = hressMonday();
    const pilatesToday = request('2026-10-02', { category: 'pilates' });
    expect(headline(pilatesToday, false, friday, 'en')).toBe('No Pilates today.');
    expect(nextLine(item, 'en')).toBe('Next: Mon 5 Oct · Hress 06:00');
    expect(showDayTitle(item, 'en')).toBe('Show Mon 5 Oct');

    expect(headline(pilatesToday, false, friday, 'is')).toBe('Engir Pilates-tímar í dag.');
    expect(nextLine(item, 'is')).toBe('Næst: mán. 5. okt. · Hress 06:00');
    expect(showDayTitle(item, 'is')).toBe('Sýna mán. 5. okt.');
  });

  it('the day is named the way a person would say it', () => {
    const tomorrow = request('2026-10-03', { category: 'pilates' });
    expect(headline(tomorrow, false, friday, 'en')).toBe('No Pilates tomorrow.');
    expect(headline(tomorrow, false, friday, 'is')).toBe('Engir Pilates-tímar á morgun.');

    const sunday = request('2026-10-04', { category: 'pilates' });
    expect(headline(sunday, false, friday, 'en')).toBe('No Pilates on Sunday 4 October.');
    expect(headline(sunday, false, friday, 'is')).toBe('Engir Pilates-tímar sunnudaginn 4. október.');

    // "Today" follows Reykjavík's day, not the phone's: 23:30 UTC on Friday is still Friday in Iceland.
    expect(whenPhrase('2026-10-02', new Date('2026-10-02T23:30:00.000Z'), 'en')).toBe('today');
  });

  it('every filter combination reads naturally', () => {
    const cases: [NextMatchRequest, string, string][] = [
      [request('2026-10-02', { category: 'yoga', nearMe: true, radiusKm: 5 }), 'No yoga within 5 km today.', 'Engir jógatímar innan 5 km í dag.'],
      [request('2026-10-02', { category: 'strength' }), 'No strength classes today.', 'Engir styrktartímar í dag.'],
      [request('2026-10-02', { query: 'morning', category: 'pilates' }), 'No classes match these filters today.', 'Engir tímar passa við síurnar í dag.'],
      [request('2026-10-02', { category: 'aerial-silks' }), 'No classes match these filters today.', 'Engir tímar passa við síurnar í dag.'],
      [request('2026-10-02'), 'No classes today.', 'Engir tímar í dag.'],
      [request('2026-10-02', { nearMe: true, radiusKm: 1 }), 'No classes within 1 km today.', 'Engir tímar innan 1 km í dag.'],
    ];
    for (const [pending, en, is] of cases) {
      expect(headline(pending, false, friday, 'en')).toBe(en);
      expect(headline(pending, false, friday, 'is')).toBe(is);
    }
  });

  it('a screen reader hears the day spelled out', () => {
    const item = hressMonday();
    expect(accessibilityLabel('No Pilates today.', item, 'en')).toBe('No Pilates today. Next: Monday 5 October at 06:00, Hress.');
    expect(showDayAccessibilityLabel(item, 'en')).toBe('Show classes on Monday 5 October');
    expect(accessibilityLabel('Engir Pilates-tímar í dag.', item, 'is')).toBe(
      'Engir Pilates-tímar í dag. Næst: mánudaginn 5. október kl. 06:00, Hress.',
    );
    expect(showDayAccessibilityLabel(item, 'is')).toBe('Sýna tíma mánudaginn 5. október');
  });

  it('every hint string exists in both languages, without dashes', () => {
    const keys = Object.keys(tables.en).filter((key) => key.startsWith('classes.next_'));
    expect(keys).toHaveLength(24);
    for (const key of keys) {
      const is = tables.is[key];
      expect(is).toBeTruthy();
      for (const value of [tables.en[key]!, is ?? '']) {
        expect(value).not.toMatch(/[–—]/);
      }
    }
    // Every featured chip has a noun in both languages.
    for (const slug of FEATURED_CATEGORIES) {
      expect(tables.en[`classes.next_what_${slug}`]).toBeTruthy();
      expect(tables.is[`classes.next_what_${slug}`]).toBeTruthy();
    }
  });
});
