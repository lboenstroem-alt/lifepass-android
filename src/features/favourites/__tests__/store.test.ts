/**
 * The shared favourites store: iOS VenueDetailViewModel.toggleFavourite's
 * rules (optimistic, one request at a time per venue, revert with the alert),
 * and how the optimistic state meets the server's reads.
 */
import { setCurrentLanguage } from '../../../i18n';
import type { FavouriteVenue, FavouritesPayload } from '../api';
import { createFavouritesStore, type FavouritesApi } from '../store';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

function row(venueId: string, name = 'Venue'): FavouriteVenue {
  return {
    id: `f-${venueId}`,
    venueId,
    slug: name.toLowerCase(),
    name,
    description: null,
    city: null,
    address: null,
    inBundle: true,
    imageUrl: null,
    categories: null,
    createdAt: null,
  };
}

const payload = (...venueIds: string[]): FavouritesPayload => ({ venues: venueIds.map((id) => row(id)), activities: [], attractions: [] });

/** A promise the test settles by hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * A store over a fake server: by default the writes change what the next read
 * lists, as the real API does; a test overrides any call.
 */
function setup(api: Partial<FavouritesApi> = {}, initial: string[] = []) {
  const alerts: string[] = [];
  const calls: string[] = [];
  let server = [...initial];
  const store = createFavouritesStore({
    api: {
      fetch: jest.fn(async () => payload(...server)),
      addVenue: jest.fn(async (id: string) => {
        calls.push(`add ${id}`);
        if (!server.includes(id)) server = [...server, id];
      }),
      removeVenue: jest.fn(async (id: string) => {
        calls.push(`remove ${id}`);
        server = server.filter((s) => s !== id);
      }),
      ...api,
    },
    alert: (message) => alerts.push(message),
  });
  return { store, alerts, calls };
}

describe('the heart', () => {
  it('flips at once, before the server answers', async () => {
    const add = deferred();
    // The server lists A once the add has landed.
    const { store } = setup({ addVenue: () => add.promise, fetch: async () => payload(A) });
    const pending = store.getState().toggle(A);
    expect(store.getState().isFavourite(A)).toBe(true);
    expect(store.getState().isToggling(A)).toBe(true);
    add.resolve();
    await expect(pending).resolves.toBe('added');
    expect(store.getState().isFavourite(A)).toBe(true);
    expect(store.getState().isToggling(A)).toBe(false);
  });

  it('flips back on a failure and says so in English', async () => {
    setCurrentLanguage('en');
    const { store, alerts } = setup({ addVenue: async () => Promise.reject(new Error('500')) });
    await expect(store.getState().toggle(A)).resolves.toBe('failed');
    expect(store.getState().isFavourite(A)).toBe(false);
    expect(alerts).toEqual(['Could not update your favourites. Please try again.']);
  });

  it('flips back on a failure and says so in Icelandic', async () => {
    setCurrentLanguage('is');
    const { store, alerts } = setup({
      fetch: async () => payload(A),
      removeVenue: async () => Promise.reject(new Error('500')),
    });
    await store.getState().load();
    expect(store.getState().isFavourite(A)).toBe(true);
    await store.getState().toggle(A);
    expect(store.getState().isFavourite(A)).toBe(true);
    expect(alerts).toEqual(['Ekki tókst að uppfæra uppáhaldið þitt. Reyndu aftur.']);
  });

  it('ignores a second tap while the first is in flight (no add-then-remove)', async () => {
    const add = deferred();
    const { store, calls } = setup({
      addVenue: (id) => {
        calls.push(`add ${id}`);
        return add.promise;
      },
    });
    const first = store.getState().toggle(A);
    await expect(store.getState().toggle(A)).resolves.toBe('ignored');
    expect(store.getState().isFavourite(A)).toBe(true);
    add.resolve();
    await first;
    expect(calls).toEqual([`add ${A}`]);
  });

  it('lets another venue toggle while one is in flight (the guard is per venue, as per page on iOS)', async () => {
    const add = deferred();
    const { store, calls } = setup({
      addVenue: (id) => {
        calls.push(`add ${id}`);
        return id === A ? add.promise : Promise.resolve();
      },
    });
    const first = store.getState().toggle(A);
    await expect(store.getState().toggle(B)).resolves.toBe('added');
    add.resolve();
    await first;
    expect(calls).toEqual([`add ${A}`, `add ${B}`]);
  });

  it('stays quiet where iOS reverts silently ({ alert: false })', async () => {
    const { store, alerts } = setup({ addVenue: async () => Promise.reject(new Error('500')) });
    await store.getState().toggle(A, { alert: false });
    expect(store.getState().isFavourite(A)).toBe(false);
    expect(alerts).toEqual([]);
  });

  it('unsaves with DELETE, and the row leaves the list at once', async () => {
    const remove = deferred();
    const { store } = setup({ fetch: async () => payload(A, B), removeVenue: () => remove.promise });
    await store.getState().load();
    const pending = store.getState().toggle(A);
    expect(store.getState().venues.map((v) => v.venueId)).toEqual([B]);
    remove.resolve();
    await expect(pending).resolves.toBe('removed');
    expect(store.getState().savedIds).toEqual([B]);
  });

  it('add and remove send nothing when the venue already reads that way', async () => {
    const { store, calls } = setup({ fetch: async () => payload(A) });
    await store.getState().load();
    await expect(store.getState().add(A)).resolves.toBe('added');
    await expect(store.getState().remove(B)).resolves.toBe('removed');
    expect(calls).toEqual([]);
  });

  it('compares ids whatever their case', async () => {
    const { store } = setup({ fetch: async () => payload(A) });
    await store.getState().load();
    expect(store.getState().isFavourite(A.toUpperCase())).toBe(true);
  });
});

