/**
 * Who sells LifePass, and which legal texts a purchase is agreed under: the
 * Android port of iOS `MerchantInfo` (Config/MerchantInfo.swift).
 *
 * Icelandic and EU webshop rules require the payment confirmation to name the
 * merchant (legal name, address, contact), the currency, the terms of sale and
 * the privacy policy. Every checkout surface reads these values from here
 * rather than writing its own, so one edit reaches all of them.
 *
 * THE VERSIONS ARE DISPUTE EVIDENCE. `termsVersion` and `privacyVersion` are
 * stamped on every checkout session and co-pay activation
 * (`terms.termsVersion` / `terms.privacyVersion` on
 * `POST /payments/checkout-sessions` and `POST /company-plans/activate`) and
 * stored on the `terms_acceptances` row, so the server can later prove which
 * document a member agreed to. They must equal what lifepass.is serves
 * (`apps/web/src/lib/legal-versions.ts`) and what iOS stamps. The server
 * stores the string as given and checks it against nothing, so before every
 * Android release check that lifepass.is/terms and lifepass.is/privacy show
 * these versions.
 *
 * - Terms 2026-09-v6: the Terms of the health release (the workout plan, the
 *   food log, wearable data, for active members only). Every version since
 *   2026-07-v1 keeps the card-on-file mandate.
 * - Privacy 2026-09-v12: adds the monthly feedback (the stored report and
 *   note, the safety switch, and that food and weight are in it only with a
 *   Coach plan or once the member switches them on).
 */

export const MerchantInfo = {
  /** Full legal entity name, as in the company registry. */
  legalName: 'Sporta ehf.',
  /** The company's registration number (kennitala), public in the registry. */
  kennitala: '580524-0660',
  streetAddress: 'Hverfisgata 88',
  cityLine: '101 Reykjavík, Iceland',
  /** Full address on one line (receipts). */
  fullAddress: 'Hverfisgata 88, 101 Reykjavík, Iceland',
  /** Customer support (used in the confirm-timeout copy and the receipts contact). */
  email: 'Contact@sport-a.com',
  /** Terms of sale and cancellation policy: one document covers both. */
  termsURL: 'https://lifepass.is/terms',
  privacyURL: 'https://lifepass.is/privacy',
  /** The web account page, where the same deletion control lives (the in-app sheet is ACCT-4's). */
  accountDeletionURL: 'https://www.lifepass.is/profile',
  /** Transaction currency (ISO 4217). */
  currency: 'ISK',
  /**
   * In-app hosted checkout (true) or the web-first fallback
   * (`webCheckoutURL`). An initial purchase is fulfilled by a verified pull
   * on return (`POST /payments/checkout-sessions/confirm`); false is the
   * escape hatch if the in-app rail ever has to be switched off.
   */
  inAppKlingCheckout: true,
  /** Terms version stamped with every checkout and co-pay activation. */
  termsVersion: '2026-09-v6',
  /** Privacy policy version stamped beside it. */
  privacyVersion: '2026-09-v12',
} as const;

/**
 * The web plans page with the app's product preselected, for the web-first
 * fallback checkout. A partner discount code (already normalised) rides as
 * `?promo=` only when there is one.
 */
export function webCheckoutURL(productSlug: string, promotionCode?: string | null): string {
  let url = `https://www.lifepass.is/plans?completePurchase=${encodeURIComponent(productSlug)}`;
  if (promotionCode) url += `&promo=${encodeURIComponent(promotionCode)}`;
  return url;
}
