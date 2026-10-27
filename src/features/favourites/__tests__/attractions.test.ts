/**
 * Saved hikes and sights in the favourites store (API 0.45.0, docs/05 "Saved
 * hikes and sights"): every heart drawn from the set of saved slugs, the
 * optimistic toggle and its rollback with the contract's words, (a) the set
 * forgotten on sign-out, and (b) a heart pressed before the list arrived
 * checked against the list afterwards, whatever the write's answer.
 */
import { NotAuthenticatedError, ProblemError, TransportError } from '../../../api';
import { setCurrentLanguage } from '../../../i18n';
import type { FavouriteAttraction, FavouritesPayload } from '../api';
import { createFavouritesStore, type FavouritesApi } from '../store';

const SKOGAFOSS = 'skogafoss';
const GLYMUR = 'glymur';
const VENUE = 'aaaaaaaa-0000-4000-8000-000000000001';

function place(slug: string, name = slug): FavouriteAttraction {
  return {
    id: `fav-${slug}`,
    attractionId: null,
    slug,
    name,
    localName: name,
    kind: 'waterfall',
    kindLabel: 'Waterfall',
    region: 'south',
    regionLabel: 'South Iceland',
    lengthM: null,
    durationMinutes: null,
    difficulty: null,
    difficultyLabel: null,
    outAndBack: false,
    imageUrl: null,
    imageAlt: null,
    imageIsMapPlate: true,
    imageCredit: null,
    imageLicense: null,
    createdAt: null,
  };
}

const payload = (...slugs: string[]): FavouritesPayload => ({ venues: [], activities: [], attractions: slugs.map((s) => place(s)) });

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

/** A refusal as the client throws it: a problem with a status. */
const refused = (status: number) =>
  new ProblemError({ type: 'https://lifepass.is/problems/favourite_target_not_found', title: 'Not found', status }, status);

/**
 * A store over a fake server: the writes change what the next read lists, as
 * the real API does (both are idempotent); a test overrides any call.
 */
function setup(api: Partial<FavouritesApi> = {}, initial: string[] = []) {
  const alerts: string[] = [];
  const calls: string[] = [];
  let server = [...initial];
  const fetch = jest.fn(async () => payload(...server));
  const store = createFavouritesStore({
    api: {
      fetch,
      addAttraction: jest.fn(async (slug: string) => {
        calls.push(`save ${slug}`);
        if (!server.includes(slug)) server = [slug, ...server];
      }),
      removeAttraction: jest.fn(async (slug: string) => {
        calls.push(`remove ${slug}`);
        server = server.filter((s) => s !== slug);
      }),
      ...api,
    },
    alert: (message) => alerts.push(message),
  });
  return { store, alerts, calls, fetch, setServer: (slugs: string[]) => (server = slugs) };
}

beforeEach(() => setCurrentLanguage('en'));

describe('the saved set', () => {
  it('draws every heart from the list: saved slugs are filled, the rest are not', async () => {
    const { store } = setup({}, [SKOGAFOSS]);
    expect(store.getState().isAttractionSaved(SKOGAFOSS)).toBe(false);
    await store.getState().load();
    expect(store.getState().savedSlugs).toEqual([SKOGAFOSS]);
    expect(store.getState().isAttractionSaved(SKOGAFOSS)).toBe(true);
    expect(store.getState().isAttractionSaved(GLYMUR)).toBe(false);
    expect(store.getState().attractions.map((a) => a.slug)).toEqual([SKOGAFOSS]);
  });

  it('a venue heart’s tap leaves the places’ list as it is', async () => {
    const add = deferred();
    const { store } = setup({ addVenue: () => add.promise }, [SKOGAFOSS]);
    await store.getState().load();
    const places = store.getState().attractions;
    const slugs = store.getState().savedSlugs;
    const pending = store.getState().toggle(VENUE);
    expect(store.getState().attractions).toBe(places);
    expect(store.getState().savedSlugs).toBe(slugs);
    add.resolve();
    await pending;
  });
});