describe('the reads', () => {
  it('a failed read means not saved, and keeps whatever was there', async () => {
    let fail = true;
    const { store } = setup({
      fetch: async () => {
        if (fail) throw new Error('offline');
        return payload(A);
      },
    });
    await store.getState().load();
    expect(store.getState().status).toBe('failed');
    expect(store.getState().isFavourite(A)).toBe(false);
    fail = false;
    await store.getState().load();
    expect(store.getState().isFavourite(A)).toBe(true);
    fail = true;
    await store.getState().load();
    expect(store.getState().isFavourite(A)).toBe(true);
    expect(store.getState().loaded).toBe(true);
  });

  it('joins a read already on its way', async () => {
    const fetch = jest.fn(async () => payload(A));
    const { store } = setup({ fetch });
    await Promise.all([store.getState().load(), store.getState().load(), store.getState().ensureLoaded()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await store.getState().ensureLoaded();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a read that started before the tap does not undo it', async () => {
    const read = deferred<FavouritesPayload>();
    let reads = 0;
    const { store } = setup({
      fetch: () => {
        reads += 1;
        return reads === 1 ? read.promise : Promise.resolve(payload(A));
      },
    });
    const loading = store.getState().load();
    await store.getState().toggle(A); // confirmed while the first read is out
    read.resolve(payload()); // the old read: A not saved yet
    await loading;
    expect(store.getState().isFavourite(A)).toBe(true);
  });

  it('a read while the write is in flight keeps the tap', async () => {
    const remove = deferred();
    const { store } = setup({ fetch: async () => payload(A), removeVenue: () => remove.promise });
    await store.getState().load();
    const pending = store.getState().toggle(A);
    await store.getState().load({ force: true }); // the server still lists A
    expect(store.getState().isFavourite(A)).toBe(false);
    remove.resolve();
    await pending;
    expect(store.getState().isFavourite(A)).toBe(false);
  });

  it('reads the list again after an add, so the new row reaches Saved', async () => {
    let server: string[] = [];
    const { store } = setup({
      fetch: async () => payload(...server),
      addVenue: async (id) => {
        server = [...server, id];
      },
    });
    await store.getState().load();
    await store.getState().toggle(A);
    await flush();
    expect(store.getState().venues.map((v) => v.venueId)).toEqual([A]);
    expect(store.getState().overrides).toEqual({});
  });

  it('a later read the server answers differently wins once the tap is confirmed', async () => {
    let server: string[] = [];
    const { store } = setup({ fetch: async () => payload(...server) });
    await store.getState().toggle(A);
    await flush();
    // Unsaved on the web meanwhile.
    server = [];
    await store.getState().load({ force: true });
    expect(store.getState().isFavourite(A)).toBe(false);
  });
});

describe('sign-out', () => {
  it('forgets the list and drops answers still on their way', async () => {
    const read = deferred<FavouritesPayload>();
    const add = deferred();
    const { store, alerts } = setup({ fetch: () => read.promise, addVenue: () => add.promise });
    const loading = store.getState().load();
    const toggling = store.getState().toggle(B);
    store.getState().reset();
    expect(store.getState().savedIds).toEqual([]);
    expect(store.getState().status).toBe('idle');
    read.resolve(payload(A));
    add.reject(new Error('gone'));
    await loading;
    await toggling;
    expect(store.getState().savedIds).toEqual([]);
    expect(store.getState().loaded).toBe(false);
    expect(alerts).toEqual([]);
  });
});

describe('saved classes', () => {
  it('adds and removes a class, then reads the list again', async () => {
    const addActivity = jest.fn(async () => undefined);
    const removeActivity = jest.fn(async () => undefined);
    const fetch = jest.fn(async () => payload());
    const { store } = setup({ fetch, addActivity, removeActivity });
    await store.getState().addActivity('CCCCCCCC-0000-4000-8000-000000000003');
    expect(addActivity).toHaveBeenCalledWith('cccccccc-0000-4000-8000-000000000003');
    await store.getState().removeActivity('cccccccc-0000-4000-8000-000000000003');
    expect(removeActivity).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws a failure for the caller to word', async () => {
    const { store } = setup({ addActivity: async () => Promise.reject(new Error('500')) });
    await expect(store.getState().addActivity('x')).rejects.toThrow('500');
  });
});
