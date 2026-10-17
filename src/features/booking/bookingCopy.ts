/**
 * The booking confirm step's words, in a given language: the charge
 * disclosure, the consent alert and the honest "can't book this class right
 * now" labels. Port of iOS `BookingCopy` (Views/Booking/BookingConfirmComponents.swift);
 * the pay outcome and "Booking confirmed" words are F8's shared copy
 * (src/payments/payOutcomeCopy.ts), re-exported here so a booking screen has
 * one place to read from.
 *
 * Every word is a generated iOS key. Prices read "ISK 2,500" in both
 * languages (`iskPrefix`, the web's customer price), never "kr": a
 * locale-grouped "ISK 2.500" reads as two point five on an English phone.
 *
 * Pure functions of their inputs and a language, so the class sheet (CLASS-2)
 * and the tests read the same sentences the flow shows.
 */
import type { Ionicons } from '@expo/vector-icons';

import type { ActivityClass, AvailabilitySlot, BookingPreview, GroupBreakdown } from '../../api/bookings';
import { isMixedParty } from '../../api/bookings';
import type { ChargeConsentOffer } from '../../api/errors';
import { iskPrefix, translate, VenueTimeFormat, type Lang, type Params } from '../../i18n';

export {
  confirmedBody,
  payOutcomeMessage,
  payOutcomeMessageKeys,
  payOutcomeTitle,
  payOutcomeTitleKey,
  refundBodyKeys,
} from '../../payments/payOutcomeCopy';

/** What the consent alert reads: the offer, the preview it refines, and whether the price moved. */
export interface ConsentContext {
  readonly pendingOffer: ChargeConsentOffer | null;
  readonly preview: BookingPreview | null;
  readonly offerWasReoffered: boolean;
}

export type BookingIcon = keyof typeof Ionicons.glyphMap;

/** The iOS key for a guest band's name. */
export function bandLabelKey(band: string): string {
  switch (band) {
    case 'child':
      return 'booking.band_child';
    case 'infant':
      return 'booking.band_infant';
    default:
      return 'booking.band_adult';
  }
}

/** True for the reasons a class's registration window explains (muted, not red). */
export function isNotOpenReason(reason: string | null | undefined): boolean {
  return reason === 'event_not_open' || reason === 'outside_registration_window';
}

