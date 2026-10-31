/**
 * The party section's rules (iOS BookingFlowView groupStepper and
 * guestAgePicker, BookingViewModel syncGuestAgeBands): one to ten people, a
 * new guest is an adult at the end, minus drops the last guest, the age rows
 * only for a venue that sells more than one band, and "Child (6-15)" from
 * the venue's own range, in both languages.
 */
import type { AgeBandOffer } from '../../../../api/bookings';
import { lookup } from '../../../../i18n';
import {
  bandOptionLabel,
  bandsFromCounts,
  countsFromBands,
  MAX_PARTY,
  MIN_PARTY,
  partySize,
  selectedBandLabel,
  showsGuestAges,
  steppedBands,
} from '../partyModel';

const BANDS: AgeBandOffer[] = [
  { band: 'adult', rangeLabel: '16+', priceIsk: null },
  { band: 'child', rangeLabel: '6-15', priceIsk: 3_000 },
  { band: 'infant', rangeLabel: '0-5', priceIsk: 0 },
];

describe('the party size', () => {
  it('counts the member: no guests is one person, nine guests is ten', () => {
    expect(partySize([])).toBe(1);
    expect(partySize(Array(9).fill('adult'))).toBe(10);
    expect([MIN_PARTY, MAX_PARTY]).toEqual([1, 10]);
  });

  it('plus adds an adult at the end; minus drops the LAST guest, so a picked age stays with its person', () => {
    expect(steppedBands([], 1)).toEqual(['adult']);
    expect(steppedBands(['child'], 1)).toEqual(['child', 'adult']);
    expect(steppedBands(['child', 'adult'], -1)).toEqual(['child']);
    expect(steppedBands(['adult', 'child'], -1)).toEqual(['adult']);
    expect(steppedBands(['adult'], -1)).toEqual([]);
  });

  it('does nothing at a bound: never below the member alone, never above ten people', () => {
    expect(steppedBands([], -1)).toBeNull();
    expect(steppedBands(Array(9).fill('adult'), 1)).toBeNull();
    expect(steppedBands(Array(8).fill('adult'), 1)).toHaveLength(9);
  });

  it('the guest list is always one shorter than the party', () => {
    let bands: string[] = [];
    for (let size = 1; size <= MAX_PARTY; size += 1) {
      expect(bands).toHaveLength(size - 1);
      bands = steppedBands(bands, 1) ?? bands;
    }
    for (let size = MAX_PARTY; size >= 1; size -= 1) {
      expect(partySize(bands)).toBe(size);
      bands = steppedBands(bands, -1) ?? bands;
    }
  });
});

describe('guests by band', () => {
  it('counts each band, and reads counts back in the venue band order', () => {
    expect(countsFromBands(['adult', 'child', 'child'])).toEqual({ adult: 1, child: 2 });
    expect(countsFromBands([])).toEqual({});
    expect(bandsFromCounts({ child: 2, adult: 1 }, ['adult', 'child', 'infant'])).toEqual(['adult', 'child', 'child']);
    // A band the venue does not list still counts, after the listed ones.
    expect(bandsFromCounts({ senior: 1, infant: 1 }, ['adult', 'child', 'infant'])).toEqual(['infant', 'senior']);
  });

  it('a count that is not a whole, positive number is none, and nine guests at most', () => {
    expect(bandsFromCounts({ adult: -1, child: Number.NaN, infant: 1.7 })).toEqual(['infant']);
    expect(bandsFromCounts({ adult: 30 })).toHaveLength(MAX_PARTY - 1);
  });
});

describe('the guest age rows', () => {
  it('show only when the venue sells more than one band and someone else is coming', () => {
    expect(showsGuestAges(BANDS, ['adult'])).toBe(true);
    expect(showsGuestAges(BANDS, [])).toBe(false);
    expect(showsGuestAges([BANDS[0]], ['adult'])).toBe(false);
    expect(showsGuestAges([], ['adult', 'adult'])).toBe(false);
  });

  it("name each band with the venue's own range, in both languages", () => {
    expect(bandOptionLabel('child', '6-15', 'en')).toBe(`${lookup('booking.band_child', 'en')} (6-15)`);
    expect(bandOptionLabel('child', '6-15', 'en')).toBe('Child (6-15)');
    expect(bandOptionLabel('child', '6-15', 'is')).toBe('Barn (6-15)');
    expect(bandOptionLabel('infant', '0-5', 'is')).toBe('Ungbarn (0-5)');
    expect(bandOptionLabel('adult', null, 'en')).toBe('Adult');
    expect(bandOptionLabel('adult', '', 'en')).toBe('Adult');
  });

  it('a picked band keeps its own name, with the range when the venue still lists it', () => {
    expect(selectedBandLabel('child', BANDS, 'en')).toBe('Child (6-15)');
    expect(selectedBandLabel('child', [BANDS[0]], 'en')).toBe('Child');
    expect(selectedBandLabel('infant', [], 'is')).toBe('Ungbarn');
  });
});
