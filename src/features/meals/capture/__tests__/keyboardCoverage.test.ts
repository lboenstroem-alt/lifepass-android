/**
 * How far the meal page lifts its tray bar for the keyboard: the whole strip
 * the keyboard covers, navigation bar included, however Android reports it.
 */
import { keyboardCoverage } from '../useKeyboardHeight';

const SCREEN = 800;
const NAV_BAR = 48;
const KEYS = 300;

it('Android 11 and later: the height leaves the navigation bar out, the top edge does not', () => {
  // React Native reports the IME inset minus the system bars' inset.
  expect(keyboardCoverage({ height: KEYS, screenY: SCREEN - KEYS - NAV_BAR }, SCREEN)).toBe(KEYS + NAV_BAR);
});

it('older Android: a height that already includes the bar is taken as it is', () => {
  expect(keyboardCoverage({ height: KEYS + NAV_BAR, screenY: SCREEN - KEYS - NAV_BAR }, SCREEN)).toBe(KEYS + NAV_BAR);
});

it('without a top edge, the height', () => {
  expect(keyboardCoverage({ height: KEYS }, SCREEN)).toBe(KEYS);
  expect(keyboardCoverage({ height: KEYS, screenY: 0 }, SCREEN)).toBe(KEYS);
  expect(keyboardCoverage(undefined, SCREEN)).toBe(0);
});
