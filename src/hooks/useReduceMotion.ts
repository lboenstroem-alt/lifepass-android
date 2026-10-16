// Reduce Motion: Android's "Remove animations" setting, as iOS reads
// `accessibilityReduceMotion`.
//
// What it stops, as on iOS: the skeleton pulse, the one-time Map/List
// emphasis (a still ring instead of two pulses), the map's slide to clear a
// low pin, the scanner animation and the runner's ring animation. Bottom
// sheets follow the setting by themselves (Reanimated's ReduceMotion.System).
//
// ONE SHARED VALUE, as iOS's environment value is. The setting is read once
// at start-up and cached at module level, so a screen mounted later starts
// with the right answer instead of animating for one frame and then
// stopping. Every hook reads that one value through useSyncExternalStore:
// a list of venue images or a loading card of skeleton blocks shares a
// single `reduceMotionChanged` subscription (taken while any hook is
// mounted) instead of one native read and listener per block.
//
// A read that was already in flight when a change event arrived never
// overwrites the newer value from the event.
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

let lastKnown = false;
/** Bumped by every change event, so a slower read cannot undo it. */
let changes = 0;

const listeners = new Set<() => void>();
let subscription: { remove(): void } | undefined;

function publish(value: boolean): void {
  if (value === lastKnown) return;
  lastKnown = value;
  for (const listener of [...listeners]) listener();
}

/** Reads the system setting now; never rejects. */
export async function readReduceMotion(): Promise<boolean> {
  const before = changes;
  try {
    const value = (await AccessibilityInfo.isReduceMotionEnabled()) === true;
    if (changes === before) publish(value);
  } catch {
    // Unreadable: keep the last known value.
  }
  return lastKnown;
}

/** The last value read, for code outside React (an animation config). */
export function reduceMotionNow(): boolean {
  return lastKnown;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!subscription) {
    subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value: boolean) => {
      changes += 1;
      publish(value === true);
    });
    // The setting may have changed while nothing listened.
    void readReduceMotion();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && subscription) {
      subscription.remove();
      subscription = undefined;
    }
  };
}

// Prime the cache as early as the module loads.
void readReduceMotion();

/** True while the member has asked for less motion. */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, reduceMotionNow, reduceMotionNow);
}
