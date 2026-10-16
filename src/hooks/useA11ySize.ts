// Large text: Android's font scale read in iOS Dynamic Type terms.
//
// iOS lays a few screens out differently at the accessibility text sizes
// (`dynamicTypeSize.isAccessibilitySize`): the class and own-visit sheets open
// at full height, Plan's Today card and the runner stack their actions, the
// staff proof gets denser. It also pins some text to a ceiling with
// `.dynamicTypeSize(...large)`, `...xxLarge` or `...accessibility1`. Android
// has one number, `fontScale` (0.85 to 2.0 on Android 14 and later), so this
// module translates it.
//
// THE MAPPING. iOS sizes are named by the body text's point size: large (the
// default) is 17 pt, xxxLarge 23, accessibility1 28, and so on. A font scale
// reads as the smallest iOS size whose body text is at least as big as 17 pt
// times the scale. Android's steps then land like this:
//   0.85 → small, 1.0 → large, 1.15 → xxLarge, 1.3 → xxxLarge,
//   1.5 → accessibility1, 1.8 → accessibility2, 2.0 → accessibility3
// so 1.5, the first Android step past iOS's largest ordinary size, is where
// the accessibility layouts begin.
import { useWindowDimensions } from 'react-native';

/** iOS DynamicTypeSize, smallest to largest. */
export const TYPE_SIZES = [
  'xSmall',
  'small',
  'medium',
  'large',
  'xLarge',
  'xxLarge',
  'xxxLarge',
  'accessibility1',
  'accessibility2',
  'accessibility3',
  'accessibility4',
  'accessibility5',
] as const;

export type TypeSize = (typeof TYPE_SIZES)[number];

/** Body text point size at each iOS size (Apple's Dynamic Type table). */
export const BODY_POINTS: Record<TypeSize, number> = {
  xSmall: 14,
  small: 15,
  medium: 16,
  large: 17,
  xLarge: 19,
  xxLarge: 21,
  xxxLarge: 23,
  accessibility1: 28,
  accessibility2: 33,
  accessibility3: 40,
  accessibility4: 47,
  accessibility5: 53,
};

const DEFAULT_BODY = BODY_POINTS.large;

/**
 * `maxFontSizeMultiplier` values that stop text growing at an iOS size, the
 * port of `.dynamicTypeSize(...DynamicTypeSize.large)` and friends:
 *
 *   <Text maxFontSizeMultiplier={FONT_SCALE_CAP.accessibility1}>
 */
export const FONT_SCALE_CAP = {
  large: 1,
  xxLarge: BODY_POINTS.xxLarge / DEFAULT_BODY,
  accessibility1: BODY_POINTS.accessibility1 / DEFAULT_BODY,
} as const;

/** Floating-point slack, so a scale of exactly 1.0 or 1.15 lands on its step. */
const EPSILON = 0.001;

/** The iOS size a font scale reads as (see THE MAPPING above). */
export function typeSizeFor(fontScale: number): TypeSize {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const body = DEFAULT_BODY * scale;
  for (const size of TYPE_SIZES) {
    if (BODY_POINTS[size] + EPSILON >= body) return size;
  }
  return 'accessibility5';
}

/** iOS `DynamicTypeSize.isAccessibilitySize`. */
export function isAccessibilityTypeSize(size: TypeSize): boolean {
  return TYPE_SIZES.indexOf(size) >= TYPE_SIZES.indexOf('accessibility1');
}

/** Whether `size` is at least `other` (iOS compares DynamicTypeSize with >=). */
export function typeSizeAtLeast(size: TypeSize, other: TypeSize): boolean {
  return TYPE_SIZES.indexOf(size) >= TYPE_SIZES.indexOf(other);
}

export type A11ySize = {
  /** The raw Android font scale. */
  fontScale: number;
  /** The iOS size it reads as. */
  typeSize: TypeSize;
  /** iOS `isAccessibilitySize`: switch to the stacked or full-height layout. */
  isAccessibilitySize: boolean;
  /** Text is larger than the default (iOS above `.large`). */
  isLargerThanDefault: boolean;
};

/** Pure form of the hook, for code that has a font scale in hand. */
export function a11ySizeFor(fontScale: number): A11ySize {
  const typeSize = typeSizeFor(fontScale);
  return {
    fontScale,
    typeSize,
    isAccessibilitySize: isAccessibilityTypeSize(typeSize),
    isLargerThanDefault: typeSizeAtLeast(typeSize, 'xLarge'),
  };
}

/**
 * The member's text size, re-read when they change it in Settings (the
 * window dimensions update and the component re-renders).
 */
export function useA11ySize(): A11ySize {
  const { fontScale } = useWindowDimensions();
  return a11ySizeFor(fontScale);
}
