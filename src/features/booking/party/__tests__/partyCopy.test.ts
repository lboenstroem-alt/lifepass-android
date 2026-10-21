/**
 * A group's disclosure and consent (iOS BookingCopy `disclosureText`,
 * `chargeConsentMessage` and `guestDisclosureLines`), in both languages:
 * the member's own spot by the surcharge's reason, the guests (one averaged
 * line for a party all of one band, a line per band for a mixed one), and
 * the total the confirm charges.
 */
import type { BookingPreview, GroupBreakdown } from '../../../../api/bookings';
import { lookup, type Lang } from '../../../../i18n';
import { bookingCopy } from '../../bookingCopy';

const LANGS: Lang[] = ['en', 'is'];

function fill(key: string, lang: Lang, params: Record<string, string>): string {
  return Object.entries(params).reduce((text, [name, value]) => text.split(`{${name}}`).join(value), lookup(key, lang));
}

const SAME: GroupBreakdown = { participants: 3, ownAmountIsk: 4_900, guestUnitIsk: 4_900, guestCount: 2, guests: null };
const MIXED: GroupBreakdown = {
  participants: 4,
  ownAmountIsk: 4_900,
  guestUnitIsk: 2_633,
  guestCount: 3,
  guests: [
    { band: 'adult', count: 1, unitIsk: 4_900 },
    { band: 'child', count: 1, unitIsk: 3_000 },
    { band: 'infant', count: 1, unitIsk: 0 },
  ],
};

function group(breakdown: GroupBreakdown, fields: Partial<BookingPreview> = {}): BookingPreview {
  return {
    kind: 'surcharge',
    topupReason: null,
    surchargeReason: 'premium_subscriber_visit',
    priceIsk: 12_800,
    remainingMonthly: 3,
    isLastBeforeTopUp: false,
    breakdown,
    visitChoice: null,
    ...fields,
  };
}

describe("the member's own spot", () => {
  it.each([
    ['premium_subscriber_visit', 'consent.group_own'],
    ['premium_out_of_visits', 'consent.group_own_oov'],
    // Money only because the member CHOSE to keep the visit: never the
    // out-of-visits words.
    ['premium_visit_kept', 'consent.group_own_kept'],
    [null, 'consent.group_own'],
  ])('a %s surcharge reads %s', (reason, key) => {
    for (const lang of LANGS) {
      const lines = bookingCopy(lang).disclosureText(group(SAME, { surchargeReason: reason })).split('\n');
      expect(lines[0]).toBe(fill(key, lang, { price: 'ISK 4,900' }));
    }
  });
});

describe('the guests', () => {
  it('a party all of one band keeps the one averaged line', () => {
    for (const lang of LANGS) {
      expect(bookingCopy(lang).guestDisclosureLines(SAME)).toEqual([
        fill('consent.group_guests', lang, { count: '2', price: 'ISK 4,900' }),
      ]);
    }
    // One band reported per band is still one band.
    const single = { ...SAME, guests: [{ band: 'adult', count: 2, unitIsk: 4_900 }] };
    expect(bookingCopy('en').guestDisclosureLines(single)).toEqual(['2 guest(s) × ISK 4,900 each at the member price.']);
  });

  it('a mixed party is itemised per band, never at an average price nobody pays', () => {
    expect(bookingCopy('en').guestDisclosureLines(MIXED)).toEqual([
      '1 × Adult at ISK 4,900 each.',
      '1 × Child at ISK 3,000 each.',
      '1 × Infant at ISK 0 each.',
    ]);
    expect(bookingCopy('is').guestDisclosureLines(MIXED)).toEqual([
      fill('consent.group_guests_band', 'is', { count: '1', band: 'Fullorðinn', price: 'ISK 4,900' }),
      fill('consent.group_guests_band', 'is', { count: '1', band: 'Barn', price: 'ISK 3,000' }),
      fill('consent.group_guests_band', 'is', { count: '1', band: 'Ungbarn', price: 'ISK 0' }),
    ]);
    for (const lang of LANGS) {
      expect(bookingCopy(lang).disclosureText(group(MIXED))).not.toContain('2,633');
    }
  });
});

describe('the whole group', () => {
  it('the disclosure is the own spot, the guests and the total, line by line', () => {
    for (const lang of LANGS) {
      expect(bookingCopy(lang).disclosureText(group(MIXED)).split('\n')).toEqual([
        fill('consent.group_own', lang, { price: 'ISK 4,900' }),
        ...bookingCopy(lang).guestDisclosureLines(MIXED),
        fill('consent.group_total', lang, { price: 'ISK 12,800' }),
      ]);
    }
  });

  it("the consent restates the same composition at the offer's total, after the price-changed note on a re-offer", () => {
    for (const lang of LANGS) {
      const copy = bookingCopy(lang);
      const preview = group(MIXED, { surchargeReason: 'premium_visit_kept' });
      const composition = [
        fill('consent.group_own_kept', lang, { price: 'ISK 4,900' }),
        ...copy.guestDisclosureLines(MIXED),
        fill('consent.group_total', lang, { price: 'ISK 13,100' }),
      ].join('\n');
      const offer = { kind: 'surcharge', amountIsk: 13_100 };
      expect(copy.chargeConsentMessage({ pendingOffer: offer, preview, offerWasReoffered: false })).toBe(composition);
      expect(copy.chargeConsentMessage({ pendingOffer: offer, preview, offerWasReoffered: true })).toBe(
        `${fill('consent.price_changed', lang, { price: 'ISK 13,100' })}\n\n${composition}`,
      );
      expect(copy.consentButtonLabel({ pendingOffer: offer })).toBe(fill('consent.pay_button', lang, { price: 'ISK 13,100' }));
    }
  });

  it('a group with no total on the preview reads as a plain surcharge, not a broken total', () => {
    const text = bookingCopy('en').disclosureText(group(SAME, { priceIsk: null }));
    expect(text).toBe(fill('consent.surcharge_premium_subscriber_visit', 'en', { price: lookup('consent.disclosure.extra_charge', 'en') }));
  });
});
