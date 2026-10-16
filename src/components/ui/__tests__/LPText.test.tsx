/**
 * The face follows the props (iOS LPFont.serif / Font.lpSans): the Inter
 * Tight family installFontDefaults injects into a StyleSheet style must not
 * override `serif` or `weight`; a family the author wrote still wins.
 */
import '../../../theme/installFontDefaults';

import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { fonts } from '../../../theme';
import Kicker from '../Kicker';
import LPText from '../LPText';

// Built after the font defaults are installed, as every screen's styles are.
const styles = StyleSheet.create({
  title: { fontSize: 26 },
  heavy: { fontWeight: '700' },
  custom: { fontFamily: 'Fraunces_700Bold', fontSize: 30 },
});

const flat = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style) as { fontFamily?: string; fontSize?: number };

it('the font defaults inject Inter Tight into a StyleSheet style with a size', () => {
  expect((styles.title as { fontFamily?: string }).fontFamily).toBe(fonts.sans);
});

it('LPText serif with a StyleSheet size is Fraunces at that size, not the injected Inter Tight', async () => {
  await render(
    <LPText serif size={24} style={styles.title} testID="title">
      Plan
    </LPText>,
  );
  expect(flat('title')).toMatchObject({ fontFamily: fonts.serif, fontSize: 26 });
});

it('LPText keeps its weight when a style array carries an injected face', async () => {
  await render(
    <LPText weight="semibold" style={[styles.heavy, { color: 'red' }]} testID="line">
      Today
    </LPText>,
  );
  expect(flat('line').fontFamily).toBe(fonts.sansSemiBold);
});

it("a family the caller wrote still wins", async () => {
  await render(
    <LPText style={styles.custom} testID="custom">
      Week
    </LPText>,
  );
  expect(flat('custom')).toMatchObject({ fontFamily: 'Fraunces_700Bold', fontSize: 30 });
});

it('Kicker keeps its semibold face under a StyleSheet style', async () => {
  await render(<Kicker text="Nearby" style={styles.title} testID="kicker" />);
  expect(flat('kicker')).toMatchObject({ fontFamily: fonts.sansSemiBold, fontSize: 26 });
});
