// Test helpers for the accessibility hooks. Imported by tests only.
//
// FONT SCALE. React Native's own Jest setup reports a window font scale of 2,
// so without help every component test sees `useA11ySize()` at
// accessibility3 and only ever exercises the accessibility layouts (stacked
// rows, full-height sheets). Pin the scale per test file:
//
//   beforeEach(() => setTestFontScale(1));     // the default layout
//   afterEach(() => restoreTestFontScale());
//
// and opt into the large-text layout where a test is about it
// (`setTestFontScale(2)`). Call it before rendering, or inside `act` when a
// rendered tree should follow the change, as it would when the member changes
// the setting.
import { Dimensions } from 'react-native';

type Metrics = ReturnType<typeof Dimensions.get>;

let original: { window: Metrics; screen: Metrics } | null = null;

/** Sets the font scale `useWindowDimensions` (and so `useA11ySize`) reports. */
export function setTestFontScale(fontScale: number): void {
  const window = Dimensions.get('window');
  const screen = Dimensions.get('screen');
  if (!original) original = { window, screen };
  Dimensions.set({ window: { ...window, fontScale }, screen: { ...screen, fontScale } });
}

/** Puts back the font scale the test runner started with. */
export function restoreTestFontScale(): void {
  if (!original) return;
  Dimensions.set(original);
  original = null;
}
