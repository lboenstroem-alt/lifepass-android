/**
 * One row of Explore's list (iOS SearchMapView `listRow`): the place line,
 * the tags, and the premium dot.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { decodeVenue } from '../../../api/venues';
import { setCurrentLanguage, t } from '../../../i18n';
import type { Venue } from '../../../types/venue';
import ExploreListRow, { capitalized, listRowPlace, listRowTags } from '../ExploreListRow';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

function venue(extra: Record<string, unknown> = {}): Venue {
  return decodeVenue({
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'laugar',
    name: 'Laugar',
    inBundle: true,
    city: 'Reykjavík',
    ...extra,
  });
}

describe('the place line', () => {
  it('adds Walk-ins only when walk-ins are allowed', () => {
    expect(listRowPlace(venue({ walkInsAllowed: true }), t)).toBe('Reykjavík · Walk-ins');
    expect(listRowPlace(venue({ walkInsAllowed: false }), t)).toBe('Reykjavík');
    expect(listRowPlace(venue(), t)).toBe('Reykjavík');
  });

  it('says Walk-in in Icelandic', () => {
    setCurrentLanguage('is');
    expect(listRowPlace(venue({ walkInsAllowed: true }), t)).toBe('Reykjavík · Walk-in');
  });

  it('names the country when the venue has no city', () => {
    expect(listRowPlace(venue({ city: null }), t)).toBe('Iceland');
    setCurrentLanguage('is');
    expect(listRowPlace(venue({ city: null, walkInsAllowed: true }), t)).toBe('Ísland · Walk-in');
  });
});

describe('the tags', () => {
  it('are the first two categories, capitalised as Foundation does', () => {
    expect(listRowTags(venue({ categories: ['gym', 'hot tub', 'spa'] }))).toEqual(['Gym', 'Hot Tub']);
    expect(listRowTags(venue({ categories: ['MMA'] }))).toEqual(['Mma']);
    expect(listRowTags(venue())).toEqual([]);
    expect(capitalized('group-classes')).toBe('Group-Classes');
    expect(capitalized('útisundlaug')).toBe('Útisundlaug');
  });
});

describe('the row', () => {
  it('shows the premium dot exactly when the venue is not in the bundle', async () => {
    await render(<ExploreListRow venue={venue({ inBundle: false, surchargePrice: 2990 })} onPress={() => undefined} />);
    expect(screen.getByTestId('explore.row.laugar.premium', { includeHiddenElements: true })).toBeTruthy();
    await render(<ExploreListRow venue={venue({ inBundle: true })} onPress={() => undefined} />);
    expect(screen.queryByTestId('explore.row.laugar.premium', { includeHiddenElements: true })).toBeNull();
  });

  it('opens its venue', async () => {
    const onPress = jest.fn();
    const row = venue({ categories: ['Gym'] });
    await render(<ExploreListRow venue={row} onPress={onPress} />);
    expect(screen.getByText('Laugar')).toBeTruthy();
    expect(screen.getByText('Gym')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('explore.row.laugar'));
    expect(onPress).toHaveBeenCalledWith(row);
  });
});
