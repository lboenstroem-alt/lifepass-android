/**
 * The colour tokens are the iOS 2.5.6 values (LifePassTheme.swift), and the
 * map rings and readable-contrast tokens keep the promises the iOS tests make:
 *   VenueMarkerTypeTests.testNoRingIsTheSightsBlue
 *   BookingContrastTests.testTheBookingTokensMeetAA
 */
import { colors, contrastRatio, mapRing, mapRingHex, parseColor } from '..';

describe('tokens equal the iOS hex values', () => {
  it('surfaces, rules and text', () => {
    expect({
      ink: colors.ink,
      ink2: colors.ink2,
      ink3: colors.ink3,
      ink4: colors.ink4,
      line: colors.line,
      line2: colors.line2,
      paper: colors.paper,
      paper2: colors.paper2,
      paper3: colors.paper3,
      paper4: colors.paper4,
    }).toEqual({
      ink: '#F8F6F1',
      ink2: '#F2EFE8',
      ink3: '#E7E3DA',
      ink4: '#E0DBD1',
      // Solid hairlines, not a translucent ink.
      line: '#D8D3CB',
      line2: '#C4BFB5',
      paper: '#191C24',
      paper2: 'rgba(25,28,36,0.72)',
      paper3: 'rgba(25,28,36,0.48)',
      paper4: 'rgba(25,28,36,0.28)',
    });
  });

  it('accents, sights, destructive and the AA tokens', () => {
    expect({
      rust: colors.rust,
      rust2: colors.rust2,
      rust3: colors.rust3,
      aurora: colors.aurora,
      moss: colors.moss,
      signal: colors.signal,
      attraction: colors.attraction,
      attraction2: colors.attraction2,
      destructive: colors.destructive,
      mutedTextStrong: colors.mutedTextStrong,
      accentText: colors.accentText,
      actionFill: colors.actionFill,
    }).toEqual({
      rust: '#4785C2',
      rust2: '#699ED4',
      rust3: 'rgba(71,133,194,0.14)',
      aurora: '#4785C2',
      // iOS lpMoss is the ink now: "Included" reads as a neutral tag.
      moss: '#191C24',
      signal: '#2A4D6F',
      attraction: '#4EA8DE',
      attraction2: '#2C7DA0',
      destructive: '#D02525',
      mutedTextStrong: colors.paper2,
      accentText: '#2F6699',
      actionFill: '#2F6699',
    });
  });

  it('keeps the legacy Android names as aliases of the iOS tokens', () => {
    expect(colors.blue).toBe(colors.rust);
    expect(colors.blueMid).toBe(colors.rust2);
    expect(colors.blueWash).toBe(colors.rust3);
    expect(colors.skyBlue).toBe(colors.signal);
  });

  it('matches the iOS RGB literals the hex values were read from', () => {
    // LifePassTheme.swift writes Color(red:green:blue:) in 0..1 with three
    // decimals next to the design hex in a comment; the hex is the design
    // value (the web uses it too), and the literal lands within one step of
    // it per channel (lpLine's 0.845 is 215.5, drawn as #D7 or #D8).
    const swift: [string, [number, number, number]][] = [
      [colors.ink, [0.974, 0.965, 0.946]],
      [colors.ink2, [0.95, 0.937, 0.91]],
      [colors.ink3, [0.906, 0.889, 0.854]],
      [colors.ink4, [0.88, 0.86, 0.82]],
      [colors.line, [0.845, 0.828, 0.795]],
      [colors.line2, [0.771, 0.75, 0.709]],
      [colors.paper, [0.098, 0.111, 0.142]],
      [colors.rust, [0.28, 0.52, 0.76]],
      [colors.rust2, [0.411, 0.62, 0.829]],
      [colors.signal, [0.165, 0.3, 0.435]],
      [colors.attraction, [0.306, 0.659, 0.871]],
      [colors.attraction2, [0.173, 0.49, 0.628]],
      [colors.destructive, [0.816, 0.144, 0.144]],
      [colors.accentText, [0.184, 0.4, 0.6]],
    ];
    for (const [hex, rgb] of swift) {
      const parsed = parseColor(hex);
      rgb.forEach((channel, i) => expect(Math.abs(parsed[i] * 255 - channel * 255)).toBeLessThanOrEqual(1));
    }
  });
});

