/**
 * The camera modes' first-use cards, once per phone: iOS UserDefaults
 * `meal.photo.tipSeen` (Photo's "One plate, from above, in good light...")
 * and `meal.barcode.tipSeen` (Barcode's Open Food Facts privacy note).
 *
 * Read from AsyncStorage when a mode mounts; until the answer is in, the
 * card is not drawn (null), so it never flashes up for a member who has
 * already said OK. Not per member and not health data (iOS keeps them in
 * UserDefaults across sign-outs too).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

export const PHOTO_TIP_KEY = 'meal.photo.tipSeen';
export const BARCODE_TIP_KEY = 'meal.barcode.tipSeen';

/** Read once per process: the answer does not change behind the app's back. */
const known = new Map<string, boolean>();

export async function readTipSeen(key: string): Promise<boolean> {
  const cached = known.get(key);
  if (cached !== undefined) return cached;
  let seen = false;
  try {
    seen = (await AsyncStorage.getItem(key)) === 'true';
  } catch {
    // Unreadable: show the card again rather than never.
  }
  known.set(key, known.get(key) ?? seen);
  return known.get(key) ?? seen;
}

export function markTipSeen(key: string): void {
  known.set(key, true);
  AsyncStorage.setItem(key, 'true').catch(() => undefined);
}

/** `[seen, markSeen]`: `seen` is null until the flag has been read. */
export function useTipSeen(key: string): readonly [boolean | null, () => void] {
  const [seen, setSeen] = useState<boolean | null>(() => known.get(key) ?? null);
  useEffect(() => {
    let alive = true;
    void readTipSeen(key).then((value) => {
      if (alive) setSeen(value);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  const markSeen = useCallback(() => {
    markTipSeen(key);
    setSeen(true);
  }, [key]);
  return [seen, markSeen] as const;
}

/** Tests: forget what was read. */
export function resetTipSeenForTests(): void {
  known.clear();
}
