/**
 * The class room on My bookings' rows (API 0.44.0): after the venue name,
 * "World Class Laugar & Pool · Salur 4", on the Upcoming card and the Past
 * row alike, as `GET /bookings` has it now. No room, or a slot booking: the
 * venue alone, and never the raw `location` prose.
 */
import { render, screen } from '@testing-library/react-native';

import type { MemberBooking } from '../../../api/bookingsList';
import { setCurrentLanguage } from '../../../i18n';
import { PastBookingRow, UpcomingBookingCard } from '../bookings/BookingRows';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const now = new Date('2030-03-13T10:00:00Z');

function booking(overrides: Partial<MemberBooking> = {}): MemberBooking {
  return {
    id: '7a1c2b3d-0000-4000-8000-0000000000aa',
    status: 'confirmed',
    startsAt: new Date('2030-03-14T10:00:00Z'),
    endsAt: new Date('2030-03-14T11:00:00Z'),
    cancelledAt: null,
    cancellationReason: null,
    venue: { id: '1b9c6d2e-3f40-4a51-8b62-7c83d94e05f1', slug: 'world-class-laugar', name: 'World Class Laugar & Pool' },
    activity: null,
    externalTitle: 'Hot Yoga',
    location: 'Salur  4',
    room: 'Salur 4',
    ...overrides,
  };
}

beforeEach(() => setCurrentLanguage('is'));

it('the Upcoming card puts the room after the venue, on a second line if it needs one', async () => {
  const row = booking();
  await render(<UpcomingBookingCard booking={row} now={now} />);
  const venue = screen.getByTestId(`library.booking.${row.id}.venue`);
  expect(venue).toHaveTextContent('World Class Laugar & Pool · Salur 4', { exact: true });
  expect(venue).toHaveProp('numberOfLines', 2);
  expect(screen.queryByText('Salur  4')).toBeNull();
});

it('the Past row does the same, with the room the booking was made with', async () => {
  const row = booking({ room: 'Salur 1 - 1. hæð', venue: { id: 'x', slug: 'nordur', name: 'Nordur Akureyri' } });
  await render(<PastBookingRow booking={row} now={now} />);
  expect(screen.getByTestId(`library.past_venue.${row.id}`)).toHaveTextContent('Nordur Akureyri · Salur 1 - 1. hæð', { exact: true });
});

it('no room: the venue alone, on one line, never the location prose', async () => {
  const row = booking({ room: null, location: 'Grandi101' });
  await render(<UpcomingBookingCard booking={row} now={now} />);
  const venue = screen.getByTestId(`library.booking.${row.id}.venue`);
  expect(venue).toHaveTextContent('World Class Laugar & Pool', { exact: true });
  expect(venue).toHaveProp('numberOfLines', 1);
  expect(screen.queryByText(/Grandi101/)).toBeNull();
});
