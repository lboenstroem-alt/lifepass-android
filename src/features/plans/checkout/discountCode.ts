/**
 * A partner discount code typed at checkout: a union's membership coupon or
 * a partner's visitor-pass code (a hotel, a tour operator). The Android port
 * of iOS `DiscountCode` (Models/DiscountCode.swift, 2.5.2). No real code is
 * written here or in the tests: the repository is public, and a working code
 * would hand anyone the discount.
 *
 * What the server does with it (`POST /payments/checkout-sessions`,
 * `promotionCode`; monorepo docs/05_MOBILE_API.md):
 * - it removes every whitespace character and uppercases the rest, then
 *   requires `[A-Z0-9_-]{1,64}` (otherwise `400 invalid-checkout-session`,
 *   field `promotionCode`);
 * - on a MEMBERSHIP it hands the code to the payment provider as a coupon. A
 *   partner's visitor-pass code is refused there with `400
 *   discount_code_not_valid_for_memberships`;
 * - on a PASS it checks the code against LifePass's partner codes, takes the
 *   partner's discount off the pass and credits the partner for the sale. A
 *   code it cannot honour is REFUSED with a `400`; the buyer is never
 *   silently charged the list price instead: `discount_code_invalid`
 *   (unknown, link-only, or a partner with no discount set),
 *   `discount_code_expired` (expired, or the partner is paused),
 *   `discount_code_not_valid_for_product` (a pass the partner discount does
 *   not cover).
 *
 * The app normalises the same way before sending, so what it checks is what
 * the server will check, and it refuses a code that cannot be well formed
 * without a request.
 */
import { isProblem, ProblemError } from '../../../api';

/** The longest code the server takes. */
export const DISCOUNT_CODE_MAX_LENGTH = 64;

/**
 * Every whitespace character, as the server's normaliser reads it: this IS
 * JavaScript's `\s` (it counts the byte-order mark, the no-break space and
 * the thin space, which iOS has to add to its own character set by hand).
 */
const WHITESPACE = /\s/g;

/** `^[A-Z0-9_-]{1,64}$`, the server's own rule. */
const WELL_FORMED = new RegExp(`^[A-Z0-9_-]{1,${DISCOUNT_CODE_MAX_LENGTH}}$`);

/**
 * The code as the server will read it: every whitespace character removed (a
 * code pasted with a trailing newline, or printed with a space in it), then
 * uppercased. Empty when nothing was typed.
 */
export function normaliseDiscountCode(raw: string): string {
  return raw.replace(WHITESPACE, '').toUpperCase();
}

/** `^[A-Z0-9_-]{1,64}$` on a normalised code (checked after normalising, as the server does). */
export function isWellFormedDiscountCode(code: string): boolean {
  return WELL_FORMED.test(code);
}

/**
 * Why a typed code can't be used. Each reads as its own line directly under
 * the code box, with the code left in the box to fix or clear.
 */
export type DiscountCodeProblem =
  /** `discount_code_invalid`: unknown, link-only, or no discount set. */
  | 'invalid'
  /** `discount_code_expired`: expired, or the partner is paused. */
  | 'expired'
  /** `discount_code_not_valid_for_product`: not for this pass. */
  | 'notValidForProduct'
  /** `discount_code_not_valid_for_memberships`: a pass code on a membership. */
  | 'notValidForMemberships'
  /**
   * Not `[A-Z0-9_-]{1,64}`: caught on the phone, before any request (and the
   * server's own `invalid-checkout-session` on that field).
   */
  | 'format';

const MESSAGE_KEYS: Readonly<Record<DiscountCodeProblem, string>> = {
  invalid: 'plans.promo.err.invalid',
  expired: 'plans.promo.err.expired',
  notValidForProduct: 'plans.promo.err.product',
  notValidForMemberships: 'plans.promo.err.memberships',
  format: 'plans.promo.err.format',
};

/** The line under the box for `problem` (a generated iOS key). */
export function discountCodeMessageKey(problem: DiscountCodeProblem): string {
  return MESSAGE_KEYS[problem];
}

/**
 * The refusal a checkout error stands for, or null when the error is about
 * something other than the code (that one stays the plans screen's ordinary
 * payment alert). Hyphenated slugs read the same (`discount-code-expired`).
 */
export function discountCodeProblemFrom(error: unknown): DiscountCodeProblem | null {
  if (isProblem(error, 'discount_code_invalid')) return 'invalid';
  if (isProblem(error, 'discount_code_expired')) return 'expired';
  if (isProblem(error, 'discount_code_not_valid_for_product')) return 'notValidForProduct';
  if (isProblem(error, 'discount_code_not_valid_for_memberships')) return 'notValidForMemberships';
  if (
    error instanceof ProblemError &&
    error.isProblem('invalid-checkout-session') &&
    (error.details.errors ?? []).some((entry) => entry.field === 'promotionCode')
  ) {
    return 'format';
  }
  return null;
}
