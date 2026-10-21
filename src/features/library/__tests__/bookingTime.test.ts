/**
 * When a booking is (iOS LibraryView `relativeLabel`), on Reykjavík's clock.
 */
import { translate, type Lang } from '../../../i18n';
import { pastRowDetail, relativeBookingTime } from '../bookings/bookingTime';

const tr = (lang: Lang) => (key: string) => translate(key, lang);
const NOW = new Date('2026-10-21T12:00:00Z');

describe('relativeBookingTime', () => {
  it('says Today, Tomorrow and Yesterday in the account language, with a 24-hour time', () => {
    expect(relativeBookingTime(new Date('2026-10-21T18:05:00Z'), tr('en'), NOW)).toBe('Today · 18:05');
    expect(relativeBookingTime(new Date('2026-10-22T09:30:00Z'), tr('en'), NOW)).toBe('Tomorrow · 09:30');
    expect(relativeBookingTime(new Date('2026-10-20T07:00:00Z'), tr('en'), NOW)).toBe('Yesterday · 07:00');
    expect(relativeBookingTime(new Date('2026-10-21T18:05:00Z'), tr('is'), NOW)).toBe('Í dag · 18:05');
    expect(relativeBookingTime(new Date('2026-10-22T09:30:00Z'), tr('is'), NOW)).toBe('Á morgun · 09:30');
    expect(relativeBookingTime(new Date('2026-10-20T07:00:00Z'), tr('is'), NOW)).toBe('Í gær · 07:00');
  });

  it('writes any other day as the abbreviated date and time', () => {
    expect(relativeBookingTime(new Date('2026-10-25T14:00:00Z'), tr('en'), NOW)).toBe('25 Oct 2026, 14:00');
    expect(relativeBookingTime(new Date('2026-09-02T08:15:00Z'), tr('is'), NOW)).toBe('2 Sept 2026, 08:15');
  });

  it('reads the day on the venue clock: 23:30 UTC is still today in Reykjavík', () => {
    expect(relativeBookingTime(new Date('2026-10-21T23:30:00Z'), tr('en'), NOW)).toBe('Today · 23:30');
    expect(relativeBookingTime(new Date('2026-10-22T00:00:00Z'), tr('en'), NOW)).toBe('Tomorrow · 00:00');
  });

  it('is empty for a date that holds no instant', () => {
    expect(relativeBookingTime(new Date('x'), tr('en'), NOW)).toBe('');
  });

  it('joins the past row line with a middle dot', () => {
    expect(pastRowDetail('Yoga Flow', 'Yesterday · 07:00')).toBe('Yoga Flow · Yesterday · 07:00');
  });
});