describe('the heart', () => {
  it('flips at once, before the server answers, and the save is confirmed', async () => {
    const save = deferred();
    let landed = false;
    const { store, calls } = setup({
      // The server lists the place once the save has landed.
      fetch: async () => payload(...(landed ? [SKOGAFOSS] : [])),
      addAttraction: async (slug) => {
        calls.push(`save ${slug}`);
        await save.promise;
        landed = true;
      },
    });
    await store.getState().load();
    const pending = store.getState().toggleAttraction(SKOGAFOSS);
    expect(store.getState().isAttractionSaved(SKOGAFOSS)).toBe(true);
    expect(store.getState().isAttractionToggling(SKOGAFOSS)).toBe(true);
    save.resolve();
    await expect(pending).resolves.toBe('added');
    expect(store.getState().isAttractionSaved(SKOGAFOSS)).toBe(true);
    expect(store.getState().isAttractionToggling(SKOGAFOSS)).toBe(false);
    expect(calls).toEqual([`save ${SKOGAFOSS}`]);
  });

  it('a refused save puts the heart back and says so (English)', async () => {
    const { store, alerts } = setup({ addAttraction: async () => Promise.reject(refused(404)) });
    await store.getState().load();
    await expect(store.getState().toggleAttraction(SKOGAFOSS)).resolves.toBe('failed');
    expect(store.getState().isAttractionSaved(SKOGAFOSS)).toBe(false);
    expect(alerts).toEqual(['Could not save favourite. Please try again.']);
  });

  it('a refused remove puts the heart back and says so (Icelandic)', async () => {
    setCurrentLanguage('is');
    const { store, alerts } = setup({ removeAttraction: async () => Promise.reject(refused(429)) }, [SKOGAFOSS]);
    await store.getState().load();
    await expect(store.getState().toggleAttraction(SKOGAFOSS)).resolves.toBe('failed');
    expect(store.getState().isAttractionSaved(SKOGAFOSS)).toBe(true);
    expect(store.getState().attractions.map((a) => a.slug)).toEqual([SKOGAFOSS]);
    expect(alerts).toEqual(['Ekki tókst að fjarlægja uppáhald. Reyndu aftur.']);
  });

  it('a network failure is refused too: back, and said', async () => {
    const { store, alerts } = setup({ addAttraction: async () => Promise.reject(new TransportError('offline')) });
    await store.getState().load();
    await store.getState().toggleAttraction(GLYMUR);
    expect(store.getState().isAttractionSaved(GLYMUR)).toBe(false);
    expect(alerts).toEqual(['Could not save favourite. Please try again.']);
  });

  it('a session that has ended puts the heart back without a word: the app is going to sign-in', async () => {
    const { store, alerts } = setup({ addAttraction: async () => Promise.reject(new NotAuthenticatedError()) });
    await store.getState().load();
    await expect(store.getState().toggleAttraction(SKOGAFOSS)).resolves.toBe('failed');
    expect(store.getState().isAttractionSaved(SKOGAFOSS)).toBe(false);
    expect(alerts).toEqual([]);
  });

  it('a call the app cancelled says nothing either', async () => {
    const { store, alerts } = setup({ addAttraction: async () => Promise.reject(new TransportError('cancelled')) });
    await store.getState().load();
    await store.getState().toggleAttraction(SKOGAFOSS);
    expect(alerts).toEqual([]);
  });

  it('ignores a second tap while the first is in flight (never save-then-remove)', async () => {
    const save = deferred();
    const { store, calls } = setup({
      addAttraction: (slug) => {
        calls.push(`save ${slug}`);
        return save.promise;
      },
    });
    await store.getState().load();
    const first = store.getState().toggleAttraction(SKOGAFOSS);
    await expect(store.getState().toggleAttraction(SKOGAFOSS)).resolves.toBe('ignored');
    save.resolve();
    await first;
    expect(calls).toEqual([`save ${SKOGAFOSS}`]);
  });

  it('the Favourites row takes the place off the list at once, and back if refused', async () => {
    const remove = deferred();
    const { store } = setup({ removeAttraction: () => remove.promise }, [SKOGAFOSS, GLYMUR]);
    await store.getState().load();
    const pending = store.getState().removeAttraction(SKOGAFOSS);
    expect(store.getState().attractions.map((a) => a.slug)).toEqual([GLYMUR]);
    remove.reject(refused(500));
    await expect(pending).resolves.toBe('failed');
    expect(store.getState().attractions.map((a) => a.slug)).toEqual([SKOGAFOSS, GLYMUR]);
  });

  it('remove sends nothing for a place that is not saved', async () => {
    const { store, calls } = setup();
    await store.getState().load();
    await expect(store.getState().removeAttraction(GLYMUR)).resolves.toBe('removed');
    expect(calls).toEqual([]);
  });

  it('a save reads the list again, so the row (name, picture) reaches Favourites', async () => {
    const { store, fetch } = setup();
    await store.getState().load();
    await store.getState().toggleAttraction(SKOGAFOSS);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.getState().attractions.map((a) => a.slug)).toEqual([SKOGAFOSS]);
    expect(store.getState().attractionOverrides).toEqual({});
  });

  it('a read while the write is in flight keeps the tap', async () => {
    const remove = deferred();
    const { store } = setup({ removeAttraction: () => remove.promise }, [SKOGAFOSS]);
    await store.getState().load();
    const pending = store.getState().toggleAttraction(SKOGAFOSS);
    await store.getState().load({ force: true }); // the server still lists it
    expect(store.getState().isAttractionSaved(SKOGAFOSS)).toBe(false);
    remove.resolve();
    await pending;
    expect(store.getState().isAttractionSaved(SKOGAFOSS)).toBe(false);
  });
});

