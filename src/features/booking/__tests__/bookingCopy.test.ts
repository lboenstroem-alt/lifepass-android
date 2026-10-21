/**
 * The booking copy (iOS BookingCopy): the disclosure by kind and reason, the
 * consent message and button, the honest not-bookable labels, in English and
 * Icelandic, from the generated iOS keys.
 */
import type { BookingPreview } from '../../../api/bookings';
import { lookup, type Lang } from '../../../i18n';
import { bookingCopy, confirmedBody } from '../bookingCopy';

const LANGS: Lang[] = ['en', 'is'];

function preview(fields: Partial<BookingPreview>): BookingPreview {
  return {
    kind: 'surcharge',
    topupReason: null,
    surchargeReason: null,
    priceIsk: 2_500,
    remainingMonthly: null,
    isLastBeforeTopUp: false,
    breakdown: null,
    visitChoice: null,
    ...fields,
  };
}

const fill = (key: string, lang: Lang, price: string) => lookup(key, lang).replace('{price}', price);

describe('the disclosure', () => {
  it('free reads included, with what is left and the last-before-top-up note', () => {
    for (const lang of LANGS) {
      const copy = bookingCopy(lang);
      expect(copy.disclosureText(preview({ kind: 'free', priceIsk: null }))).toBe(lookup('consent.disclosure.free', lang));
      expect(copy.disclosureText(preview({ kind: 'free', priceIsk: null, remainingMonthly: 3, isLastBeforeTopUp: true }))).toBe(
        [
          lookup('consent.disclosure.free', lang),
          lookup('consent.disclosure.free_left', lang).replace('{count}', '3'),
          lookup('consent.disclosure.last_before_topup', lang),
        ].join(' '),
      );
      expect(copy.disclosureIcon({ kind: 'free' })).toBe('shield-checkmark-outline');
    }
  });

  it('a pass uses one visit; a pass and a charge have their own icons', () => {
    const copy = bookingCopy('en');
    expect(copy.disclosureText(preview({ kind: 'pass', priceIsk: null }))).toBe('This uses 1 visit from your pass.');
    expect(copy.disclosureIcon({ kind: 'pass' })).toBe('ticket-outline');
    expect(copy.disclosureIcon({ kind: 'topup' })).toBe('card-outline');
    expect(copy.disclosureIcon({ kind: 'surcharge' })).toBe('card-outline');
  });

  it.each([
    ['boutique_overflow', 'consent.topup_boutique_overflow'],
    ['boutique_not_included', 'consent.topup_boutique_not_included'],
    ['monthly_exhausted', 'consent.disclosure.topup_monthly_exhausted'],
    [null, 'consent.disclosure.topup'],
  ])('a top-up for %s reads %s', (reason, key) => {
    for (const lang of LANGS) {
      expect(bookingCopy(lang).disclosureText(preview({ kind: 'topup', topupReason: reason, priceIsk: 2_790 }))).toBe(
        fill(key, lang, 'ISK 2,790'),
      );
    }
  });

  it.each([
    ['boutique_overflow', 'consent.surcharge_boutique_overflow'],
    ['boutique_access', 'consent.surcharge_boutique_access'],
    ['premium_out_of_visits', 'consent.surcharge_premium_out_of_visits'],
    ['premium_pass_visit', 'consent.surcharge_premium_pass_visit'],
    ['premium_subscriber_visit', 'consent.surcharge_premium_subscriber_visit'],
    ['premium_visit_kept', 'consent.surcharge_premium_visit_kept'],
    ['premium_no_plan', 'consent.surcharge_premium_no_plan'],
    [null, 'consent.disclosure.surcharge'],
  ])('a surcharge for %s reads %s', (reason, key) => {
    for (const lang of LANGS) {
      expect(bookingCopy(lang).disclosureText(preview({ surchargeReason: reason, priceIsk: 2_500 }))).toBe(
        fill(key, lang, 'ISK 2,500'),
      );
    }
  });

  it('premium_no_plan is the full price, never called a surcharge, in either language', () => {
    const p = preview({ surchargeReason: 'premium_no_plan', priceIsk: 6_300 });
    for (const lang of LANGS) {
      const text = bookingCopy(lang).disclosureText(p);
      expect(text.toLowerCase()).not.toContain('surcharge');
      expect(text.toLowerCase()).not.toContain('álag');
      expect(text).toContain('ISK 6,300');
    }
  });

  it('a price always reads "ISK 2,500" in both languages, never "kr" or a grouped "2.500"', () => {
    for (const lang of LANGS) {
      const text = bookingCopy(lang).disclosureText(preview({ priceIsk: 2_500 }));
      expect(text).toContain('ISK 2,500');
      expect(text).not.toContain('kr');
      expect(text).not.toContain('2.500');
    }
  });

  it('a missing price reads "an extra charge", never "a ISK"', () => {
    const text = bookingCopy('en').disclosureText(preview({ kind: 'topup', priceIsk: null }));
    expect(text).toBe(lookup('consent.disclosure.topup', 'en').replace('{price}', lookup('consent.disclosure.extra_charge', 'en')));
    expect(text).not.toMatch(/\ba ISK/);
  });

  it('a group itemises the own spot, the guests and the total; a mixed party per band', () => {
    const copy = bookingCopy('en');
    const same = preview({
      priceIsk: 14_700,
      surchargeReason: 'premium_subscriber_visit',
      breakdown: { participants: 3, ownAmountIsk: 4_900, guestUnitIsk: 4_900, guestCount: 2, guests: null },
    });
    expect(copy.disclosureText(same).split('\n')).toEqual([
      'Your spot: ISK 4,900 surcharge — uses 1 of your monthly visits.',
      '2 guest(s) × ISK 4,900 each at the member price.',
      'Total ISK 14,700 — charged to your card when you confirm. Everyone is admitted together on your check-in.',
    ]);
    const mixed = preview({
      priceIsk: 12_800,
      surchargeReason: 'premium_out_of_visits',
      breakdown: {
        participants: 3,
        ownAmountIsk: 4_900,
        guestUnitIsk: 3_950,
        guestCount: 2,
        guests: [
          { band: 'adult', count: 1, unitIsk: 4_900 },
          { band: 'child', count: 1, unitIsk: 3_000 },
        ],
      },
    });
    const lines = copy.disclosureText(mixed).split('\n');
    expect(lines[0]).toBe(fill('consent.group_own_oov', 'en', 'ISK 4,900'));
    expect(lines.slice(1, 3)).toEqual(['1 × Adult at ISK 4,900 each.', '1 × Child at ISK 3,000 each.']);
    expect(lines.join(' ')).not.toContain('3,950');
  });
});

