// The Map/List switch's one-time emphasis (iOS 2.5.4, `MapToggleHint` and
// SearchMapView `runMapToggleHint`).
//
// Explore opens on the map, and the list behind the small switch was easy to
// miss. Once, after the screen has settled (0.6 s), the switch shows its word
// ("List" on the map, "Map" on the list) and an accent ring that pulses
// twice, about four seconds in all, then never again. With Remove animations
// on, the ring stands still for the same four seconds.
//
// It never competes with anything else: it waits while the post-sign-up
// Kenni prompt is pending, while a sheet or a pushed page covers Explore,
// while Classes is showing and while the app is in the background, and it
// starts again once they are gone. It counts as shown only after a full run
// on screen, or a tap on the switch; a run that is interrupted hides and does
// not count.
//
// Remembered on the phone, not per member (iOS @AppStorage), and kept at
// sign-out: it is about the app, not the account.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

/** The iOS @AppStorage key. */
export const MAP_TOGGLE_HINT_KEY = 'explore.mapToggleHinted';

/** The emphasis's timeline (iOS `runMapToggleHint`), in milliseconds. */
export const MAP_TOGGLE_HINT_TIMING = {
  /** On screen this long before it starts. */
  settleMs: 600,
  /** One pulse: the ring grows to 1.3 and fades. */
  pulseMs: 900,
  /** A pulse starts this often. */
  pulseEveryMs: 1_000,
  pulses: 2,
  /** After the last pulse's second, the word stays this long. */
  tailMs: 2_000,
  /** Remove animations: a still ring, this long. */
  stillMs: 4_000,
} as const;

export interface MapToggleHintConditions {
  /** It has run its course, or the switch was tapped. */
  readonly alreadyShown: boolean;
  /** Venues (map or list) are showing, not Classes. */
  readonly venuesOnScreen: boolean;
  /** The post-sign-up Kenni prompt is waiting or showing. */
  readonly kennitalaPromptPending: boolean;
  /** A sheet, a sight's card or a pushed page covers Explore. */
  readonly sheetOrPushOpen: boolean;
  /** The app is in the foreground. */
  readonly appActive: boolean;
}

/** Whether the emphasis may run now (iOS `MapToggleHint.mayRun`). */
export function mayRunMapToggleHint(c: MapToggleHintConditions): boolean {
  return !c.alreadyShown && c.venuesOnScreen && !c.kennitalaPromptPending && !c.sheetOrPushOpen && c.appActive;
}

/** Whether the emphasis has been shown on this phone. A read that fails counts as shown: never nag. */
export async function readMapToggleHinted(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(MAP_TOGGLE_HINT_KEY)) === 'true';
  } catch {
    return true;
  }
}

async function writeMapToggleHinted(): Promise<void> {
  try {
    await AsyncStorage.setItem(MAP_TOGGLE_HINT_KEY, 'true');
  } catch {
    // It may run once more at the next launch; nothing worse.
  }
}

export interface MapToggleHint {
  /** The switch carries its word and the accent ring. */
  readonly active: boolean;
  /** 0 to 1 through each pulse: the ring's scale (1 to 1.3) and fade. Stays 0 with Remove animations. */
  readonly pulse: Animated.Value;
  /** The switch was tapped: counts as shown, and hides at once. */
  readonly onToggleTapped: () => void;
}

/**
 * Runs the emphasis whenever `mayRunMapToggleHint` allows (the rest of the
 * conditions come from the screen; whether it was shown is read here).
 * Restarted whenever the answer changes, as iOS's `.task(id:)` is: a sheet
 * that closes re-arms it, one that opens interrupts it.
 */
export function useMapToggleHint(
  conditions: Omit<MapToggleHintConditions, 'alreadyShown'>,
  reduceMotion: boolean,
): MapToggleHint {
  // Unknown until read: treated as shown, so it never starts early.
  const [hinted, setHinted] = useState<boolean | null>(null);
  const [active, setActive] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;
  // Read at the moment a run starts; a change in the setting mid-run does
  // not restart it (iOS reads the environment value inside the task).
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  useEffect(() => {
    let alive = true;
    void readMapToggleHinted().then((value) => {
      if (alive) setHinted((current) => (current === true ? true : value));
    });
    return () => {
      alive = false;
    };
  }, []);

  const markShown = useCallback(() => {
    setHinted(true);
    void writeMapToggleHinted();
  }, []);

  const mayRun = mayRunMapToggleHint({ ...conditions, alreadyShown: hinted !== false });

  useEffect(() => {
    if (!mayRun) {
      setActive(false);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, run: () => void) => timers.push(setTimeout(run, ms));
    const { settleMs, pulseMs, pulseEveryMs, pulses, tailMs, stillMs } = MAP_TOGGLE_HINT_TIMING;
    let animation: Animated.CompositeAnimation | null = null;

    after(settleMs, () => {
      setActive(true);
      const still = reduceMotionRef.current;
      if (!still) {
        for (let index = 0; index < pulses; index += 1) {
          after(index * pulseEveryMs, () => {
            pulse.setValue(0);
            animation = Animated.timing(pulse, {
              toValue: 1,
              duration: pulseMs,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            });
            animation.start();
          });
        }
      }
      after(still ? stillMs : pulses * pulseEveryMs + tailMs, () => {
        markShown();
        setActive(false);
      });
    });

    return () => {
      // Interrupted (a sheet, a push, the app left, Classes): hidden, not counted.
      for (const timer of timers) clearTimeout(timer);
      animation?.stop();
      pulse.setValue(0);
      setActive(false);
    };
  }, [mayRun, markShown, pulse]);

  const onToggleTapped = useCallback(() => {
    if (active || hinted !== true) markShown();
    setActive(false);
  }, [active, hinted, markShown]);

  return { active, pulse, onToggleTapped };
}