/** The booking copy in `lang` ("en" or "is"). */
export function bookingCopy(lang: Lang) {
  const t = (key: string, params?: Params) => translate(key, lang, params);

  /**
   * Guest lines for a group disclosure. A party that is all one band keeps
   * the single averaged line; a MIXED party is itemised per band, because
   * "2 guests × 4,950 each" for an adult and a child names a price neither of
   * them is charged.
   */
  function guestDisclosureLines(b: GroupBreakdown): string[] {
    if (!isMixedParty(b) || !b.guests) {
      return [t('consent.group_guests', { count: `${b.guestCount}`, price: iskPrefix(b.guestUnitIsk) })];
    }
    return b.guests.map((guest) =>
      t('consent.group_guests_band', {
        count: `${guest.count}`,
        band: t(bandLabelKey(guest.band)),
        price: iskPrefix(guest.unitIsk),
      }),
    );
  }

  /** The member's own spot in a group, by the surcharge's reason. */
  function groupOwnLine(surchargeReason: string | null | undefined, price: string): string {
    switch (surchargeReason) {
      case 'premium_out_of_visits':
        return t('consent.group_own_oov', { price });
      case 'premium_visit_kept':
        // Money only because the member CHOSE to keep the visit: the _oov
        // copy would claim they had none left.
        return t('consent.group_own_kept', { price });
      default:
        return t('consent.group_own', { price });
    }
  }

  /** The surcharge sentence for a reason (boutique ladder and premium rungs), or null for the default. */
  function surchargeReasonLine(reason: string | null | undefined, price: string): string | null {
    switch (reason) {
      case 'boutique_overflow':
        return t('consent.surcharge_boutique_overflow', { price });
      case 'boutique_access':
        return t('consent.surcharge_boutique_access', { price });
      case 'premium_out_of_visits':
        return t('consent.surcharge_premium_out_of_visits', { price });
      case 'premium_pass_visit':
        return t('consent.surcharge_premium_pass_visit', { price });
      case 'premium_subscriber_visit':
        return t('consent.surcharge_premium_subscriber_visit', { price });
      case 'premium_visit_kept':
        return t('consent.surcharge_premium_visit_kept', { price });
      case 'premium_no_plan':
        // No plan or pass visit to spend: the full one-time price, never
        // called a surcharge (owner rule, web parity).
        return t('consent.surcharge_premium_no_plan', { price });
      default:
        return null;
    }
  }

  /** The disclosure's icon by kind (Ionicons standing in for the SF Symbols). */
  function disclosureIcon(p: Pick<BookingPreview, 'kind'>): BookingIcon {
    switch (p.kind) {
      case 'free':
        return 'shield-checkmark-outline';
      case 'pass':
        return 'ticket-outline';
      default:
        return 'card-outline';
    }
  }

  /** The charge disclosure on the confirm step. */
  function disclosureText(p: BookingPreview): string {
    switch (p.kind) {
      case 'free': {
        let s = t('consent.disclosure.free');
        if (p.remainingMonthly != null) s += ` ${t('consent.disclosure.free_left', { count: `${p.remainingMonthly}` })}`;
        if (p.isLastBeforeTopUp) s += ` ${t('consent.disclosure.last_before_topup')}`;
        return s;
      }
      case 'pass':
        return t('consent.disclosure.pass');
      case 'topup': {
        // Boutique top-ups get truthful reason-specific copy (the generic
        // "beyond your plan" misdescribes them).
        const price = p.priceIsk != null ? iskPrefix(p.priceIsk) : t('consent.disclosure.extra_charge');
        switch (p.topupReason) {
          case 'boutique_overflow':
            return t('consent.topup_boutique_overflow', { price });
          case 'boutique_not_included':
            return t('consent.topup_boutique_not_included', { price });
          case 'monthly_exhausted':
            // An included venue with this period's visits used up: the same
            // reason the consent gives, never "beyond your plan".
            return t('consent.disclosure.topup_monthly_exhausted', { price });
          default:
            return t('consent.disclosure.topup', { price });
        }
      }
      default: {
        // Surcharge. A group itemises the composition: the member's own spot
        // at solo pricing, each guest, and the total the confirm charges.
        if (p.breakdown && p.priceIsk != null) {
          const own = groupOwnLine(p.surchargeReason, iskPrefix(p.breakdown.ownAmountIsk));
          const total = t('consent.group_total', { price: iskPrefix(p.priceIsk) });
          return [own, ...guestDisclosureLines(p.breakdown), total].join('\n');
        }
        const price = p.priceIsk != null ? iskPrefix(p.priceIsk) : t('consent.disclosure.extra_charge');
        return surchargeReasonLine(p.surchargeReason, price) ?? t('consent.disclosure.surcharge', { price });
      }
    }
  }

  /**
   * The consent alert's message, by the offer's kind (and the preview's
   * reasons), with a price-changed note first when a second 402 moved the
   * amount.
   */
  function chargeConsentMessage(context: ConsentContext): string {
    const price = iskPrefix(context.pendingOffer?.amountIsk ?? 0);
    let message: string;
    if (context.pendingOffer?.kind === 'topup') {
      switch (context.preview?.topupReason) {
        case 'boutique_overflow':
          message = t('consent.topup_boutique_overflow', { price });
          break;
        case 'boutique_not_included':
          message = t('consent.topup_boutique_not_included', { price });
          break;
        default:
          message = t('consent.topup', { price });
      }
    } else if (context.preview?.breakdown) {
      // A group's consent: the offer is the GROUP total; restate the
      // composition so the member consents to exactly what was itemised.
      const b = context.preview.breakdown;
      message = [
        groupOwnLine(context.preview.surchargeReason, iskPrefix(b.ownAmountIsk)),
        ...guestDisclosureLines(b),
        t('consent.group_total', { price }),
      ].join('\n');
    } else {
      message = surchargeReasonLine(context.preview?.surchargeReason, price) ?? t('consent.surcharge', { price });
    }
    if (context.offerWasReoffered) message = `${t('consent.price_changed', { price })}\n\n${message}`;
    return message;
  }

  /** "Confirm and pay {price}" for a surcharge, "Continue for {price}" for a top-up. */
  function consentButtonLabel(context: Pick<ConsentContext, 'pendingOffer'>): string {
    const price = iskPrefix(context.pendingOffer?.amountIsk ?? 0);
    return context.pendingOffer?.kind === 'topup'
      ? t('consent.continue_button', { price })
      : t('consent.pay_button', { price });
  }

  /**
   * Honest copy for a class that can't be booked right now: a registration
   * window that hasn't opened must never read as "no longer bookable".
   */
  function notBookableLabel(
    klass: Pick<ActivityClass, 'canBookReason' | 'registrationOpensAt' | 'full'>,
    now: Date = new Date(),
  ): string {
    switch (klass.canBookReason) {
      case 'event_not_open':
      case 'outside_registration_window': {
        // "Opens {time}" only for a future instant; a past one means the
        // window already closed again.
        const opens = klass.registrationOpensAt;
        if (opens) {
          if (opens.getTime() > now.getTime()) {
            return t('booking.class.opens_at', { time: VenueTimeFormat.dayTime(opens, lang) });
          }
          return t('booking.class.registration_closed');
        }
        return t('booking.class.not_open_yet');
      }
      case 'class_full':
        return t('booking.full');
      default:
        return klass.full ? t('booking.full') : t('booking.class.unavailable');
    }
  }

  /** The same for a first-party slot: no spots left is "Full", any other closed slot "Unavailable". */
  function notBookableSlotLabel(slot: Pick<AvailabilitySlot, 'remainingCapacity'>): string {
    return slot.remainingCapacity === 0 ? t('booking.full') : t('booking.class.unavailable');
  }

  return {
    guestDisclosureLines,
    disclosureIcon,
    disclosureText,
    chargeConsentMessage,
    consentButtonLabel,
    notBookableLabel,
    notBookableSlotLabel,
  };
}

export type BookingCopy = ReturnType<typeof bookingCopy>;
