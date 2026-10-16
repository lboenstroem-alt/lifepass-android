// Palette for UI that sits on top of full-bleed dark imagery (onboarding
// slides, the coach chat photo, hero scrims). The app's base theme is light
// paper/ink, but text and chrome over a dark photo must stay light — so these
// contexts use this frozen dark palette (the pre-light-theme values) instead of
// the flipped `theme/colors` tokens. Same shape as `theme/colors`.
export const onImage = {
  // Surfaces (dark glass over imagery)
  ink:   '#0F172A',
  ink2:  '#142139',
  ink3:  '#0A1F3D',
  ink4:  '#162952',

  // Borders
  line:  'rgba(230,242,255,0.08)',
  line2: 'rgba(230,242,255,0.14)',

  // Text (light on dark)
  paper:  '#F1F5F9',
  paper2: 'rgba(241,245,249,0.72)',
  paper3: 'rgba(241,245,249,0.48)',
  paper4: 'rgba(241,245,249,0.28)',

  // Accents (the glacier blue is the iOS lpRust / lpRust2, as on paper)
  blue:        '#4785C2',
  blueMid:     '#699ED4',
  blueWash:    'rgba(71,133,194,0.18)',
  skyBlue:     '#A8D8F0',
  moss:        '#5EB3A5',
  destructive: '#D36363',
} as const;
