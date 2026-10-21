/**
 * Home's venue cards (iOS HomeView's private NearbyVenueCard and
 * CuratedVenueRow): the price where it belongs, never a distance on Nearby,
 * never a favourite heart on Popular (D4), and the iOS city fallbacks.
 */
import { render, screen } from '@testing-library/react-native';

import { decodeVenue } from '../../api/venues';
import { restoreTestFontScale, setTestFontScale } from '../../hooks/testing';
import { setCurrentLanguage } from '../../i18n';
import CuratedVenueRow, { capitalized, curatedCityLine, rowCategories } from '../CuratedVenueRow';
import NearbyVenueCard, { nearbyCityLine } from '../NearbyVenueCard';

// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ (as the UI kit's tests do).
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

beforeEach(() => setTestFontScale(1));
afterEach(() => restoreTestFontScale());

const venue = (extra: Record<string, unknown> = {}) =>
  decodeVenue({
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'sundholl',
    name: 'Sundhöll Reykjavíkur',
    inBundle: true,
    coordinates: { latitude: 64.143, longitude: -21.92 },
    ...extra,
  });

describe('NearbyVenueCard', () => {
  it('shows the name, the city and the price badge, and no distance at all', async () => {
    await render(<NearbyVenueCard venue={venue({ city: 'Reykjavík' })} />);
    expect(screen.getByText('Sundhöll Reykjavíkur')).toBeOnTheScreen();
    expect(screen.getByText('Reykjavík')).toBeOnTheScreen();
    expect(screen.getByText('Included')).toBeOnTheScreen();
    expect(screen.getByText('Book it')).toBeOnTheScreen();
    expect(screen.queryByText(/\d\s?(m|km)\b/)).toBeNull();
  });

  it('a premium venue shows its from-price', async () => {
    await render(<NearbyVenueCard venue={venue({ inBundle: false, surchargePrice: 4990 })} />);
    expect(screen.getByText('from ISK 4,990')).toBeOnTheScreen();
  });

  it('city, else address, else Reykjavík', () => {
    expect(nearbyCityLine({ city: 'Kópavogur', address: 'Dalsmári 5' }, 'Reykjavík')).toBe('Kópavogur');
    expect(nearbyCityLine({ city: null, address: 'Dalsmári 5' }, 'Reykjavík')).toBe('Dalsmári 5');
    expect(nearbyCityLine({ city: null, address: null }, 'Reykjavík')).toBe('Reykjavík');
  });
});

describe('CuratedVenueRow', () => {
  it('carries the price pill and the Book it pill where the heart was, and no heart', async () => {
    await render(<CuratedVenueRow venue={venue({ categories: ['pool', 'hot tub', 'sauna'] })} />);
    expect(screen.getByText('Included')).toBeOnTheScreen();
    expect(screen.getByText('Book it')).toBeOnTheScreen();
    expect(screen.getByText('Pool')).toBeOnTheScreen();
    expect(screen.getByText('Hot Tub')).toBeOnTheScreen();
    expect(screen.queryByText('Sauna')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Iceland')).toBeOnTheScreen();
  });

  it('follows the account language, Iceland included', async () => {
    setCurrentLanguage('is');
    await render(<CuratedVenueRow venue={venue()} />);
    expect(screen.getByText('Innifalið')).toBeOnTheScreen();
    expect(screen.getByText('Bóka')).toBeOnTheScreen();
    expect(screen.getByText('Ísland')).toBeOnTheScreen();
  });

  it('city, else address, else Iceland; categories capitalised as Swift does, two at most', () => {
    expect(curatedCityLine({ city: null, address: 'Laugavegur 1' }, 'Iceland')).toBe('Laugavegur 1');
    expect(curatedCityLine({ city: null, address: null }, 'Iceland')).toBe('Iceland');
    expect(capitalized('hot YOGA')).toBe('Hot Yoga');
    expect(capitalized('crossfit-box')).toBe('Crossfit-Box');
    expect(capitalized('útisundlaug')).toBe('Útisundlaug');
    expect(rowCategories({ categories: ['a', 'b', 'c'] })).toEqual(['A', 'B']);
    expect(rowCategories({ categories: null })).toEqual([]);
  });
});