describe('(b) a heart pressed before the list arrived', () => {
  it('reads the list again after an accepted save, and the server decides', async () => {
    const { store, fetch } = setup({}, [GLYMUR]);
    // No read yet: the heart was a guess.
    await expect(store.getState().toggleAttraction(SKOGAFOSS)).resolves.toBe('added');
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect([...store.getState().savedSlugs].sort()).toEqual([GLYMUR, SKOGAFOSS].sort());
  });

  it('reads the list again after an accepted remove, too (a remove reads nothing once the list is there)', async () => {
    const { store, fetch } = setup({}, [SKOGAFOSS]);
    // Looked unsaved, so the press saved it: the list says what is true.
    await store.getState().toggleAttraction(GLYMUR);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.getState().isAttractionSaved(SKOGAFOSS)).toBe(true);
    // Once the list is there, a remove needs no read.
    await store.getState().toggleAttraction(SKOGAFOSS);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reads the list again after a refused write, and shows what the server has', async () => {
    const { store, fetch, alerts } = setup({ addAttraction: async () => Promise.reject(refused(500)) }, [SKOGAFOSS]);
    // The member saw an empty heart (no list yet) and pressed it; the server
    // refused, but the place WAS saved: the read after the write says so.
    await expect(store.getState().toggleAttraction(SKOGAFOSS)).resolves.toBe('failed');
    expect(alerts).toEqual(['Could not save favourite. Please try again.']);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.getState().isAttractionSaved(SKOGAFOSS)).toBe(true);
  });

  it('a refused write after the list arrived reads nothing more', async () => {
    const { store, fetch } = setup({ addAttraction: async () => Promise.reject(refused(500)) });
    await store.getState().load();
    await store.getState().toggleAttraction(SKOGAFOSS);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('(a) sign-out', () => {
  it('forgets the saved set, and drops a write and a read still on their way', async () => {
    const read = deferred<FavouritesPayload>();
    const save = deferred();
    const { store, alerts } = setup({ fetch: () => read.promise, addAttraction: () => save.promise });
    const loading = store.getState().load();
    const toggling = store.getState().toggleAttraction(GLYMUR);
    store.getState().reset();
    expect(store.getState().savedSlugs).toEqual([]);
    expect(store.getState().attractions).toEqual([]);
    read.resolve(payload(SKOGAFOSS));
    save.reject(refused(500));
    await loading;
    await toggling;
    // Nothing of the member who left comes back, and nothing is said to the next one.
    expect(store.getState().savedSlugs).toEqual([]);
    expect(store.getState().attractionInFlight).toEqual({});
    expect(alerts).toEqual([]);
  });

  it('the next member starts from their own list', async () => {
    const { store, setServer } = setup({}, [SKOGAFOSS]);
    await store.getState().load();
    expect(store.getState().isAttractionSaved(SKOGAFOSS)).toBe(true);
    store.getState().reset();
    setServer([GLYMUR]);
    await store.getState().load();
    expect(store.getState().savedSlugs).toEqual([GLYMUR]);
  });
});
