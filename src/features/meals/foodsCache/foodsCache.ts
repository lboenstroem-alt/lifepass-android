/**
 * Common foods, preset meals and the member's own foods, drawn at once from
 * `health/<profileId>/foods.json` and refreshed in the background: the
 * Android port of iOS `MealFoodsCache` (Services/MealOutbox.swift, R3).
 *
 * Search opens on a full page instead of a spinner: `openFoodsCache` puts
 * what was stored on screen, then asks the server for both lists again.
 *
 *   const presets = useMealFoodsCache((s) => s.presets);
 *   await openFoodsCache({ profileId, language });
 *
 * RULES
 * - Per member and per language. The file is `{ language, presets, mine }`;
 *   a stored copy in another language is not shown (its names are in the
 *   old language), and the next refresh writes over it.
 * - It goes with the member's health data: the local wipe deletes the
 *   profile folder, and ../register.ts resets the memory here. A read or a
 *   refresh still in flight for the member who left lands nowhere (the
 *   `epoch` check, which iOS does not have: its refresh assigns before it
 *   compares the profile).
 * - A failed refresh keeps what is shown; `presetsFailed`/`mineFailed` are
 *   true only when there is nothing to show at all.
 */
import { create } from 'zustand';

import { object, req, soft, string } from '../../../health/decode';
import * as localStore from '../../../health/localStore';
import { mealApi } from '../api/mealApi';
import { decodeFoodPresets, decodeMyFoods } from '../types/decode';
import { myFoodsRemoving, type FoodPresets, type MyFoods } from '../types/models';

export interface MealFoodsCacheState {
  /** OP-39: common foods and preset meals (null until something is known). */
  readonly presets: FoodPresets | null;
  /** OP-40: the member's recents, frequent, created foods and recent meals. */
  readonly mine: MyFoods | null;
  /** The last presets read failed and there is nothing to show. */
  readonly presetsFailed: boolean;
  /** The last my-foods read failed and there is nothing to show. */
  readonly mineFailed: boolean;
  readonly isRefreshing: boolean;
}

function initialState(): MealFoodsCacheState {
  return { presets: null, mine: null, presetsFailed: false, mineFailed: false, isRefreshing: false };
}

/** The lists, for screens: `useMealFoodsCache((s) => s.mine)`. */
export const useMealFoodsCache = create<MealFoodsCacheState>()(() => initialState());

/** Whose lists these are, and in which language. */
let profileId: string | null = null;
let language: string | null = null;
/** Bumped by every wipe: an answer for the member who left is dropped. */
let epoch = 0;

function setState(patch: Partial<MealFoodsCacheState>): void {
  useMealFoodsCache.setState(patch);
}

/** Still the same member, language and session as when the work started. */
function isCurrent(at: number, id: string, lang: string): boolean {
  return at === epoch && profileId === id && language === lang;
}

// ---------------------------------------------------------------------------
// The file

interface StoredFoods {
  readonly language: string;
  readonly presets: FoodPresets | null;
  readonly mine: MyFoods | null;
}

/** `foods.json`. A list that no longer reads costs only itself. */
function decodeStoredFoods(json: unknown): StoredFoods {
  const root = object(json, 'foods');
  return {
    language: req(root, 'language', 'foods', string),
    presets: soft(root, 'presets', 'foods', decodeFoodPresets),
    mine: soft(root, 'mine', 'foods', decodeMyFoods),
  };
}

function persist(): void {
  if (!profileId || !language) return;
  const { presets, mine } = useMealFoodsCache.getState();
  // The models carry the wire's own field names, so the file is what the
  // server sent and reads back through the same decoders.
  const stored: StoredFoods = { language, presets, mine };
  void localStore.write(stored, 'foods', profileId);
}

// ---------------------------------------------------------------------------
// Opening and refreshing

/**
 * Draw what is stored for this member in this language, then refresh both
 * lists. Search calls it every time it appears.
 */
export async function openFoodsCache(options: { readonly profileId: string; readonly language: string }): Promise<void> {
  const id = options.profileId.toLowerCase();
  const lang = options.language;
  if (profileId !== id || language !== lang) {
    profileId = id;
    language = lang;
    setState({ presets: null, mine: null, presetsFailed: false, mineFailed: false });
    const at = epoch;
    const stored = await localStore.read('foods', id, decodeStoredFoods);
    if (stored && stored.language === lang && isCurrent(at, id, lang)) {
      // A refresh that already answered (another open, racing this one) is newer than the file.
      const state = useMealFoodsCache.getState();
      setState({ presets: state.presets ?? stored.presets, mine: state.mine ?? stored.mine });
    }
  }
  await refreshFoodsCache();
}

/** Ask the server for both lists again (pull to refresh, and every open). */
export async function refreshFoodsCache(): Promise<void> {
  const id = profileId;
  const lang = language;
  if (!id || !lang) return;
  const at = epoch;
  setState({ isRefreshing: true });
  try {
    try {
      const presets = await mealApi().presets(lang);
      if (!isCurrent(at, id, lang)) return;
      setState({ presets, presetsFailed: false });
    } catch {
      if (!isCurrent(at, id, lang)) return;
      setState({ presetsFailed: useMealFoodsCache.getState().presets === null });
    }
    try {
      const mine = await mealApi().myFoods(lang);
      if (!isCurrent(at, id, lang)) return;
      setState({ mine, mineFailed: false });
    } catch {
      if (!isCurrent(at, id, lang)) return;
      setState({ mineFailed: useMealFoodsCache.getState().mine === null });
    }
    persist();
  } finally {
    if (at === epoch) setState({ isRefreshing: false });
  }
}

/**
 * After a save, an edit or a removal: the member's own lists changed. In the
 * background; a failure keeps what is shown.
 */
export function refreshMineFoods(): void {
  const id = profileId;
  const lang = language;
  if (!id || !lang) return;
  const at = epoch;
  mealApi()
    .myFoods(lang)
    .then(
      (fresh) => {
        if (!isCurrent(at, id, lang)) return;
        setState({ mine: fresh, mineFailed: false });
        persist();
      },
      () => undefined,
    );
}

/** A My foods removal, applied at once (the server call runs after). */
export function removeMineLocally(key: string): void {
  const { mine } = useMealFoodsCache.getState();
  if (!mine) return;
  setState({ mine: myFoodsRemoving(mine, key) });
  persist();
}

/** Put the lists back when a removal did not reach the server. */
export function restoreMine(previous: MyFoods): void {
  setState({ mine: previous });
  persist();
}

// ---------------------------------------------------------------------------
// The wipe

/**
 * Forget the lists in memory (the local wipe: the file goes with the health
 * folder). A read or a refresh still in flight lands nowhere.
 */
export function resetFoodsCacheMemory(): void {
  epoch += 1;
  profileId = null;
  language = null;
  useMealFoodsCache.setState(initialState(), true);
}

/** The member whose lists are open, if any (the sign-out cleaner's fallback). */
export function foodsCacheProfileId(): string | null {
  return profileId;
}
