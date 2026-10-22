/**
 * How much of the screen the soft keyboard covers while it is up, measured
 * from the bottom edge of the screen (so it includes the navigation bar
 * under the keyboard), else 0.
 *
 * The app runs edge to edge, so Android never shrinks the window for the
 * keyboard: the meal page lifts its tray bar (and Search's list ends above
 * it) by this much itself, as SwiftUI keeps a `safeAreaInset` bar above the
 * keyboard.
 *
 * WHY NOT `endCoordinates.height` ALONE. On Android 11 and later React Native
 * reports the keyboard's height ABOVE the navigation bar (the IME inset minus
 * the system bars' inset, ReactRootView.checkForKeyboardEvents), so padding
 * by it alone leaves the bottom of the tray bar, "Save to diary" included,
 * under the keys by the navigation bar's height. The keyboard's top edge in
 * screen coordinates (`screenY`) gives the whole covered strip; older
 * Android versions report a height that already includes the bar. The larger
 * of the two is taken, as the Coach screen does: erring that way lifts the
 * bar a few dp more, never leaves it under the keys.
 */
import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, type KeyboardEvent } from 'react-native';

/** What a keyboard event says of where the keyboard ended up. */
type KeyboardFrame = Partial<KeyboardEvent['endCoordinates']>;

/** The strip the keyboard covers, from the bottom of a screen `screenHeight` tall. */
export function keyboardCoverage(metrics: KeyboardFrame | undefined, screenHeight: number): number {
  const height = metrics?.height ?? 0;
  const screenY = metrics?.screenY;
  if (typeof screenY !== 'number' || screenY <= 0) return height;
  return Math.max(height, screenHeight - screenY);
}

export function useKeyboardCoverage(): number {
  const [coverage, setCoverage] = useState(0);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) =>
      setCoverage(keyboardCoverage(event.endCoordinates, Dimensions.get('screen').height)),
    );
    const hidden = Keyboard.addListener('keyboardDidHide', () => setCoverage(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return coverage;
}
