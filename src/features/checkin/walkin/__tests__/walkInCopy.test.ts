/**
 * The walk-in's words: every consent reason in English and Icelandic, the
 * guest split, the price-changed note, the buttons, and the scanner's
 * refusals (the check-in half of iOS MemberRefusalTests: blocking reasons,
 * `confirmRefusal`, the declined card, the earlier payment, a status with no
 * problem body).
 */
import { HttpStatusError, ProblemError, TransportError, type ChargeConsentOffer } from '../../../../api';
import { lookup, setCurrentLanguage, translate, type Lang } from '../../../../i18n';
import {
  consentGuestAmountIsk,
  consentOwnAmountIsk,
  walkInConsentButtonLabel,
  walkInConsentMessage,
  walkInConsentTitle,
  walkInOfferIsDropIn,
  type ConsentContext,
} from '../consentCopy';
import { blockingRefusal, confirmRefusal, WALK_IN_BLOCKING_REASONS } from '../refusals';

function problem(status: number, slug: string, extra: Record<string, unknown> = {}): ProblemError {
  return new ProblemError(
    { type: `https://lifepass.is/problems/${slug}`, title: slug, status, detail: `Server detail for ${slug}.`, ...extra },
    status,
  );
}

function context(overrides: Partial<ConsentContext> & { offer: ChargeConsentOffer | null }): ConsentContext {
  return {
    chargeReason: null,
    reoffered: false,
    guestCountTotal: 0,
    guestTotalIsk: 0,
    venueName: 'Sundhöllin',
    ...overrides,
  };
}

const LANGS: Lang[] = ['en', 'is'];

describe('consent', () => {
  /** Each reason reads its own sentence, with the member's own price in it. */
  const REASONS: [kind: string, reason: string | null, key: string][] = [
    ['surcharge', null, 'consent.surcharge'],
    ['surcharge', 'boutique_overflow', 'consent.surcharge_boutique_overflow'],
    ['surcharge', 'boutique_access', 'consent.surcharge_boutique_access'],
    ['surcharge', 'boutique_surcharge', 'consent.surcharge_boutique'],
    ['surcharge', 'premium_out_of_visits', 'consent.surcharge_premium_out_of_visits'],
    ['surcharge', 'premium_pass_visit', 'consent.surcharge_premium_pass_visit'],
    ['surcharge', 'premium_subscriber_visit', 'consent.surcharge_premium_subscriber_visit'],
    ['surcharge', 'a_reason_from_the_future', 'consent.surcharge'],
    ['topup', 'boutique_overflow', 'consent.topup_boutique_overflow'],
    ['topup', 'boutique_not_included', 'consent.topup_boutique_not_included'],
  ];

  it.each(LANGS)('every reason has its own sentence (%s)', (lang) => {
    for (const [kind, reason, key] of REASONS) {
      const message = walkInConsentMessage(context({ offer: { kind, amountIsk: 1990 }, chargeReason: reason }), lang);
      expect(message).toBe(translate(key, lang, { price: 'ISK 1,990' }));
      expect(message).not.toBe(key);
    }
  });

  it.each(LANGS)('the monthly drop-in names the venue, with its own title and button (%s)', (lang) => {
    const drop = context({ offer: { kind: 'topup', amountIsk: 1990 }, chargeReason: 'monthly_exhausted' });
    expect(walkInOfferIsDropIn(drop)).toBe(true);
    expect(walkInConsentMessage(drop, lang)).toBe(
      translate('consent.dropin', lang, { venue: 'Sundhöllin', price: 'ISK 1,990' }),
    );
    expect(walkInConsentTitle(drop, lang)).toBe(lookup('consent.dropin_title', lang));
    expect(walkInConsentButtonLabel(drop, lang)).toBe(translate('consent.dropin_button', lang, { price: 'ISK 1,990' }));
    // Without the venue in hand, the plain top-up sentence.
    expect(walkInConsentMessage({ ...drop, venueName: null }, lang)).toBe(
      translate('consent.topup', lang, { price: 'ISK 1,990' }),
    );
  });

  it('a boutique top-up is not the drop-in: the plain title and Continue', () => {
    const boutique = context({ offer: { kind: 'topup', amountIsk: 2490 }, chargeReason: 'boutique_overflow' });
    expect(walkInOfferIsDropIn(boutique)).toBe(false);
    expect(walkInConsentTitle(boutique, 'en')).toBe('Confirm charge');
    expect(walkInConsentButtonLabel(boutique, 'en')).toBe('Continue for ISK 2,490');
    expect(walkInConsentButtonLabel(boutique, 'is')).toBe('Halda áfram fyrir ISK 2,490');
  });

  it('a surcharge pays with the total', () => {
    const premium = context({ offer: { kind: 'surcharge', amountIsk: 1500 } });
    expect(walkInConsentTitle(premium, 'is')).toBe('Staðfesta greiðslu');
    expect(walkInConsentButtonLabel(premium, 'en')).toBe('Confirm and pay ISK 1,500');
    expect(walkInConsentButtonLabel(premium, 'is')).toBe('Staðfesta og greiða ISK 1,500');
  });

  it.each(LANGS)('guests are named apart from the own price (%s)', (lang) => {
    const party = context({
      offer: { kind: 'surcharge', amountIsk: 1500 + 2650 },
      guestCountTotal: 1,
      guestTotalIsk: 2650,
    });
    expect(consentOwnAmountIsk(party)).toBe(1500);
    expect(consentGuestAmountIsk(party)).toBe(2650);
    expect(walkInConsentMessage(party, lang)).toBe(
      `${translate('consent.surcharge', lang, { price: 'ISK 1,500' })}\n\n${translate('consent.guests_extra', lang, {
        guests: 'ISK 2,650',
        total: 'ISK 4,150',
      })}`,
    );
  });

  it.each(LANGS)('a charge only for guests says the own visit has no charge (%s)', (lang) => {
    const guestsOnly = context({ offer: { kind: 'topup', amountIsk: 2650 }, guestCountTotal: 1, guestTotalIsk: 2650 });
    expect(walkInOfferIsDropIn(guestsOnly)).toBe(false);
    expect(walkInConsentMessage(guestsOnly, lang)).toBe(translate('consent.guests_only', lang, { price: 'ISK 2,650' }));
    expect(walkInConsentTitle(guestsOnly, lang)).toBe(lookup('consent.title', lang));
  });

  it.each(LANGS)('a moved price says so first (%s)', (lang) => {
    const moved = context({ offer: { kind: 'surcharge', amountIsk: 1800 }, reoffered: true });
    expect(walkInConsentMessage(moved, lang)).toBe(
      `${translate('consent.price_changed', lang, { price: 'ISK 1,800' })}\n\n${translate('consent.surcharge', lang, {
        price: 'ISK 1,800',
      })}`,
    );
  });

  it("the server's split wins over the guest sheet's prices", () => {
    const split = context({
      offer: { kind: 'surcharge', amountIsk: 4000, party: { ownAmountIsk: 1500, guests: [] } },
      guestCountTotal: 1,
      guestTotalIsk: 2650,
    });
    expect(consentGuestAmountIsk(split)).toBe(2500);
    expect(consentOwnAmountIsk(split)).toBe(1500);
  });

  it('nothing pending reads as zero', () => {
    const none = context({ offer: null });
    expect(consentGuestAmountIsk(none)).toBe(0);
    expect(consentOwnAmountIsk(none)).toBe(0);
  });
});

