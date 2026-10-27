/**
 * The class room on the rows that carry a venue name (API 0.44.0): the
 * Classes feed card puts it after the venue, "World Class Laugar & Pool ·
 * Salur 4", and says it to TalkBack in the same place; a class with no room
 * (null, or a page cached from before 0.44.0) shows the venue alone. The raw
 * `locationText` is never shown.
 */
import { render, screen } from '@testing-library/react-native';

import { setCurrentLanguage } from '../../../i18n';
import ClassCard from '../ui/ClassCard';
import { cardAccessibilityLabel, venueLine } from '../ui/labels';
import { classItem } from './feedFixtures';

// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ where Jest's resolver cannot see it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const LAUGAR = { name: 'World Class Laugar & Pool', lat: 64.1427, lon: -21.8783 };
const startsAt = new Date('2030-03-14T10:00:00Z');
const now = new Date('2030-03-14T08:00:00Z');

beforeEach(() => setCurrentLanguage('en'));

it('a class with a room reads "venue · room" on the card and to TalkBack', async () => {
  const item = classItem({
    name: 'Hot Yoga',
    venue: LAUGAR,
    startsAt,
    extra: { room: 'Salur 4', locationText: 'Salur 4 · World Class, Reykjavík, Laugardalur, Iceland' },
  });
  await render(<ClassCard entry={{ item, distanceKm: null }} now={now} onOpen={() => undefined} />);
  expect(screen.getByTestId('classes.row.venue')).toHaveTextContent('World Class Laugar & Pool · Salur 4', { exact: true });
  expect(screen.queryByText(/Laugardalur/)).toBeNull();
  expect(screen.getByTestId('classes.row').props.accessibilityLabel).toContain('World Class Laugar & Pool · Salur 4');
});

it('a class with no room shows the venue alone, whatever its location prose says', async () => {
  const item = classItem({ name: 'Spin&core', venue: { name: '550 Skr', lat: null, lon: null }, startsAt, extra: { room: null, locationText: 'CF550 · Borgarflöt 5' } });
  await render(<ClassCard entry={{ item, distanceKm: null }} now={now} onOpen={() => undefined} />);
  expect(screen.getByTestId('classes.row.venue')).toHaveTextContent('550 Skr', { exact: true });
  expect(screen.queryByText(/CF550/)).toBeNull();
  expect(venueLine(item)).toBe('550 Skr');
  // TalkBack hears the venue on its own, with nothing after it.
  expect(cardAccessibilityLabel(item, null, now, 'en')).toContain(', 550 Skr, ');
});

it('a page cached from before 0.44.0 (no room key) reads as no room', () => {
  const item = classItem({ venue: LAUGAR, startsAt });
  expect(item.room).toBeNull();
  expect(venueLine(item)).toBe('World Class Laugar & Pool');
});
