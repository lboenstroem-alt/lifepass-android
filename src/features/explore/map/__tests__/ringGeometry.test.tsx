/**
 * One drawing of a venue ring at three sizes (iOS `VenueRingView`): the
 * forms that say the type again for a reader who cannot tell the hues apart
 * (solid, split, double, framed, dashed), the insets, and the pin around it
 * (the halo, the photo and its grey stand-in).
 */
import { render, screen } from '@testing-library/react-native';

import { classify } from '../../../../lib/venueMarkerType';
import { mapRing } from '../../../../theme';
import { ringGeometry, wedgePath, type DiscLayer, type WedgeLayer } from '../ringGeometry';
import VenuePin, { PIN_BOX, PINNED_SCALE } from '../VenuePin';
import VenueRing from '../VenueRing';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const discs = (layers: readonly (DiscLayer | WedgeLayer)[]) =>
  layers.filter((layer): layer is DiscLayer => layer.kind === 'disc').map((layer) => [layer.diameter, layer.fill]);
const wedges = (layers: readonly (DiscLayer | WedgeLayer)[]) =>
  layers.filter((layer): layer is WedgeLayer => layer.kind === 'wedge');

describe('the ring’s geometry', () => {
  it('sizes: a 44 pt pin, a 20 pt legend swatch, a 10 pt card swatch, each with a 1 pt outer hairline', () => {
    expect(ringGeometry('gym', false, 'pin')).toMatchObject({ diameter: 44, outer: 46, inset: 3, inner: 38 });
    expect(ringGeometry('gym', false, 'legend')).toMatchObject({ diameter: 20, outer: 22, inset: 3, inner: 14 });
    expect(ringGeometry('gym', false, 'card')).toMatchObject({ diameter: 10, outer: 12, inset: 2, inner: 6 });
  });

  it('a solid type is its colour over the outer hairline', () => {
    expect(discs(ringGeometry('lagoon', false, 'pin').layers)).toEqual([
      [46, mapRing.outerHairline],
      [44, mapRing.lagoon],
    ]);
    expect(discs(ringGeometry('studio', false, 'pin').layers)).toEqual([
      [46, mapRing.outerHairline],
      [44, mapRing.studio],
    ]);
  });

  it('a pool keeps a white inner hairline against a dark photo', () => {
    expect(discs(ringGeometry('pool', false, 'pin').layers)).toEqual([
      [46, mapRing.outerHairline],
      [44, mapRing.pool],
      [40, mapRing.innerHairline],
    ]);
  });

  it('gym and pool is white and ink split on the diagonal, with the pool’s hairline', () => {
    const { layers } = ringGeometry('gymPool', false, 'pin');
    expect(wedges(layers).map((w) => [w.startDeg, w.sweepDeg, w.fill])).toEqual([
      [-45, 180, mapRing.gym],
      [135, 180, mapRing.pool],
    ]);
    expect(discs(layers)).toContainEqual([40, mapRing.innerHairline]);
  });

  it('spa and recovery is a double ring: moss, a white gap, moss', () => {
    const pin = ringGeometry('recovery', false, 'pin');
    expect(pin).toMatchObject({ inset: 4, inner: 36 });
    expect(discs(pin.layers)).toEqual([
      [46, mapRing.outerHairline],
      [44, mapRing.recovery],
      [41, mapRing.gym],
      [39, mapRing.recovery],
    ]);
    const card = ringGeometry('recovery', false, 'card');
    expect(card).toMatchObject({ inset: 3, inner: 4 });
    expect(discs(card.layers).slice(2)).toEqual([
      [8, mapRing.gym],
      [6, mapRing.recovery],
    ]);
  });

  it('racquet is framed by an ink hairline', () => {
    expect(discs(ringGeometry('racquet', false, 'pin').layers)).toEqual([
      [46, mapRing.outerHairline],
      [44, mapRing.racquet],
      [41, mapRing.ink],
    ]);
  });

  it('coming soon is 12 grey dashes from the top over white, whatever the type, with no inner form', () => {
    for (const type of ['gym', 'gymPool', 'recovery', 'lagoon'] as const) {
      const { layers, inset } = ringGeometry(type, true, 'pin');
      expect(inset).toBe(3);
      expect(discs(layers)).toEqual([
        [46, mapRing.outerHairline],
        [44, mapRing.gym],
      ]);
      const dashes = wedges(layers);
      expect(dashes).toHaveLength(12);
      expect(dashes.every((dash) => dash.fill === mapRing.soon && dash.sweepDeg === 18)).toBe(true);
      expect(dashes.map((dash) => dash.startDeg)).toEqual([-90, -60, -30, 0, 30, 60, 90, 120, 150, 180, 210, 240]);
    }
  });

  it('no ring is ever the sights’ light blue', () => {
    const fills = (['gym', 'gymPool', 'pool', 'lagoon', 'studio', 'recovery', 'racquet'] as const).flatMap((type) =>
      [false, true].flatMap((soon) => ringGeometry(type, soon, 'pin').layers.map((layer) => layer.fill.toUpperCase())),
    );
    expect(fills).not.toContain('#4EA8DE');
    expect(fills).not.toContain('#2C7DA0');
  });

  it('draws a wedge from the centre, in arcs of at most 90 degrees', () => {
    expect(wedgePath(10, 10, -90, 18)).toBe('M 10 10 L 10 0 A 10 10 0 0 1 13.09 0.489 Z');
    const half = wedgePath(10, 10, -45, 180);
    expect(half.match(/A /g)).toHaveLength(2);
  });
});

