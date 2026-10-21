/**
 * The soft keyboard's height while it is up, else 0.
 *
 * The app runs edge to edge, so Android never shrinks the window for the
 * keyboard: the meal page lifts its tray bar (and Search's list ends above
 * it) by this much itself, as SwiftUI keeps a `safeAreaInset` bar above the
 * keyboard. Android sends only the "did" events; the height is measured from
 * the bottom of the screen, so it includes the navigation bar.
 */
import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => setHeight(event.endCoordinates.height));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return height;
}
