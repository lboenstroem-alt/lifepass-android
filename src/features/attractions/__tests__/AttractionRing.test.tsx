/**
 * The sight's ring (iOS `AttractionMapMarker`): sizes and strokes by tier,
 * the trailhead's dark centre before a top pick's light one, decorative to
 * TalkBack.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { colors } from '../../../theme';
import AttractionRing, { ringDotColor, ringDotDiameter, ringLineWidth } from '../AttractionRing';

describe('the ring', () => {
  it('strokes by tier, heavier when selected', () => {
    expect(ringLineWidth('top', false)).toBe(3.5);
    expect(ringLineWidth('top', true)).toBe(4.5);
    expect(ringLineWidth('notable', false)).toBe(3);
    expect(ringLineWidth('standard', true)).toBe(3.5);
  });

  it('gives a trailhead its dark centre, a top pick a light one, and others none', () => {
    expect(ringDotColor('notable', true)).toBe(colors.attraction2);
    expect(ringDotColor('top', true)).toBe(colors.attraction2);
    expect(ringDotColor('top', false)).toBe(colors.attraction);
    expect(ringDotColor('notable', false)).toBeNull();
    expect(ringDotDiameter('top', false)).toBe(6);
    expect(ringDotDiameter('notable', true)).toBe(7);
  });

  it('draws a white disc in a light-blue stroke centred in its frame, hidden from TalkBack', async () => {
    await render(<AttractionRing tier="top" isTrailhead frame={32} testID="ring" />);
    const frame = screen.getByTestId('ring', { includeHiddenElements: true });
    expect(StyleSheet.flatten(frame.props.style)).toMatchObject({ width: 32, height: 32 });
    expect(frame.props.importantForAccessibility).toBe('no-hide-descendants');
    // A 22 dp ring with a 3.5 dp stroke on its path: 25.5 dp across.
    const ring = StyleSheet.flatten(screen.getByTestId('ring.ring', { includeHiddenElements: true }).props.style);
    expect(ring).toMatchObject({ width: 25.5, height: 25.5, borderWidth: 3.5, borderColor: colors.attraction, backgroundColor: '#FFFFFF' });
    const dot = StyleSheet.flatten(screen.getByTestId('ring.dot', { includeHiddenElements: true }).props.style);
    expect(dot).toMatchObject({ width: 6, backgroundColor: colors.attraction2 });
  });

  it('a plain notable ring has no centre', async () => {
    await render(<AttractionRing testID="ring" />);
    expect(screen.queryByTestId('ring.dot', { includeHiddenElements: true })).toBeNull();
  });
});
