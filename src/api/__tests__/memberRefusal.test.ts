/**
 * Every refusal a member can meet at a booking, a check-in, a payment or a
 * cancel reads as plain EN and natural IS, with a next step where there is
 * one, and never as the server's words or its code: the port of iOS
 * `MemberRefusalTests` (2.5.5), with the same vectors.
 *
 * The cases that test a screen's own handling (BookingViewModel,
 * CheckInViewModel, BookingPaymentService, My bookings' cancel) belong to the
 * packages that port those screens; the table and the formatter they rest on
 * are tested here.
 *
 * `SERVER_REFUSAL_CODES` is generated (scripts/gen-refusal-fixture.py) from
 * the server at the 0.34.0 contract: every code the routes behind the refusal
 * call sites can raise. A code the server adds shows up here, the next time
 * the fixture is regenerated, as a failure that names it.
 */
import { setCurrentLanguage, translate, type Lang } from '../../i18n';
import { ProblemError, HttpStatusError, problemMessage, TransportError, type ProblemDetails } from '../errors';
import { errorMessage, refusalFor, refusalMessage } from '../errorFormatter';
import { gateRefusalFor } from '../gateRefusal';
import {
  ADAPTER_CODES,
  allRefusalRows,
  ctaLabelKey,
  FALLBACK_ON_PURPOSE,
  HANDLED_BY_FLOW,
  INFRA_FALLBACK,
  isKnownRefusal,
  isRequestShape,
  knownRefusalCodes,
  matchesCodePattern,
  MemberRefusal,
  normaliseRefusalCode,
  OUTSIDE_SCOPE,
  PROBLEM_KEYS,
  REFUSAL_CTAS,
  resolveRefusal,
  type RefusalContext,
  type RefusalCta,
} from '../refusals';

import { SERVER_REFUSAL_CODES, SERVER_REFUSAL_CODES_SOURCE } from './serverRefusalCodes';

const EM_DASH = '—';
const EN_DASH = '–';
const EMOJI = /\p{Emoji_Presentation}/u;
const LANGS: Lang[] = ['en', 'is'];
const CONTEXTS: RefusalContext[] = ['general', 'cancel', 'checkIn'];

function details(status: number, slug: string, reason?: string, detail?: string): ProblemDetails {
  return {
    type: `https://lifepass.is/problems/${slug}`,
    title: slug,
    status,
    detail: detail ?? `Server detail for ${slug}.`,
    reason,
  };
}

function problem(status: number, slug: string, reason?: string, detail?: string): ProblemError {
  return new ProblemError(details(status, slug, reason, detail), status);
}

const text = (key: string, lang: Lang) => translate(key, lang);

/**
 * Every key of one language's table. F1 may move the generated tables from
 * JSON to TypeScript; both places are tried.
 */
function tableKeys(lang: Lang): string[] {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const candidates: (() => unknown)[] = [
    () => require(`../../i18n/generated/${lang}`),
    () => require(`../../i18n/strings.${lang}.json`),
  ];
  /* eslint-enable @typescript-eslint/no-require-imports */
  for (const load of candidates) {
    try {
      const mod = load() as Record<string, unknown>;
      const table = (mod.default ?? mod[lang] ?? mod) as Record<string, unknown>;
      const keys = Object.keys(table).filter((k) => typeof table[k] === 'string');
      if (keys.length > 100) return keys;
    } catch {
      // try the next location
    }
  }
  throw new Error(`cannot find the ${lang} string table`);
}