describe('map rings (VenueMarkerTypeTests, colours)', () => {
  const rings = [
    mapRing.gym,
    mapRing.pool,
    mapRing.lagoon,
    mapRing.studio,
    mapRing.recovery,
    mapRing.racquet,
    mapRing.soon,
  ];

  it('no ring is the sights blue', () => {
    const upper = rings.map((r) => r.toUpperCase());
    expect(upper).not.toContain(colors.attraction.toUpperCase());
    expect(upper).not.toContain(colors.attraction2.toUpperCase());
  });

  it('every type has its own hue', () => {
    expect(new Set(rings).size).toBe(rings.length);
  });

  it("are the web's values (map-colors.ts MAP_RING_*)", () => {
    expect(rings).toEqual(['#FFFFFF', '#191D24', '#155E9E', '#B4532A', '#5B7F4A', '#6E56A8', '#8A8F98']);
    expect(mapRing.ink).toBe(mapRing.pool);
    expect(mapRing.innerHairline).toBe('rgba(255,255,255,0.7)');
    expect(mapRing.outerHairline).toBe('rgba(25,29,36,0.55)');
    expect(mapRing.swatchFill).toBe('#6B7280');
  });

  it('maps each venue type to its ring, gym + pool leading with snow', () => {
    expect(mapRingHex('gym')).toBe('#FFFFFF');
    expect(mapRingHex('gymPool')).toBe('#FFFFFF');
    expect(mapRingHex('pool')).toBe('#191D24');
    expect(mapRingHex('lagoon')).toBe('#155E9E');
    expect(mapRingHex('studio')).toBe('#B4532A');
    expect(mapRingHex('recovery')).toBe('#5B7F4A');
    expect(mapRingHex('racquet')).toBe('#6E56A8');
  });
});

describe('readable contrast (BookingContrastTests, WCAG AA)', () => {
  const white = '#FFFFFF';
  // iOS aliases: lpMuted = lpInk2, lpBackground = lpInk, lpPrimary = lpRust,
  // lpMutedForeground = lpPaper3.

  it('the booking tokens meet 4.5:1', () => {
    expect(contrastRatio(white, colors.actionFill)).toBeGreaterThanOrEqual(4.5); // Confirm, Next, Try again
    expect(contrastRatio(colors.accentText, colors.ink2)).toBeGreaterThanOrEqual(4.5); // See other times
    expect(contrastRatio(colors.accentText, colors.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.mutedTextStrong, colors.ink2)).toBeGreaterThanOrEqual(4.5); // meta lines, notes
    expect(contrastRatio(colors.mutedTextStrong, colors.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.mutedTextStrong, colors.ink3)).toBeGreaterThanOrEqual(4.5); // disabled Confirm label
  });

  it('what they replace fell short, which is why they exist', () => {
    expect(contrastRatio(white, colors.rust)).toBeLessThan(4.5);
    expect(contrastRatio(colors.paper3, colors.ink2)).toBeLessThan(4.5);
  });

  it('reads the ratios the iOS comments quote', () => {
    // "white on #4785C2 3.9:1", "lpActionFill 6.0:1"
    expect(contrastRatio(white, colors.rust)).toBeCloseTo(3.9, 1);
    expect(contrastRatio(white, colors.actionFill)).toBeCloseTo(6.0, 1);
    // "lpPaper3 text 3.0 to 3.1:1"
    const paper3 = contrastRatio(colors.paper3, colors.ink);
    expect(paper3).toBeGreaterThanOrEqual(2.95);
    expect(paper3).toBeLessThan(3.2);
  });

  it('parses the colour notations the tokens use', () => {
    expect(parseColor('#FFF')).toEqual([1, 1, 1, 1]);
    expect(parseColor('rgba(25,28,36,0.48)')[3]).toBe(0.48);
    expect(parseColor('rgb(0,0,0)')).toEqual([0, 0, 0, 1]);
    expect(() => parseColor('blue')).toThrow(/Unreadable/);
  });
});
