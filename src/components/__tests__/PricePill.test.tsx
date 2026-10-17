/**
 * The venue price pill (iOS `VenuePricePill`): the words in the language on
 * screen, moss for in-bundle and the signal accent for premium.
 */
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { setCurrentLanguage } from '../../i18n';
import { colors } from '../../theme';
import PricePill from '../PricePill';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

function textColor(text: string): unknown {
  return StyleSheet.flatten(screen.getByText(text).props.style).color;
}

it('an in-bundle venue reads "Included" in moss', async () => {
  await render(<PricePill venue={{ inBundle: true, topupPrice: 2650 }} />);
  expect(screen.getByText('Included')).toBeOnTheScreen();
  expect(textColor('Included')).toBe(colors.moss);
});

it('a premium venue reads its resolved price in the signal accent', async () => {
  await render(<PricePill venue={{ inBundle: false, surchargePrice: 9990, resolvedSurchargePrice: 8490 }} compact />);
  expect(screen.getByText('from ISK 8,490')).toBeOnTheScreen();
  expect(textColor('from ISK 8,490')).toBe(colors.signal);
});

it('a boutique reads "Limited visits"', async () => {
  await render(<PricePill venue={{ inBundle: true, primaryCategory: 'boutique' }} />);
  expect(screen.getByText('Limited visits')).toBeOnTheScreen();
});

it('follows a language change while on screen', async () => {
  await render(<PricePill venue={{ inBundle: false, surchargePrice: 1990 }} />);
  expect(screen.getByText('from ISK 1,990')).toBeOnTheScreen();
  await act(async () => setCurrentLanguage('is'));
  expect(screen.getByText('frá ISK 1,990')).toBeOnTheScreen();
});

it('a premium venue with no figure points to the venue', async () => {
  setCurrentLanguage('is');
  await render(<PricePill venue={{ inBundle: false }} />);
  expect(screen.getByText('Sjá stað')).toBeOnTheScreen();
});