describe('(a) copy', () => {
  it('every known code has its own English and Icelandic', () => {
    const fallback = { en: text('error.refusal_fallback', 'en'), is: text('error.refusal_fallback', 'is') };
    const conflict = { en: text('error.conflict', 'en'), is: text('error.conflict', 'is') };
    expect(knownRefusalCodes().length).toBeGreaterThanOrEqual(95);
    for (const { id, refusal } of allRefusalRows()) {
      const key = refusal.messageKey;
      const en = text(key, 'en');
      const ice = text(key, 'is');
      expect({ id, key, hasEnglish: en !== key }).toEqual({ id, key, hasEnglish: true });
      expect({ id, key, translated: ice !== en }).toEqual({ id, key, translated: true });
      expect(en).not.toBe(fallback.en);
      expect(ice).not.toBe(fallback.is);
      expect(en).not.toBe(conflict.en);
      expect(ice).not.toBe(conflict.is);
    }
    for (const code of knownRefusalCodes()) {
      expect([code, resolveRefusal(code, null, 409).messageKey]).not.toEqual([code, 'error.refusal_fallback']);
    }
  });

  it('no refusal string has a dash or an emoji, in either language', () => {
    const keys = new Set<string>(allRefusalRows().map((r) => r.refusal.messageKey));
    REFUSAL_CTAS.forEach((cta) => keys.add(ctaLabelKey(cta)));
    tableKeys('en')
      .filter((k) => k.startsWith('refusal.'))
      .forEach((k) => keys.add(k));
    [
      'error.refusal_fallback',
      'booking.pay.refunded_slot_body',
      'checkin.pay.refunded_slot_body',
      'booking.pay.refunded_generic_body',
      'checkin.err.unavailable',
    ].forEach((k) => keys.add(k));
    for (const key of keys) {
      for (const lang of LANGS) {
        const value = text(key, lang);
        expect({ key, lang, missing: value === key }).toEqual({ key, lang, missing: false });
        expect({ key, lang, value, dash: value.includes(EM_DASH) || value.includes(EN_DASH) }).toMatchObject({ dash: false });
        expect({ key, lang, value, emoji: EMOJI.test(value) }).toMatchObject({ emoji: false });
      }
    }
    const refusalEN = tableKeys('en').filter((k) => k.startsWith('refusal.')).sort();
    const refusalIS = tableKeys('is').filter((k) => k.startsWith('refusal.')).sort();
    expect(refusalIS).toEqual(refusalEN);
    for (const key of refusalEN) {
      expect([key, text(key, 'is') === text(key, 'en')]).toEqual([key, false]);
    }
  });
});

