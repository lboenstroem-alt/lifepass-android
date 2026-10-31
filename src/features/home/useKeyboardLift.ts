// Keeps Home's ask field (the Coach input in "Want to try something new?")
// clear of the keyboard.
//
// WHY HOME DOES THIS ITSELF. The app runs edge to edge (app.json
// `edgeToEdgeEnabled`), so Android no longer shrinks the window for the
// keyboard: the keyboard is drawn over the page, and a ScrollView whose own
// bounds still reach under it never scrolls a field into view by itself (the
// Coach screen lifts its input bar by hand for the same reason). The field
// sits some 800 dp down the page, so on most phones a tap on it would put the
// keyboard right over it. On iOS the page's ScrollView keeps the focused field
// above the keyboard.
//
// HOW. While the field has the keyboard, Home adds the keyboard's height as
// room under the page (iOS insets its scroll view by the keyboard the same
// way), so even a field near the end of the page can rise. When that room has
// been laid out (the page's content size changes), Home measures the field's
// row on screen and, if it ends lower than `KEYBOARD_MARGIN` above the
// keyboard's top, scrolls the page up by the difference. The same check runs
// whenever the page's content changes size while the keyboard is up (the
// field growing to its third line, a shelf landing), so it never slips under.
// Waiting for the new content size matters: a scroll sent in the same frame
// as the room would be clamped to the old page length.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Dimensions, Keyboard, type KeyboardEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from 'react-native';

/** How much of the page stays visible between the field and the keyboard, in dp. */
export const KEYBOARD_MARGIN = 16;

/** How far to scroll the page so a field ending at `fieldBottom` sits `margin` above the keyboard; 0 when it already does. */
export function keyboardLift(fieldBottom: number, keyboardTop: number, margin: number = KEYBOARD_MARGIN): number {
  const overlap = fieldBottom + margin - keyboardTop;
  return overlap > 0 ? Math.ceil(overlap) : 0;
}

/**
 * The keyboard's top edge on screen, in dp from the top. Android reports it
 * two ways that disagree between versions and soft-input modes (the visible
 * frame's bottom, and the keyboard's height above the navigation bar), so the
 * higher of the two is taken: erring that way scrolls a few dp more, never
 * leaves the field under the keys.
 */
export function keyboardTopOf(event: Pick<KeyboardEvent, 'endCoordinates'>, screenHeight: number, bottomInset: number): number {
  const { screenY, height } = event.endCoordinates;
  return Math.min(screenY, screenHeight - height - bottomInset);
}

/** What the lift needs of the field. */
export interface KeyboardLiftField {
  isInputFocused(): boolean;
  /** The field row's top and height on screen, in dp. */
  measureInputRow(callback: (y: number, height: number) => void): void;
}

export interface KeyboardLift {
  /** Room to add under the page while the field has the keyboard (its height), else 0. */
  readonly keyboardRoom: number;
  /** For the page's `onScroll` (with a `scrollEventThrottle`): where it is scrolled to. */
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** For the page's `onContentSizeChange`: lifts the field once the room is laid out. */
  readonly onContentSizeChange: () => void;
}

export function useKeyboardLift(
  page: RefObject<ScrollView | null>,
  field: RefObject<KeyboardLiftField | null>,
  bottomInset: number,
): KeyboardLift {
  const offset = useRef(0);
  const inset = useRef(bottomInset);
  inset.current = bottomInset;
  const [keyboard, setKeyboard] = useState<{ readonly top: number; readonly height: number } | null>(null);
  const shown = useRef(keyboard);
  shown.current = keyboard;

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      // Only the ask field's keyboard: another screen's field is not Home's business.
      if (!field.current?.isInputFocused()) return;
      const top = keyboardTopOf(event, Dimensions.get('screen').height, inset.current);
      setKeyboard({ top, height: event.endCoordinates.height });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(null));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [field]);

  const onContentSizeChange = useCallback(() => {
    const up = shown.current;
    const input = field.current;
    if (!up || !input?.isInputFocused()) return;
    input.measureInputRow((y, height) => {
      const by = keyboardLift(y + height, up.top);
      if (by > 0) page.current?.scrollTo({ y: offset.current + by, animated: true });
    });
  }, [field, page]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
  }, []);

  return { keyboardRoom: keyboard?.height ?? 0, onScroll, onContentSizeChange };
}
