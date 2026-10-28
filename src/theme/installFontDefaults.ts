import { StyleSheet } from 'react-native';

import { markDefaultFace } from './fontInjection';
import { fonts } from './typography';

// Default font (Inter Tight) for styles built with StyleSheet.create.
// React Native has no font cascade and custom fonts ship one file per
// weight/style, so we can't rely on a bare `fontFamily`. Instead we wrap
// `StyleSheet.create` and inject the matching Inter Tight face into every text
// style that declares text intent (fontSize/fontWeight/fontStyle) but no
// `fontFamily` of its own. Styles that opt into Fraunces (fonts.serif*) already
// set `fontFamily`, so they're left untouched, and any explicit face wins.
// Injected styles are marked (fontInjection.ts), so LPText and Kicker keep the
// face they were asked for when a caller's style carries an injected one.
//
// WHAT THIS DOES NOT COVER. A <Text> with no style, an inline style, or a
// StyleSheet style without fontSize/fontWeight/fontStyle (a colour only)
// renders in the system font (Roboto). There is no global default: React 19
// ignores `defaultProps` on function components, which Text and TextInput
// are in React Native 0.81. Draw text with `LPText` (src/components/ui), or
// spread `sans()` / `serif()` from src/theme into the style.
//
// This module must be imported before any screen's `StyleSheet.create` runs —
// see index.ts, where it's the first import.

const interUpright: Record<string, string> = {
  '100': fonts.sans, '200': fonts.sans, '300': fonts.sans, '400': fonts.sans,
  normal: fonts.sans,
  '500': fonts.sansMedium,
  '600': fonts.sansSemiBold,
  '700': fonts.sansBold, '800': fonts.sansBold, '900': fonts.sansBold,
  bold: fonts.sansBold,
};

const interItalic: Record<string, string> = {
  '100': fonts.sansItalic, '200': fonts.sansItalic, '300': fonts.sansItalic,
  '400': fonts.sansItalic, normal: fonts.sansItalic,
  '500': fonts.sansMediumItalic,
  '600': fonts.sansSemiBoldItalic,
  '700': fonts.sansBoldItalic, '800': fonts.sansBoldItalic, '900': fonts.sansBoldItalic,
  bold: fonts.sansBoldItalic,
};

type TextIntent = { fontFamily?: string; fontSize?: number; fontWeight?: string | number; fontStyle?: string };

function interFor(style: TextIntent): string {
  const weight = String(style.fontWeight ?? '400');
  const table = style.fontStyle === 'italic' ? interItalic : interUpright;
  return table[weight] ?? (style.fontStyle === 'italic' ? fonts.sansItalic : fonts.sans);
}

function isTextStyle(s: unknown): s is TextIntent {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  const style = s as TextIntent;
  return !style.fontFamily && (style.fontSize != null || style.fontWeight != null || style.fontStyle != null);
}

let installed = false;

export function installFontDefaults() {
  if (installed) return;
  installed = true;

  // Inject Inter Tight into text styles built via StyleSheet.create.
  const origCreate = StyleSheet.create.bind(StyleSheet);
  const patchedCreate = function patchedCreate(styles: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    for (const key in styles) {
      const s = styles[key];
      if (isTextStyle(s)) {
        const withFace = { fontFamily: interFor(s), ...s };
        markDefaultFace(withFace);
        out[key] = withFace;
      } else {
        out[key] = s;
      }
    }
    return origCreate(out as Parameters<typeof origCreate>[0]);
  };
  (StyleSheet as { create: unknown }).create = patchedCreate;
}

installFontDefaults();
