// Which styles carry a font family their author chose, and which only the
// default Inter Tight face that installFontDefaults injected.
//
// WHY. installFontDefaults gives every StyleSheet style with a fontSize,
// fontWeight or fontStyle an Inter Tight `fontFamily`. A component that picks
// its own face (LPText `serif`, Kicker) and also takes a caller's `style`
// must not let that injected family override the face it was asked for:
// `<LPText serif style={styles.title}>` with `title: { fontSize: 26 }` is
// Fraunces at 26, as iOS `LPFont.serif` always is. A family the author wrote
// still wins.

const injected = new WeakSet<object>();

/** Records that `style`'s fontFamily is the injected default, not the author's. */
export function markDefaultFace(style: object): void {
  injected.add(style);
}

/** Whether `style` (any nesting of arrays) names a font family its author chose. */
export function hasExplicitFontFamily(style: unknown): boolean {
  if (!style || typeof style !== 'object') return false;
  if (Array.isArray(style)) return style.some(hasExplicitFontFamily);
  if (injected.has(style)) return false;
  return typeof (style as { fontFamily?: unknown }).fontFamily === 'string';
}