describe('the scanner refusals', () => {
  it.each(LANGS)('every walk-in blocking reason has its own words and step (%s)', (lang) => {
    setCurrentLanguage(lang);
    const seen = new Set<string>();
    for (const reason of WALK_IN_BLOCKING_REASONS) {
      const refusal = blockingRefusal(reason);
      expect(refusal.message).not.toBe(translate('checkin.err.unavailable', lang));
      expect(refusal.message).not.toContain('_');
      seen.add(refusal.message);
    }
    expect(seen.size).toBe(WALK_IN_BLOCKING_REASONS.length); // one sentence per reason
    expect(blockingRefusal('daily_use_cap_reached').message).toBe(translate('checkin.err.daily_cap', lang));
    setCurrentLanguage('en');
  });

  it('the steps a blocked preview offers', () => {
    const spent = blockingRefusal('trial_visits_spent');
    expect(spent.message).toBe(translate('refusal.trial_spent', 'en'));
    expect(spent.cta).toBe('seePlans');
    expect(blockingRefusal('walk_ins_not_allowed').cta).toBe('bookATime');
    expect(blockingRefusal('no_active_plan_or_pass').cta).toBe('seePlans');
    // A reason this build has never heard of keeps 2.5.4's sentence.
    expect(blockingRefusal('some_new_reason')).toEqual({ message: translate('checkin.err.unavailable', 'en'), cta: null });
    expect(blockingRefusal(null).cta).toBeNull();
  });

  it("the confirm's refusal keeps its check-in words", () => {
    const throttled = confirmRefusal(problem(429, 'rate_limited'));
    expect(throttled.message).toBe(translate('checkin.err.rate_limited', 'en'));
    expect(throttled.cta).toBe('tryAgain');
    const unknownThrottle = confirmRefusal(problem(429, 'scan_throttle_v2'));
    expect(unknownThrottle).toEqual({ message: translate('checkin.err.rate_limited', 'en'), cta: 'tryAgain' });
    const unpriced = confirmRefusal(problem(409, 'topup_price_unset'), 'boutique_not_included');
    expect(unpriced).toEqual({ message: translate('booking.err.boutique', 'en'), cta: 'seePlans' });
    expect(confirmRefusal(problem(409, 'topup_price_invalid'))).toEqual({
      message: translate('checkin.err.monthly_cap', 'en'),
      cta: 'seePlans',
    });
    expect(confirmRefusal(problem(409, 'check_in_voided')).message).toBe(translate('refusal.voided', 'en'));
    expect(confirmRefusal(new TransportError('offline')).cta).toBeNull();
  });

  it('a declined card reads the same at the door, with Try again', () => {
    for (const code of ['topup_charge_failed', 'surcharge_charge_failed', 'charge_capture_failed']) {
      expect(confirmRefusal(problem(402, code))).toEqual({
        message: translate('refusal.payment_failed', 'en'),
        cta: 'tryAgain',
      });
    }
  });

  it('an earlier payment at the door points to support', () => {
    expect(confirmRefusal(problem(409, 'walk_in_capture_unresolved'))).toEqual({
      message: translate('refusal.earlier_payment', 'en'),
      cta: 'contactSupport',
    });
  });

  it('a status with no problem body is our failure, with no step (it may still have gone through)', () => {
    const scan = confirmRefusal(new HttpStatusError(504, '<html>'));
    expect(scan.message).toBe(translate('error.server', 'en'));
    expect(scan.cta).toBeNull();
  });

  it("the server's words never reach the member", () => {
    for (const code of ['walk_ins_not_allowed', 'brand_new_code', 'daily_use_cap_reached']) {
      expect(confirmRefusal(problem(409, code)).message).not.toContain('Server detail');
    }
  });
});
