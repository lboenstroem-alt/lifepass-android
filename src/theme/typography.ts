// Type system, as on iOS (LifePassTheme.swift `LPFont`) and the web:
//   Inter Tight  body / UI      (iOS `.lpSans(size:weight:)`)
//   Fraunces     editorial headings (iOS `LPFont.serif(size, weight:)`)
//
// Font families are registered under these keys by `useFonts` in App.tsx.
// Inter Tight is applied globally as the default Text font (weight- and
// italic-aware, via theme/installFontDefaults). Custom fonts ship one file per
// weight/style, so every cut we use must be listed here AND loaded in App.tsx.
//
// `sans()` and `serif()` port the iOS helpers: they name the exact face for a
// weight, so a style built inline (outside StyleSheet.create, where the font
// defaults are not injected) still gets the right cut. They never set
// `fontWeight`: Android would synthesise a fake bold over an already-bold face.
import type { TextStyle } from 'react-native';

export const fonts = {
  // Inter Tight — body / UI
  sans:               'InterTight_400Regular',
  sansMedium:         'InterTight_500Medium',
  sansSemiBold:       'InterTight_600SemiBold',
  sansBold:           'InterTight_700Bold',
  sansItalic:         'InterTight_400Regular_Italic',
  sansMediumItalic:   'InterTight_500Medium_Italic',
  sansSemiBoldItalic: 'InterTight_600SemiBold_Italic',
  sansBoldItalic:     'InterTight_700Bold_Italic',

  // Fraunces — editorial headings
  serif:              'Fraunces_400Regular',
  serifMedium:        'Fraunces_500Medium',
  serifSemiBold:      'Fraunces_600SemiBold',
  serifBold:          'Fraunces_700Bold',
  serifItalic:        'Fraunces_400Regular_Italic',
  serifMediumItalic:  'Fraunces_500Medium_Italic',
} as const;

/** The weights the app draws (SwiftUI `.regular`, `.medium`, `.semibold`, `.bold`). */
export type FontWeight = 'regular' | 'medium' | 'semibold' | 'bold';

const SANS: Record<FontWeight, string> = {
  regular: fonts.sans,
  medium: fonts.sansMedium,
  semibold: fonts.sansSemiBold,
  bold: fonts.sansBold,
};

const SANS_ITALIC: Record<FontWeight, string> = {
  regular: fonts.sansItalic,
  medium: fonts.sansMediumItalic,
  semibold: fonts.sansSemiBoldItalic,
  bold: fonts.sansBoldItalic,
};

const SERIF: Record<FontWeight, string> = {
  regular: fonts.serif,
  medium: fonts.serifMedium,
  semibold: fonts.serifSemiBold,
  bold: fonts.serifBold,
};

/** Fraunces ships italics in two weights; heavier italics use the medium cut. */
const SERIF_ITALIC: Record<FontWeight, string> = {
  regular: fonts.serifItalic,
  medium: fonts.serifMediumItalic,
  semibold: fonts.serifMediumItalic,
  bold: fonts.serifMediumItalic,
};

/** Inter Tight at a size and weight: iOS `.lpSans(size:weight:)`. */
export function sans(size: number, weight: FontWeight = 'regular', italic = false): TextStyle {
  return { fontFamily: (italic ? SANS_ITALIC : SANS)[weight], fontSize: size };
}

/** Fraunces at a size and weight: iOS `LPFont.serif(size, weight:italic:)`. */
export function serif(size: number, weight: FontWeight = 'regular', italic = false): TextStyle {
  return { fontFamily: (italic ? SERIF_ITALIC : SERIF)[weight], fontSize: size };
}
