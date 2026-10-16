// Reduce Motion: Android's "Remove animations" setting, as iOS reads
// `accessibilityReduceMotion`.
//
// What it stops, as on iOS: the skeleton pulse, the one-time Map/List
// emphasis (a still ring instead of two pulses), the map's slide to clear a
// low pin, the scanner animation and the runner's ring animation. Bottom
// sheets follow the setting by themselves (Reanimated's ReduceMotion.System).
//
// The setting is read once at start-up and cached at module level, so a
// screen mounted later starts with the right answer instead of animating for
// one frame and then stopping. A change in Settings reaches every mounted
// hook through the `reduceMotionChanged` event.
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

let lastKnown = false;

function remember(value: unknown): boolean {
  lastKnown = value === true;
  return lastKnown;
}

/** Reads the system setting now; never rejects. */
export async function readReduceMotion(): Promise<boolean> {
  try {
    return remember(await AccessibilityInfo.isReduceMotionEnabled());
  } catch {
    return lastKnown;
  }
}

/** The last value read, for code outside React (an animation config). */
export function reduceMotionNow(): boolean {
  return lastKnown;
}

// Prime the cache as early as the module loads.
void readReduceMotion();

/** True while the member has asked for less motion. */
export function useReduceMotion(): boolean {
  const [enabled, setEnabled] = useState(lastKnown);

  useEffect(() => {
    let alive = true;
    void readReduceMotion().then((value) => {
      if (alive) setEnabled(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      const next = remember(value);
      if (alive) setEnabled(next);
    });
    return () => {
      alive = false;
      subscription?.remove();
    };
  }, []);

  return enabled;
}
