/* eslint lifepass/no-literal-copy: "error" */
/**
 * The walk-in's charge-consent alert: its title, message and button, from the
 * pending offer, in a given language. The Android port of
 * `CheckInViewModel.walkInConsentTitle/Message/ButtonLabel`,
 * `consentGuestAmountIsk`, `consentOwnAmountIsk` and `walkInOfferIsDropIn`
 * (ViewModels/CheckInViewModel.swift), kept apart from the store so the money
 * copy is unit-tested in both languages.
 *
 * GUESTS ARE NAMED APART (iOS 2.5.3). The reason copy speaks of the member's
 * OWN visit, so it carries the own price; the guests follow on their own line
 * with the total. A charge that is only for guests says the member's own
 * visit has no charge: before 2.5.3 a guest seat at a gym read "This is a
 * premium venue: a surcharge applies". A 402 that moved the price prefixes
 * "The price changed".
 *
 * The button always carries the TOTAL the member agrees to, so with guests on
 * a drop-in it says what the total buys ("Pay ISK 4,640 for drop-in and
 * guests"): "Buy drop-in" over that total would label the guests' share as
 * the member's own fee.
 */
import type { ChargeConsentOffer } from '../../../api';
import { iskPrefix, translate, type Lang } from '../../../i18n';

/** What the consent copy reads from the walk-in in hand. */
export interface ConsentContext {
  /** The disclosed (or re-offered) charge; null when none is pending. */
  readonly offer: ChargeConsentOffer | null;
  /**
   * The preview charge's `reason` (`monthly_exhausted`, `boutique_overflow`,
   * `premium_pass_visit`, ...), or the 402 offer's coarser one when the
   * preview had none.
   */
  readonly chargeReason: string | null;
  /** A 402 replaced the disclosed offer with a DIFFERENT amount. */
  readonly reoffered: boolean;
  /** Guests on the party, and what the guest sheet priced them at. */
  readonly guestCountTotal: number;
  readonly guestTotalIsk: number;
  /** The preview's venue name (the drop-in sentence names the venue). */
  readonly venueName: string | null;
}

/**
 * The guests' share of the consent's total: the 402 offer's own split when it
 * itemized the party (`ownAmountIsk`), else what the guest sheet priced them
 * at, capped at the total.
 */
export function consentGuestAmountIsk(context: ConsentContext): number {
  const { offer } = context;
  if (!offer) return 0;
  if (offer.party) return Math.max(0, offer.amountIsk - offer.party.ownAmountIsk);
  return context.guestCountTotal > 0 ? Math.min(offer.amountIsk, context.guestTotalIsk) : 0;
}

/** The member's own share: the total less the guests'. */
export function consentOwnAmountIsk(context: ConsentContext): number {
  return Math.max(0, (context.offer?.amountIsk ?? 0) - consentGuestAmountIsk(context));
}

/**
 * The monthly-exhausted top-up is the member drop-in offer (its own title,
 * body and button). Boutique framings are legacy pre-v2 top-up reasons and
 * keep the generic treatment; a charge that is only for guests is not a
 * drop-in (the member's own visit has no charge).
 */
export function walkInOfferIsDropIn(context: ConsentContext): boolean {
  return (
    context.offer?.kind === 'topup' &&
    context.chargeReason !== 'boutique_overflow' &&
    context.chargeReason !== 'boutique_not_included' &&
    consentOwnAmountIsk(context) > 0
  );
}

/** The alert's title. */
export function walkInConsentTitle(context: ConsentContext, lang: Lang): string {
  return translate(walkInOfferIsDropIn(context) ? 'consent.dropin_title' : 'consent.title', lang);
}

/** The reason sentence for the member's own share (`price`). */
function reasonMessage(context: ConsentContext, price: string, lang: Lang): string {
  const t = (key: string, params?: Record<string, string>) => translate(key, lang, params);
  if (context.offer?.kind === 'topup') {
    switch (context.chargeReason) {
      case 'boutique_overflow':
        return t('consent.topup_boutique_overflow', { price });
      case 'boutique_not_included':
        return t('consent.topup_boutique_not_included', { price });
      default:
        // The drop-in body names the venue; the preview is always in hand
        // when this offer shows, with the plain top-up copy as the fallback.
        return context.venueName
          ? t('consent.dropin', { venue: context.venueName, price })
          : t('consent.topup', { price });
    }
  }
  // A surcharge is premium by default; at a boutique the server's reason
  // picks the truthful framing. `boutique_surcharge` is the 402 offer's
  // coarser vocabulary (no preview reason in hand): neutral for both kinds.
  switch (context.chargeReason) {
    case 'boutique_overflow':
      return t('consent.surcharge_boutique_overflow', { price });
    case 'boutique_access':
      return t('consent.surcharge_boutique_access', { price });
    case 'boutique_surcharge':
      return t('consent.surcharge_boutique', { price });
    case 'premium_out_of_visits':
      return t('consent.surcharge_premium_out_of_visits', { price });
    case 'premium_pass_visit':
      return t('consent.surcharge_premium_pass_visit', { price });
    case 'premium_subscriber_visit':
      return t('consent.surcharge_premium_subscriber_visit', { price });
    default:
      return t('consent.surcharge', { price });
  }
}

/** The alert's message (see the file comment). */
export function walkInConsentMessage(context: ConsentContext, lang: Lang): string {
  const total = context.offer?.amountIsk ?? 0;
  const guests = consentGuestAmountIsk(context);
  const own = consentOwnAmountIsk(context);
  let message =
    guests > 0 && own === 0
      ? translate('consent.guests_only', lang, { price: iskPrefix(guests) })
      : reasonMessage(context, iskPrefix(own), lang);
  if (guests > 0 && own > 0) {
    message += `\n\n${translate('consent.guests_extra', lang, { guests: iskPrefix(guests), total: iskPrefix(total) })}`;
  }
  if (context.reoffered) {
    message = `${translate('consent.price_changed', lang, { price: iskPrefix(total) })}\n\n${message}`;
  }
  return message;
}

/** The alert's accept button, always with the total. */
export function walkInConsentButtonLabel(context: ConsentContext, lang: Lang): string {
  const price = { price: iskPrefix(context.offer?.amountIsk ?? 0) };
  if (walkInOfferIsDropIn(context)) {
    return translate(consentGuestAmountIsk(context) > 0 ? 'consent.dropin_guests_button' : 'consent.dropin_button', lang, price);
  }
  return translate(context.offer?.kind === 'topup' ? 'consent.continue_button' : 'consent.pay_button', lang, price);
}
