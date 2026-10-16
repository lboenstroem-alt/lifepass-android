// Shape and spacing constants shared by the UI kit, from the iOS views.

/** iOS draws its rules at 0.5 pt; the same 0.5 dp here (a solid `line`). */
export const hairline = 0.5;

/** Corner radii the iOS views use. */
export const radius = {
  /** Checkbox rows, small outlines. */
  small: 8,
  /** Rows, inputs and option buttons (RoundedRectangle 12). */
  field: 12,
  /** Cards and the primary button (`lpCard`, LPPrimaryButton). */
  card: 14,
  /** Bottom-sheet top corners. */
  sheet: 16,
  /** Capsules: chips, pills. */
  pill: 999,
} as const;

/** The smallest touch target (iOS 44 pt; Android's 48 dp is met with hit slop). */
export const minTouch = 44;

/** Standard page gutter (iOS `.padding(.horizontal, 20)`). */
export const gutter = 20;