describe('(b) the server codes', () => {
  it('the fixture is the 0.34.0 server', () => {
    expect(SERVER_REFUSAL_CODES_SOURCE.contractVersion).toBe('0.34.0');
    expect(SERVER_REFUSAL_CODES).toHaveLength(292);
    expect(new Set(SERVER_REFUSAL_CODES).size).toBe(292);
  });

  it('every server code is accounted for', () => {
    const unaccounted = SERVER_REFUSAL_CODES.filter(
      (code) =>
        !(
          isKnownRefusal(code) ||
          ADAPTER_CODES.has(code) ||
          PROBLEM_KEYS[code] !== undefined ||
          isRequestShape(code) ||
          HANDLED_BY_FLOW.includes(code) ||
          matchesCodePattern(code, FALLBACK_ON_PURPOSE) ||
          matchesCodePattern(code, INFRA_FALLBACK) ||
          OUTSIDE_SCOPE.includes(code)
        ),
    );
    // New server codes: give each a row or a reason.
    expect(unaccounted).toEqual([]);

    // The lists don't contradict each other.
    for (const code of knownRefusalCodes()) {
      expect([code, HANDLED_BY_FLOW.includes(code)]).toEqual([code, false]);
      expect([code, matchesCodePattern(code, FALLBACK_ON_PURPOSE)]).toEqual([code, false]);
      expect([code, matchesCodePattern(code, INFRA_FALLBACK)]).toEqual([code, false]);
      expect([code, OUTSIDE_SCOPE.includes(code)]).toEqual([code, false]);
    }
    for (const code of HANDLED_BY_FLOW) {
      expect([code, matchesCodePattern(code, INFRA_FALLBACK)]).toEqual([code, false]);
    }
    // Every list entry still names something the server raises, so a code the
    // server drops does not stay "accounted" here for good.
    for (const pattern of INFRA_FALLBACK) {
      expect([pattern, SERVER_REFUSAL_CODES.some((c) => matchesCodePattern(c, [pattern]))]).toEqual([pattern, true]);
    }
  });

  it('a fallback-on-purpose code reads as the fallback, or our failure on a 5xx', () => {
    let checked = 0;
    for (const code of SERVER_REFUSAL_CODES) {
      if (!matchesCodePattern(code, [...FALLBACK_ON_PURPOSE, ...INFRA_FALLBACK])) continue;
      expect([code, resolveRefusal(code, null, 409)]).toEqual([
        code,
        { messageKey: 'error.refusal_fallback', cta: null, blocksAtPreview: false },
      ]);
      expect([code, resolveRefusal(code, null, 500)]).toEqual([
        code,
        { messageKey: 'error.server', cta: 'tryAgain', blocksAtPreview: false },
      ]);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('the codes with no row read by their kind', () => {
    const shapes = SERVER_REFUSAL_CODES.filter((c) => isRequestShape(c) && !isKnownRefusal(c));
    expect(shapes.length).toBeGreaterThan(15);
    for (const code of shapes) {
      expect([code, resolveRefusal(code, null, 400).messageKey]).toEqual([code, 'error.request_invalid']);
    }
    for (const code of SERVER_REFUSAL_CODES.filter((c) => ADAPTER_CODES.has(c))) {
      expect([code, resolveRefusal(code, null, 502).messageKey]).toEqual([code, 'refusal.venue_system']);
    }
    expect(resolveRefusal('authentication_required', null, 401).messageKey).toBe('error.sign_in');
    expect(resolveRefusal('internal_error', null, 500).messageKey).toBe('error.server');
    for (const code of [
      'customer_profile_required',
      'idempotency_key_required',
      'forbidden',
      'kling_session_not_found',
      'kling_customer_fetch_failed',
      'kling_checkout_create_failed',
      'pass_not_redeemable',
    ]) {
      expect([code, SERVER_REFUSAL_CODES.includes(code)]).toEqual([code, true]);
      expect([code, matchesCodePattern(code, INFRA_FALLBACK)]).toEqual([code, true]);
    }
  });

  it('the wildcards match what they say', () => {
    expect(matchesCodePattern('check_in_void_too_old', ['check_in_void_*'])).toBe(true);
    expect(matchesCodePattern('booking_slot_passed_not_settleable', ['booking_*_not_settleable'])).toBe(true);
    expect(matchesCodePattern('booking_not_settleable_x', ['booking_*_not_settleable'])).toBe(false);
    expect(matchesCodePattern('check_in_voided', ['check_in_void_*'])).toBe(false);
    expect(matchesCodePattern('Check-In-Void-Busy', ['check_in_void_*'])).toBe(true);
  });
});

describe('(c) normalisation', () => {
  it('hyphens and case fold to the table spelling', () => {
    expect(normaliseRefusalCode('Rate-Limited')).toBe('rate_limited');
    expect(resolveRefusal('rate-limited', null, 429).messageKey).toBe('refusal.rate_limited');
    expect(resolveRefusal('invalid-booking-create', null, 400).messageKey).toBe('error.request_invalid');
    expect(resolveRefusal('slot-unavailable', 'Class-Full', 409).messageKey).toBe('booking.class.err_full');
    expect(isKnownRefusal('TRIAL-VENUE-NOT-INCLUDED')).toBe(true);
  });
});

describe('(d) precedence', () => {
  it('a specific code outranks its status', () => {
    expect(resolveRefusal('cancel_provider_uncertain', null, 502, 'cancel').messageKey).toBe('refusal.cancel_uncertain');
    expect(resolveRefusal('cancel_provider_uncertain', null, 502).messageKey).toBe('refusal.cancel_uncertain');
    expect(resolveRefusal('slot_unavailable', 'class_full', 409).messageKey).toBe('booking.class.err_full');
    // A 502 the table names is not "something went wrong".
    expect(resolveRefusal('kling_payment_unavailable', null, 502).messageKey).toBe('refusal.payments_down');
    // A provider adapter's own code on the class route's 502.
    expect(resolveRefusal('timeout', null, 502).messageKey).toBe('refusal.venue_system');
    expect(resolveRefusal('auth_failed', null, 502).messageKey).toBe('refusal.venue_system');
    // Unknown codes fall back by status.
    expect(resolveRefusal('brand_new_refusal', null, 409).messageKey).toBe('error.refusal_fallback');
    expect(resolveRefusal('brand_new_refusal', null, 403).messageKey).toBe('error.refusal_fallback');
    expect(resolveRefusal('brand_new_refusal', null, 503).messageKey).toBe('error.server');
    expect(resolveRefusal('brand_new_refusal', null, 401).messageKey).toBe('error.sign_in');
    expect(resolveRefusal('brand_new_refusal', null, 409).cta).toBeNull();
    expect(resolveRefusal('brand_new_refusal', null, 409).blocksAtPreview).toBe(false);
    // The app's own problem copy still applies where the table is silent.
    expect(resolveRefusal('authentication_required', null, 401)).toEqual({
      messageKey: 'error.sign_in',
      cta: null,
      blocksAtPreview: false,
    });
    // Our failure offers "Try again", named or not.
    const unhandled = resolveRefusal('internal_error', null, 500);
    expect(unhandled).toEqual({ messageKey: 'error.server', cta: 'tryAgain', blocksAtPreview: false });
    expect(resolveRefusal('brand_new_refusal', null, 503).cta).toBe('tryAgain');
    expect(unhandled.cta).toBe(resolveRefusal('brand_new_refusal', null, 500).cta);
  });

  it('contexts change only their own codes', () => {
    expect(resolveRefusal('booking_not_found', null, 404).messageKey).toBe('refusal.gone');
    expect(resolveRefusal('booking_not_found', null, 404, 'cancel').messageKey).toBe('refusal.not_cancellable');
    expect(resolveRefusal('booking_charge_unresolved', null, 409, 'cancel').messageKey).toBe('refusal.cancel_pending');
    expect(resolveRefusal('booking_charge_unresolved', null, 409).messageKey).toBe('refusal.payment_unresolved');
    expect(resolveRefusal('daily_use_cap_reached', null, 403, 'checkIn').messageKey).toBe('checkin.err.daily_cap');
    expect(resolveRefusal('daily_use_cap_reached', null, 403).messageKey).toBe('booking.err.daily_cap');
    expect(resolveRefusal('trial_visits_spent', null, 403, 'checkIn').messageKey).toBe('refusal.trial_spent');
  });
});

describe('(e) never the server words', () => {
  it("the server's words never reach a member, in either language", () => {
    const serverDetails = ['Booking creation payload is invalid.', 'Kling payment service is temporarily unavailable.'];
    const statuses = [400, 403, 409, 429, 502];
    const codes = [...SERVER_REFUSAL_CODES, ...knownRefusalCodes(), 'brand_new_refusal', 'invalid_booking_create'];
    const leaks: string[] = [];
    for (const lang of LANGS) {
      setCurrentLanguage(lang);
      for (const code of codes) {
        for (const status of statuses) {
          for (const detail of serverDetails) {
            for (const context of CONTEXTS) {
              const shown = refusalMessage(problem(status, code, undefined, detail), context);
              if (shown.includes(detail)) leaks.push(`${code} ${status} (${lang}) shows the detail`);
              if (/kling/i.test(shown)) leaks.push(`${code} (${lang}) says Kling`);
              if (shown.includes(code) && code.includes('_')) leaks.push(`${code} (${lang}) shows the code`);
              if (!shown) leaks.push(`${code} (${lang}) is empty`);
            }
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it("a known code reads the same through the error's own message", () => {
    setCurrentLanguage('is');
    const error = problem(403, 'trial_venue_not_included', undefined, 'Your free trial covers gyms and studios.');
    expect(error.message).toBe(text('refusal.trial_venue', 'is'));
    expect(errorMessage(error)).toBe(text('refusal.trial_venue', 'is'));
    setCurrentLanguage('en');
    expect(errorMessage(error)).toBe(text('refusal.trial_venue', 'en'));
  });
});

describe('(f) next steps', () => {
  it('the next step is the right one', () => {
    const cta = (code: string, reason?: string) => resolveRefusal(code, reason, 409).cta;
    expect(cta('no_active_plan_or_pass')).toBe('seePlans');
    expect(cta('subscription_paused')).toBe('resumeMembership');
    expect(cta('booking_blocked')).toBe('contactSupport');
    expect(cta('slot_unavailable', 'class_full')).toBe('chooseAnotherTime');
    expect(cta('nationality_required')).toBe('addNationality');
    expect(cta('kennitala_verification_required')).toBe('verifyIdentity');
    expect(cta('account_deletion_scheduled')).toBe('cancelDeletion');
    expect(cta('subscription_already_exists_for_profile')).toBe('manageMembership');
    expect(cta('concurrent_cap_reached')).toBe('myBookings');
    expect(cta('walk_ins_not_allowed')).toBe('bookATime');
    expect(cta('age_band_unavailable')).toBe('editGuests');
    expect(resolveRefusal('booking_not_cancellable', null, 409, 'cancel').cta).toBe('refreshBookings');
    expect(cta('kling_payment_unavailable')).toBe('tryAgain');
    // Nothing to do today but wait.
    expect(cta('daily_use_cap_reached')).toBeNull();
    // A refusal never opens the pay rail.
    expect(REFUSAL_CTAS.some((step) => step.toLowerCase().includes('pay'))).toBe(false);
    // Every label exists in both languages.
    for (const step of REFUSAL_CTAS) {
      const key = ctaLabelKey(step);
      expect([step, text(key, 'en') === key]).toEqual([step, false]);
      expect([step, text(key, 'en') === text(key, 'is')]).toEqual([step, false]);
    }
    expect(MemberRefusal.webProfileUrl).toBe('https://www.lifepass.is/profile');
    expect(MemberRefusal.supportUrl).toBe('mailto:support@lifepass.is');
  });

  it('only gates block at the preview', () => {
    for (const code of [
      'trial_venue_not_included',
      'booking_blocked',
      'subscription_paused',
      'no_active_plan_or_pass',
      'slot_already_booked',
      'nationality_required',
      'visit_price_unset',
    ]) {
      expect([code, resolveRefusal(code, null, 409).blocksAtPreview]).toEqual([code, true]);
    }
    for (const code of [
      'rate_limited',
      'kling_payment_unavailable',
      'booking_charge_unresolved',
      'card_declined',
      'visit_choice_unavailable',
      'booking_create_failed',
      'brand_new_refusal',
    ]) {
      expect([code, resolveRefusal(code, null, 409).blocksAtPreview]).toEqual([code, false]);
    }
  });
});

describe('review fixes (2.5.5)', () => {
  it('a declined top-up reads like a declined surcharge', () => {
    for (const code of ['surcharge_charge_failed', 'topup_charge_failed']) {
      expect([code, resolveRefusal(code, null, 402)]).toEqual([
        code,
        { messageKey: 'refusal.payment_failed', cta: 'tryAgain', blocksAtPreview: false },
      ]);
      expect(SERVER_REFUSAL_CODES).toContain(code);
    }
    // At the door too (the scanner's context).
    expect(resolveRefusal('topup_charge_failed', null, 402, 'checkIn').messageKey).toBe('refusal.payment_failed');
  });

  it('an unset price offers no other time', () => {
    for (const code of [
      'visit_price_unset',
      'topup_price_unset',
      'surcharge_price_unset',
      'topup_price_invalid',
      'surcharge_price_invalid',
      'venue_category_unset',
    ]) {
      const refusal = resolveRefusal(code, null, 409);
      expect([code, refusal]).toEqual([code, { messageKey: 'refusal.price_unset', cta: null, blocksAtPreview: true }]);
      expect(gateRefusalFor(code)).toMatchObject({ message: text('refusal.price_unset', 'en'), cta: null });
    }
    expect(text('refusal.price_unset', 'en')).toBe("This venue hasn't set a price for this yet. Try another venue.");
    expect(text('refusal.price_unset', 'is')).toBe('Staðurinn hefur ekki enn sett verð á þetta. Prófaðu annan stað.');
  });

  it('already booked says this time', () => {
    expect(resolveRefusal('slot_already_booked', null, 409).messageKey).toBe('booking.err.slot_dup');
    expect(text('booking.err.slot_dup', 'en')).toBe('You already have a booking for this time.');
    expect(text('booking.err.slot_dup', 'is')).toBe('Þú ert nú þegar með bókun í þennan tíma.');
  });

  it('a shared resource taken at that time is a full time', () => {
    expect(resolveRefusal('activity_resource_conflict', null, 409)).toEqual({
      messageKey: 'refusal.slot_full',
      cta: 'chooseAnotherTime',
      blocksAtPreview: true,
    });
    expect(matchesCodePattern('activity_resource_conflict', FALLBACK_ON_PURPOSE)).toBe(false);
  });

  it('a party over the limit says the limit', () => {
    expect(resolveRefusal('participants_invalid', null, 400)).toEqual({
      messageKey: 'refusal.party_size',
      cta: 'editGuests',
      blocksAtPreview: true,
    });
    expect(text('refusal.party_size', 'en')).toContain('10');
    expect(text('refusal.party_size', 'is')).toContain('10');
    expect(resolveRefusal('group_booking_not_supported', null, 409).messageKey).toBe('refusal.solo_only');
  });

  it('only a listed booking points at My bookings', () => {
    for (const code of ['booking_charge_unresolved', 'booking_payment_unresolved']) {
      expect([code, resolveRefusal(code, null, 409)]).toEqual([
        code,
        { messageKey: 'refusal.payment_unresolved', cta: 'contactSupport', blocksAtPreview: false },
      ]);
    }
    for (const code of [
      'booking_pending_provider_reconciliation',
      'provider_booking_uncertain',
      'provider_confirmation_failed',
      'booking_confirmation_failed',
    ]) {
      const refusal = resolveRefusal(code, null, 502);
      expect([code, refusal.messageKey, refusal.cta]).toEqual([code, 'refusal.pending_confirm', 'myBookings']);
    }
    expect(resolveRefusal('booking_charge_unresolved', null, 409, 'cancel').messageKey).toBe('refusal.cancel_pending');
  });

  it('the reconciliation attach codes keep the fallback', () => {
    for (const code of ['booking_charge_voided', 'booking_charge_unsettled']) {
      expect(matchesCodePattern(code, FALLBACK_ON_PURPOSE)).toBe(true);
      expect(isKnownRefusal(code)).toBe(false);
      expect(resolveRefusal(code, null, 409).messageKey).toBe('error.refusal_fallback');
    }
  });

  it('a declined card reads the same at a booking and at the door', () => {
    const en = text('refusal.payment_failed', 'en');
    const ice = text('refusal.payment_failed', 'is');
    expect(en.toLowerCase()).not.toContain('booked');
    expect(en.toLowerCase()).not.toContain('another card');
    expect(en).toContain('nothing was charged');
    expect(en).toContain('profile');
    expect(ice).not.toContain('bókað');
    expect(ice).not.toContain('annað kort');
    expect(ice).toContain('ekkert var rukkað');
    expect(ice).toContain('prófíl');
    // The card is changed under Profile.
    expect(text('account.title', 'en')).toBe('Profile');
    expect(text('account.title', 'is')).toBe('Prófíll');
    for (const code of ['topup_charge_failed', 'surcharge_charge_failed', 'charge_capture_failed']) {
      const refusal = refusalFor(problem(402, code), 'checkIn');
      expect([code, refusal?.messageKey, refusal?.cta]).toEqual([code, 'refusal.payment_failed', 'tryAgain']);
    }
  });

  it('an earlier payment at the door holds for both its cases', () => {
    const en = text('refusal.earlier_payment', 'en');
    const ice = text('refusal.earlier_payment', 'is');
    expect(en.startsWith('Scan') || en.includes('. Scan the code again')).toBe(false);
    expect(en).toContain("can't charge you again yet");
    expect(en).toContain("If scanning again doesn't work");
    expect(en.includes('front desk') && en.includes('support')).toBe(true);
    expect(ice).toContain('Ef það gengur ekki að skanna aftur');
    expect(ice.includes('afgreiðslunni') && ice.includes('þjónustuver')).toBe(true);
    const refusal = refusalFor(problem(409, 'walk_in_capture_unresolved'), 'checkIn');
    expect(refusal).toEqual({ messageKey: 'refusal.earlier_payment', cta: 'contactSupport', blocksAtPreview: false });
  });

  it('a status with no problem body never shows its code', () => {
    for (const lang of LANGS) {
      setCurrentLanguage(lang);
      for (const status of [500, 501, 502, 503, 504]) {
        const error = new HttpStatusError(status, `<html>${status}</html>`);
        for (const context of CONTEXTS) {
          const shown = refusalMessage(error, context);
          expect([status, lang, shown]).toEqual([status, lang, text('error.server', lang)]);
          expect(shown.includes(String(status)) || shown.includes('HTTP')).toBe(false);
        }
      }
      for (const status of [0, 400, 404, 409, 413]) {
        const error = new HttpStatusError(status, '<html></html>');
        expect([status, lang, refusalMessage(error)]).toEqual([status, lang, text('error.refusal_fallback', lang)]);
      }
    }
    // Still not a table row, so a screen's own handling decides its step.
    expect(refusalFor(new HttpStatusError(504, ''))).toBeNull();
    // Outside the refusal call sites nothing changed.
    setCurrentLanguage('en');
    expect(errorMessage(new HttpStatusError(504, ''))).toBe(
      translate('error.unexpected_status', 'en', { code: '504' }),
    );
  });

  it("the slot timetable's codes are accounted for", () => {
    for (const code of [
      'availability_not_implemented_for_provider',
      'availability_range_too_wide',
      'invalid_availability_query',
      'invalid_availability_range',
    ]) {
      expect(SERVER_REFUSAL_CODES).toContain(code);
    }
    expect(matchesCodePattern('availability_not_implemented_for_provider', INFRA_FALLBACK)).toBe(true);
    expect(matchesCodePattern('availability_range_too_wide', INFRA_FALLBACK)).toBe(true);
    expect(resolveRefusal('availability_not_implemented_for_provider', null, 501).messageKey).toBe('error.server');
    expect(resolveRefusal('availability-range-too-wide', null, 400).messageKey).toBe('error.refusal_fallback');
    expect(resolveRefusal('invalid-availability-range', null, 400).messageKey).toBe('error.request_invalid');
  });
});

describe('(g) slot_unavailable and classes', () => {
  it('a time that went away gets its own words', () => {
    expect(resolveRefusal('slot_unavailable', null, 409).messageKey).toBe('refusal.slot_gone');
    expect(resolveRefusal('slot_unavailable', 'some_new_reason', 409).messageKey).toBe('refusal.slot_gone');
    expect(resolveRefusal('slot_unavailable', 'outside_registration_window', 409).messageKey).toBe(
      'booking.class.err_not_open',
    );
    expect(resolveRefusal('slot_unavailable', 'event_passed', 409).messageKey).toBe('booking.class.err_passed');
    // The provider's refusal of a paid class: this 409 with that reason.
    const payable = resolveRefusal('slot_unavailable', 'payable_class_not_supported', 409);
    expect(payable).toEqual({ messageKey: 'refusal.class_not_bookable', cta: null, blocksAtPreview: true });
    expect(isKnownRefusal('payable_class_not_supported')).toBe(false);
  });
});

describe('(h) other screens keep their behaviour', () => {
  it('an unmapped slug elsewhere keeps its message', () => {
    const coach = details(429, 'coach-free-limit', undefined, 'You have used your 3 free Coach messages.');
    // An English reader still gets the detail ...
    expect(problemMessage(coach, 'en')).toBe('You have used your 3 free Coach messages.');
    // ... an Icelandic reader the status's sentence.
    expect(problemMessage(coach, 'is')).toBe(text('error.rate_limited', 'is'));
    expect(isKnownRefusal('coach-free-limit')).toBe(false);
    setCurrentLanguage('en');
    expect(problem(429, 'meal-scan-daily-limit', undefined, 'Daily limit.').message).toBe('Daily limit.');
    // The app's own problem copy keeps winning on every screen.
    expect(problem(429, 'rate_limited').message).toBe(text('error.rate_limited', 'en'));
    expect(problem(404, 'product_not_on_sale').message).toBe(text('plans.err.not_on_sale', 'en'));
  });
});

describe('(i) not a problem', () => {
  it('offline reads as offline at a refusal call site', () => {
    setCurrentLanguage('en');
    expect(refusalMessage(new TransportError('offline'))).toBe(text('error.offline', 'en'));
    expect(refusalFor(new TransportError('offline'))).toBeNull();
  });

  it('the table under its iOS names', () => {
    expect(MemberRefusal.resolve('no_active_plan_or_pass', null, 403)).toEqual(
      resolveRefusal('no_active_plan_or_pass', null, 403),
    );
    expect(MemberRefusal.isKnown('slot_full')).toBe(true);
    const steps: readonly RefusalCta[] = REFUSAL_CTAS;
    expect(steps).toHaveLength(14);
  });
});