describe('the consent', () => {
  const offer = (amountIsk: number, kind = 'surcharge') => ({ kind, amountIsk });

  it('a surcharge asks to confirm and pay; a top-up to continue', () => {
    for (const lang of LANGS) {
      const copy = bookingCopy(lang);
      expect(copy.consentButtonLabel({ pendingOffer: offer(1_990) })).toBe(fill('consent.pay_button', lang, 'ISK 1,990'));
      expect(copy.consentButtonLabel({ pendingOffer: offer(2_790, 'topup') })).toBe(
        fill('consent.continue_button', lang, 'ISK 2,790'),
      );
    }
  });

  it('the message follows the kind and the preview reason; an out-of-visits top-up gives one reason on the line and the consent', () => {
    const p = preview({ kind: 'topup', topupReason: 'monthly_exhausted', priceIsk: 2_790, remainingMonthly: 0 });
    const context = { pendingOffer: offer(2_790, 'topup'), preview: p, offerWasReoffered: false };
    expect(bookingCopy('en').disclosureText(p)).toBe("You're out of visits this period, so this visit is ISK 2,790.");
    expect(bookingCopy('en').chargeConsentMessage(context)).toBe("You're out of visits this period. Continue for ISK 2,790?");
    expect(bookingCopy('is').disclosureText(p)).toBe('Þú hefur klárað heimsóknir tímabilsins, svo þessi heimsókn kostar ISK 2,790.');
    expect(bookingCopy('is').chargeConsentMessage(context)).toBe(
      'Þú hefur klárað heimsóknir tímabilsins. Halda áfram fyrir ISK 2,790?',
    );
    for (const lang of LANGS) {
      const line = bookingCopy(lang).disclosureText(p);
      expect(line).not.toContain('Beyond your plan');
      expect(line).not.toContain('Umfram áskriftina');
    }
    // No reason (an older server): the generic line.
    expect(bookingCopy('en').disclosureText(preview({ kind: 'topup', priceIsk: 2_790 }))).toBe(
      'Beyond your plan — this visit is ISK 2,790.',
    );
  });

  it('a boutique top-up and every surcharge reason use their own sentence; the default is the premium surcharge', () => {
    const copy = bookingCopy('en');
    expect(
      copy.chargeConsentMessage({
        pendingOffer: offer(990, 'topup'),
        preview: preview({ kind: 'topup', topupReason: 'boutique_overflow' }),
        offerWasReoffered: false,
      }),
    ).toBe(fill('consent.topup_boutique_overflow', 'en', 'ISK 990'));
    expect(
      copy.chargeConsentMessage({
        pendingOffer: offer(6_300),
        preview: preview({ surchargeReason: 'premium_no_plan' }),
        offerWasReoffered: false,
      }),
    ).toBe(fill('consent.surcharge_premium_no_plan', 'en', 'ISK 6,300'));
    expect(copy.chargeConsentMessage({ pendingOffer: offer(1_500), preview: null, offerWasReoffered: false })).toBe(
      fill('consent.surcharge', 'en', 'ISK 1,500'),
    );
  });

  it('a re-offer with a different amount says the price changed first', () => {
    for (const lang of LANGS) {
      const message = bookingCopy(lang).chargeConsentMessage({
        pendingOffer: offer(2_290),
        preview: null,
        offerWasReoffered: true,
      });
      expect(message).toBe(`${fill('consent.price_changed', lang, 'ISK 2,290')}\n\n${fill('consent.surcharge', lang, 'ISK 2,290')}`);
    }
  });

  it("a group's consent restates the composition with the offer's total", () => {
    const p = preview({
      priceIsk: 14_700,
      breakdown: { participants: 3, ownAmountIsk: 4_900, guestUnitIsk: 4_900, guestCount: 2, guests: null },
    });
    const message = bookingCopy('en').chargeConsentMessage({ pendingOffer: offer(14_900), preview: p, offerWasReoffered: false });
    expect(message.split('\n').at(-1)).toBe(fill('consent.group_total', 'en', 'ISK 14,900'));
  });
});