describe('the ring and the pin', () => {
  it('a swatch is decorative, with the grey stand-in inside', async () => {
    await render(<VenueRing type="lagoon" comingSoon={false} size="legend" testID="swatch" />);
    expect(screen.queryByTestId('swatch')).toBeNull();
    const content = screen.getByTestId('swatch.content', { includeHiddenElements: true });
    expect(content).toHaveStyle({ width: 14, height: 14, borderRadius: 7 });
  });

  it('a coming-soon ring washes its content out', async () => {
    await render(<VenueRing type="gym" comingSoon size="pin" testID="soon" />);
    expect(screen.getByTestId('soon.content', { includeHiddenElements: true })).toHaveStyle({
      filter: [{ grayscale: 1 }, { contrast: 0.85 }, { brightness: 1.1 }],
    });
  });

  it('a pin is one button in a box with room for its grown halo', async () => {
    expect(PIN_BOX).toBeGreaterThanOrEqual(52 * PINNED_SCALE);
    const onPress = jest.fn();
    await render(
      <VenuePin
        imageUrl="https://example.com/laugar.jpg"
        ring={classify({ primaryCategory: 'gym', offerings: ['pool'] })}
        pinned={false}
        accessibilityLabel="Laugar, Gym & pool"
        accessibilityHint="Opens the venue"
        onPress={onPress}
        reduceMotion
        testID="pin"
      />,
    );
    expect(screen.getByRole('button', { name: 'Laugar, Gym & pool' })).toBeTruthy();
    expect(screen.queryByTestId('venuePin.halo', { includeHiddenElements: true })).toBeNull();
    const source: unknown = screen.getByTestId('venuePin.photo', { includeHiddenElements: true }).props.source;
    expect([source].flat()).toEqual([{ uri: 'https://example.com/laugar.jpg' }]);
  });

  it('with no photo, the grey stand-in only, never another picture', async () => {
    await render(
      <VenuePin
        imageUrl={null}
        ring={classify({ primaryCategory: 'lagoon' })}
        pinned
        accessibilityLabel="Sky Lagoon, Lagoon"
        accessibilityHint="Opens the venue"
        onPress={jest.fn()}
        reduceMotion
      />,
    );
    expect(screen.queryByTestId('venuePin.photo', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('venuePin.halo', { includeHiddenElements: true })).toBeTruthy();
  });
});
