/**
 * The feed's own rules (iOS ClassesViewModel): the stale-response guard,
 * pagination, the search debounce, the 30 s tick, the quick days, the
 * Reykjavík day grouping and Plan's pre-filtered opening.
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { classJSON, day, page } from '../../__tests__/feedFixtures';
import {
  createClassesFeed,
  MAX_QUERY_LENGTH,
  selectActiveFilterCount,
  selectDayGroups,
  selectNextMatchRequest,
  trimmedQuery,
} from '../classesFeedStore';
import { circleDayNumber, customDateActive, isoDay, quickDates, selectedOrToday } from '../days';

stubApiClientPerTest();

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('loading', () => {
  it('the first load asks for the default window and lists the classes', async () => {
    api.on('GET', '/classes', page([classJSON({ startsAt: day(1, 9) }), classJSON({ startsAt: day(2, 9) })], 'next'));
    const feed = createClassesFeed();
    await feed.getState().loadInitial();
    expect(api.sent('/classes').query).toEqual({ limit: '100' });
    expect(feed.getState().items).toHaveLength(2);
    expect(feed.getState().nextCursor).toBe('next');
    expect(feed.getState().isLoading).toBe(false);
    expect(selectDayGroups(feed.getState())).toHaveLength(2);

    // A second visit with classes on screen asks nothing.
    await feed.getState().loadInitial();
    expect(api.requests).toHaveLength(1);
  });

  it('a failed load shows the error, and a reload clears it', async () => {
    api.on('GET', '/classes', Reply.problem(500, 'internal_error'));
    const feed = createClassesFeed();
    await feed.getState().reload();
    expect(feed.getState().loadFailed).toBe(true);
    expect(feed.getState().isLoading).toBe(false);

    api.on('GET', '/classes', page([]));
    const reloading = feed.getState().reload();
    expect(feed.getState().loadFailed).toBe(false);
    expect(feed.getState().isLoading).toBe(true);
    await reloading;
    expect(feed.getState().loadFailed).toBe(false);
  });

  it('a stale response never writes: only the newest request does', async () => {
    let call = 0;
    api.on('GET', '/classes', () => {
      call += 1;
      return call === 1
        ? Reply.delayed(80, page([classJSON({ name: 'Old', startsAt: day(1, 9) })]))
        : page([classJSON({ name: 'New', startsAt: day(1, 10) })]);
    });
    const feed = createClassesFeed();
    const first = feed.getState().reload();
    await feed.getState().reload();
    await first;
    expect(feed.getState().items.map((item) => item.name)).toEqual(['New']);
    expect(feed.getState().isLoading).toBe(false);
  });

  it('a reload resets a load-more in flight, and its answer is dropped', async () => {
    api.on('GET', '/classes', page([classJSON({ startsAt: day(1, 9) })], 'more'));
    const feed = createClassesFeed();
    await feed.getState().reload();

    api.on('GET', '/classes', (r) =>
      r.query.cursor ? Reply.delayed(80, page([classJSON({ name: 'Late', startsAt: day(1, 11) })])) : page([classJSON({ name: 'Fresh', startsAt: day(1, 10) })]),
    );
    const more = feed.getState().loadMore();
    expect(feed.getState().isLoadingMore).toBe(true);
    const reloading = feed.getState().reload();
    expect(feed.getState().isLoadingMore).toBe(false);
    await reloading;
    await more;
    expect(feed.getState().isLoadingMore).toBe(false);
    expect(feed.getState().items.map((item) => item.name)).toEqual(['Fresh']);
  });

  it('load more appends and moves the cursor; a failure keeps the cursor for a retry', async () => {
    api.on('GET', '/classes', page([classJSON({ name: 'A', startsAt: day(1, 9) })], 'p2'));
    const feed = createClassesFeed();
    await feed.getState().reload();

    api.on('GET', '/classes', Reply.problem(500, 'internal_error'));
    await feed.getState().loadMore();
    expect(feed.getState().nextCursor).toBe('p2');
    expect(feed.getState().isLoadingMore).toBe(false);
    expect(feed.getState().loadFailed).toBe(false);

    api.on('GET', '/classes', page([classJSON({ name: 'B', startsAt: day(1, 10) })]));
    await feed.getState().loadMore();
    expect(api.sent('/classes').query.cursor).toBe('p2');
    expect(feed.getState().items.map((item) => item.name)).toEqual(['A', 'B']);
    expect(feed.getState().nextCursor).toBeNull();

    // No cursor, nothing to ask.
    const asked = api.requests.length;
    await feed.getState().loadMore();
    expect(api.requests).toHaveLength(asked);
  });

  it('load more carries the filters of the list', async () => {
    api.on('GET', '/classes', page([classJSON({ startsAt: day(1, 9) })], 'p2'));
    const feed = createClassesFeed();
    const tomorrow = isoDay(day(1));
    feed.getState().applyInitialFilters('yoga', tomorrow);
    await feed.getState().reload();
    await feed.getState().loadMore();
    expect(api.sent('/classes').query).toEqual({ limit: '100', category: 'yoga', start: tomorrow, end: tomorrow, cursor: 'p2' });
  });
});

describe('the search', () => {
  it('is trimmed and cut to 80 characters, and empty is none', () => {
    expect(trimmedQuery('  yoga  ')).toBe('yoga');
    expect(trimmedQuery('   ')).toBeNull();
    expect(trimmedQuery('x'.repeat(100))).toHaveLength(MAX_QUERY_LENGTH);
  });

  it('typing is debounced into one reload with the last text', async () => {
    api.on('GET', '/classes', page([]));
    const feed = createClassesFeed({ searchDebounceMs: 30 });
    feed.getState().setSearchText('y');
    feed.getState().setSearchText('yo');
    feed.getState().setSearchText('yoga');
    await until(() => api.requests.length > 0 && !feed.getState().isLoading);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]!.query.q).toBe('yoga');
    expect(feed.getState().loadedQuery).toBe('yoga');
  });

  it('a filter tap cancels a pending debounce: one request, carrying the text', async () => {
    api.on('GET', '/classes', page([]));
    const feed = createClassesFeed({ searchDebounceMs: 30 });
    feed.getState().setSearchText('flow');
    feed.getState().toggleCategory('yoga');
    await until(() => !feed.getState().isLoading);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]!.query).toEqual({ limit: '100', q: 'flow', category: 'yoga' });
  });

  it('a screen that goes away never fires its debounce', async () => {
    api.on('GET', '/classes', page([]));
    const feed = createClassesFeed({ searchDebounceMs: 20 });
    feed.getState().setSearchText('yoga');
    feed.getState().dispose();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(api.requests).toHaveLength(0);
  });
});

describe('filters', () => {
  it("Plan's opening sets the category and day without asking, and the first load carries both", async () => {
    api.on('GET', '/classes', page([]));
    const feed = createClassesFeed();
    const tomorrow = isoDay(day(1));
    feed.getState().applyInitialFilters('aerial-silks', tomorrow);
    expect(api.requests).toHaveLength(0);
    expect(feed.getState().isLoading).toBe(false);
    await feed.getState().loadInitial();
    expect(api.requests).toHaveLength(1);
    expect(api.sent('/classes').query).toEqual({ limit: '100', category: 'aerial-silks', start: tomorrow, end: tomorrow });
  });

  it('empty initial filters change nothing', () => {
    const feed = createClassesFeed();
    feed.getState().applyInitialFilters('', undefined);
    expect(feed.getState().category).toBeNull();
    expect(feed.getState().selectedDateIso).toBeNull();
  });

  it('a category chip toggles, and a quick day chip toggles back to the default window', async () => {
    api.on('GET', '/classes', page([]));
    const feed = createClassesFeed();
    const today = isoDay(new Date());
    feed.getState().toggleCategory('yoga');
    expect(feed.getState().category).toBe('yoga');
    feed.getState().toggleCategory('yoga');
    expect(feed.getState().category).toBeNull();

    feed.getState().toggleDate(today);
    expect(feed.getState().selectedDateIso).toBe(today);
    feed.getState().toggleDate(today);
    expect(feed.getState().selectedDateIso).toBeNull();

    feed.getState().selectCustomDate(today);
    feed.getState().selectCustomDate(today);
    expect(feed.getState().selectedDateIso).toBe(today);
    feed.getState().clearDate();
    expect(feed.getState().selectedDateIso).toBeNull();
    await until(() => !feed.getState().isLoading);
  });

  it('the Filters badge counts Near me, a day and a category', () => {
    expect(selectActiveFilterCount({ nearMeEnabled: false, selectedDateIso: null, category: null })).toBe(0);
    expect(selectActiveFilterCount({ nearMeEnabled: true, selectedDateIso: '2026-10-02', category: 'yoga' })).toBe(3);
    expect(selectActiveFilterCount({ nearMeEnabled: false, selectedDateIso: '2026-10-02', category: null })).toBe(1);
  });

  it('the radius is client-side: changing it asks nothing', async () => {
    api.on('GET', '/classes', page([]));
    const feed = createClassesFeed();
    feed.getState().toggleNearMe();
    feed.getState().setRadius(1);
    expect(feed.getState().radiusKm).toBe(1);
    expect(api.requests).toHaveLength(0);
  });
});

describe('the clock', () => {
  it('the tick moves now, so a class that starts drops off', async () => {
    let now = new Date('2026-10-02T08:59:00.000Z');
    api.on('GET', '/classes', page([classJSON({ startsAt: new Date('2026-10-02T09:00:00.000Z') })]));
    const feed = createClassesFeed({ clock: () => now });
    await feed.getState().loadInitial();
    expect(selectDayGroups(feed.getState())).toHaveLength(1);
    now = new Date('2026-10-02T09:00:30.000Z');
    feed.getState().tick();
    expect(selectDayGroups(feed.getState())).toHaveLength(0);
    expect(api.requests).toHaveLength(1);
  });

  it('a selected day that is now in the past snaps back to the default window and reloads', async () => {
    let now = new Date('2026-10-02T23:59:50.000Z');
    api.on('GET', '/classes', page([]));
    const feed = createClassesFeed({ clock: () => now });
    feed.getState().applyInitialFilters(null, '2026-10-02');
    await feed.getState().reload();
    expect(api.sent('/classes').query.start).toBe('2026-10-02');

    now = new Date('2026-10-03T00:00:20.000Z');
    feed.getState().tick();
    expect(feed.getState().selectedDateIso).toBeNull();
    expect(feed.getState().isLoading).toBe(true);
    await until(() => !feed.getState().isLoading);
    expect(api.sent('/classes').query.start).toBeUndefined();
  });

  it('a load never asks for a day that has gone by', async () => {
    api.on('GET', '/classes', page([]));
    const feed = createClassesFeed({ clock: () => new Date('2026-10-02T12:00:00.000Z') });
    feed.getState().applyInitialFilters(null, '2026-10-01');
    await feed.getState().loadInitial();
    expect(feed.getState().selectedDateIso).toBeNull();
    expect(api.sent('/classes').query).toEqual({ limit: '100' });
  });

  it('the quick days roll at Reykjavík midnight', () => {
    expect(quickDates(new Date('2026-10-02T23:59:59.000Z'))).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
    expect(quickDates(new Date('2026-10-03T00:00:00.000Z'))).toEqual(['2026-10-03', '2026-10-04', '2026-10-05']);
    expect(quickDates(new Date('2026-12-31T10:00:00.000Z'))).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('the calendar circle shows today, or the custom pick', () => {
    const now = new Date('2026-10-02T12:00:00.000Z');
    expect(circleDayNumber(now, null)).toBe(2);
    expect(customDateActive(now, '2026-10-03')).toBe(false);
    expect(circleDayNumber(now, '2026-10-03')).toBe(2);
    expect(customDateActive(now, '2026-10-09')).toBe(true);
    expect(circleDayNumber(now, '2026-10-09')).toBe(9);
    expect(selectedOrToday(now, null)).toBe('2026-10-02');
    expect(selectedOrToday(now, '2026-10-09')).toBe('2026-10-09');
  });
});

describe('the day groups', () => {
  /** 23:30 UTC on Friday is still Friday in Iceland, whatever zone the phone is in. */
  it('group by the Reykjavík day, in day order and feed order', async () => {
    const now = new Date('2026-10-02T12:00:00.000Z');
    api.on(
      'GET',
      '/classes',
      page([
        classJSON({ name: 'Late Friday', startsAt: new Date('2026-10-02T23:30:00.000Z') }),
        classJSON({ name: 'Early Saturday', startsAt: new Date('2026-10-03T00:15:00.000Z') }),
        classJSON({ name: 'Friday evening', startsAt: new Date('2026-10-02T18:00:00.000Z') }),
      ]),
    );
    const feed = createClassesFeed({ clock: () => now });
    await feed.getState().loadInitial();
    const groups = selectDayGroups(feed.getState());
    expect(groups.map((group) => group.dayIso)).toEqual(['2026-10-02', '2026-10-03']);
    expect(groups[0]!.entries.map((entry) => entry.item.name)).toEqual(['Late Friday', 'Friday evening']);
    expect(groups[1]!.entries.map((entry) => entry.item.name)).toEqual(['Early Saturday']);
  });

  it('the hint applies only to a selected day, after it has loaded', async () => {
    api.on('GET', '/classes', page([]));
    const feed = createClassesFeed();
    await feed.getState().reload();
    expect(selectNextMatchRequest(feed.getState())).toBeNull();

    feed.getState().toggleDate(isoDay(new Date()));
    expect(selectNextMatchRequest(feed.getState())).toBeNull();
    await until(() => !feed.getState().isLoading);
    expect(selectNextMatchRequest(feed.getState())).not.toBeNull();
  });
});