describe('not-bookable labels', () => {
  const now = new Date('2030-09-20T12:00:00Z');
  const klass = (fields: { canBookReason?: string | null; registrationOpensAt?: Date | null; full?: boolean }) => ({
    canBookReason: fields.canBookReason ?? null,
    registrationOpensAt: fields.registrationOpensAt ?? null,
    full: fields.full ?? false,
  });

  it('a window not yet open says when it opens, on the venue clock; a past one says closed; none says not open', () => {
    const opens = new Date('2030-09-25T14:00:00Z');
    for (const reason of ['event_not_open', 'outside_registration_window']) {
      expect(bookingCopy('en').notBookableLabel(klass({ canBookReason: reason, registrationOpensAt: opens }), now)).toBe(
        'Registration opens Wed 25 Sept, 14:00',
      );
      expect(bookingCopy('is').notBookableLabel(klass({ canBookReason: reason, registrationOpensAt: opens }), now)).toMatch(
        /^Skráning opnar mið\., 25\. sep\., 14:00$/,
      );
      expect(
        bookingCopy('en').notBookableLabel(klass({ canBookReason: reason, registrationOpensAt: new Date('2030-09-01T10:00:00Z') }), now),
      ).toBe('Registration closed');
      expect(bookingCopy('en').notBookableLabel(klass({ canBookReason: reason }), now)).toBe('Not open for registration');
    }
  });

  it('class_full is Full; anything else is Full when full, else Unavailable', () => {
    const copy = bookingCopy('en');
    expect(copy.notBookableLabel(klass({ canBookReason: 'class_full' }), now)).toBe('Full');
    expect(copy.notBookableLabel(klass({ canBookReason: 'event_passed', full: true }), now)).toBe('Full');
    expect(copy.notBookableLabel(klass({ canBookReason: 'event_passed' }), now)).toBe('Unavailable');
    expect(bookingCopy('is').notBookableLabel(klass({ canBookReason: 'class_full' }), now)).toBe('Fullt');
    expect(copy.notBookableSlotLabel({ remainingCapacity: 0 })).toBe('Full');
    expect(copy.notBookableSlotLabel({ remainingCapacity: null })).toBe('Unavailable');
  });
});

describe('booking confirmed', () => {
  it('a paid class says it is paid, a free one that check-in is free, a paid slot that the booking is paid', () => {
    for (const lang of LANGS) {
      const body = lookup('booking.confirmed_body', lang);
      expect(confirmedBody(true, true, lang)).toBe(`${body}\n\n${lookup('booking.reminder.inline_paid', lang)}`);
      expect(confirmedBody(false, true, lang)).toBe(`${body}\n\n${lookup('booking.reminder.inline', lang)}`);
      expect(confirmedBody(true, false, lang)).toBe(`${body}\n\n${lookup('booking.reminder.inline_paid_booking', lang)}`);
      expect(confirmedBody(true, true, lang)).not.toContain(lookup('booking.reminder.inline', lang));
    }
  });
});
