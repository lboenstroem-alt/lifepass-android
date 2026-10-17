/**
 * A booking's venue picture (F6, plan "no picsum anywhere"): the bookings API
 * carries none, so a booking has none. Never a stock photo shown as the
 * venue, and never an empty uri handed to an Image.
 */
import { adaptBooking } from '../bookings';

it('a booking has no venue picture, not a stock photo and not an empty uri', () => {
  const booking = adaptBooking({
    id: 'b1',
    status: 'confirmed',
    startsAt: '2026-10-20T08:00:00Z',
    endsAt: '2026-10-20T09:00:00Z',
    venue: { id: 'v1', slug: 'sky-lagoon', name: 'Sky Lagoon' },
    activity: { id: 'a1', name: 'Ritual' },
  });
  expect(booking.venueImageUrl).toBeUndefined();
  expect(JSON.stringify(booking)).not.toMatch(/picsum|unsplash/i);
});
