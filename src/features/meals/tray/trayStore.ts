/**
 * Items picked on the capture page and not saved yet, kept in
 * `health/<profileId>/tray.json` so a phone call in the middle of lunch does
 * not cost the list: the Android port of iOS `MealTraySnapshot` and
 * `MealTrayStore` (Services/MealOutbox.swift, R8).
 *
 * The capture page (MEAL-2) saves the tray on every change, clears it on a
 * save or a discard, and offers it back when it opens within a day:
 *
 *   await saveTray({ items, slot, date, source, savedAt: new Date() }, profileId);
 *   const snapshot = await restoreTray(profileId); // null: start empty
 *
 * The file is per member, never backed up, and goes with the member's health
 * data (the local wipe deletes the profile folder). There is nothing of it in
 * memory here.
 *
 * Writes and reads run on the health store's one serial queue
 * (src/health/localStore.ts), so a restore always sees the save before it.
 */
import { arrayOf, instant, object, opt, req, string } from '../../../health/decode';
import * as localStore from '../../../health/localStore';
import { decodeMealItemDraft, type MealItemDraft } from '../types/draft';

/** What the capture page had picked, and for which meal. */
export interface MealTraySnapshot {
  readonly items: readonly MealItemDraft[];
  /** The slot the page was on (`breakfast`, `lunch`, ...). */
  readonly slot: string;
  /** The server day the meal is for (`YYYY-MM-DD`). */
  readonly date: string;
  /** Where the first item came from (a `MealEntrySource`), when known. */
  readonly source: string | null;
  readonly savedAt: Date;
}

/** A tray older than a day is not offered back: it is deleted. */
export const MEAL_TRAY_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function isTrayFresh(snapshot: Pick<MealTraySnapshot, 'savedAt'>, now: Date = new Date()): boolean {
  return now.getTime() - snapshot.savedAt.getTime() < MEAL_TRAY_LIFETIME_MS;
}

/**
 * `tray.json`. One item that no longer reads (a draft written by an older
 * build) is dropped rather than costing the member the whole tray; iOS's
 * synthesized decoder would lose every item for it.
 */
export function decodeTraySnapshot(json: unknown): MealTraySnapshot {
  const root = object(json, 'tray');
  const raw = req(root, 'items', 'tray', arrayOf((value) => value));
  const items: MealItemDraft[] = [];
  raw.forEach((value, index) => {
    try {
      items.push(decodeMealItemDraft(value, `tray.items[${index}]`));
    } catch {
      // Dropped; the tray stands.
    }
  });
  return {
    items,
    slot: req(root, 'slot', 'tray', string),
    date: req(root, 'date', 'tray', string),
    source: opt(root, 'source', 'tray', string),
    savedAt: req(root, 'savedAt', 'tray', instant),
  };
}

/** Queues a write of the tray. Resolves to whether it was written. */
export function saveTray(snapshot: MealTraySnapshot, profileId: string): Promise<boolean> {
  // A draft carries the wire's field names and explicit nulls; `savedAt` is
  // written as an ISO instant (src/api/wire.ts `encodeBody`).
  return localStore.write(snapshot, 'tray', profileId);
}

/** Queues the removal of the tray (a save, a discard, or one too old to offer). */
export function clearTray(profileId: string): Promise<void> {
  return localStore.remove('tray', profileId);
}

/** The tray when it is younger than a day and holds something; anything else is deleted. */
export async function restoreTray(profileId: string, now: Date = new Date()): Promise<MealTraySnapshot | null> {
  const snapshot = await localStore.read('tray', profileId, decodeTraySnapshot);
  if (!snapshot) return null;
  if (!isTrayFresh(snapshot, now) || snapshot.items.length === 0) {
    void clearTray(profileId);
    return null;
  }
  return snapshot;
}
