/**
 * Employer co-pay (company plans), `/company-plans/*`: the Android port of the
 * company-plan half of iOS `SubscriptionService` (Services/SubscriptionService.swift).
 *
 * The model (monorepo docs/10_COPAY_COMPANY_PLANS.md): an employer subsidises
 * part of a membership and the member pays the remaining monthly share,
 * charged to a card saved on Kling's hosted page. The member's only choice is
 * to accept the package the employer set up.
 *
 * - `GET /company-plans/context`: an unclaimed invitation (claimed only inside
 *   the Kenni verification callback, so its call to action is "verify your
 *   identity") and/or a co-pay membership waiting for the member to accept it.
 * - `POST /company-plans/activate`: accept it. A FRESH Idempotency-Key per tap:
 *   reusing one would replay a Kling URL that may be dead by now.
 * - `POST /company-plans/retry-payment`: self-cure a past-due co-pay share.
 *   ONE key per dunning episode (`retryEpisodeKey`), the opposite rule: a
 *   re-tap must replay the SAME payable Kling session, never mint a second
 *   one the member could pay beside the first.
 *
 * Decoding follows iOS's `Decodable` types: every member iOS requires is
 * required here, and a body that does not decode fails the call (the client
 * turns the throw into a `DecodingError`), so a malformed context reads as a
 * failed read (Account's web-dashboard fallback row), never as a half-shown
 * banner.
 */
import { apiGet, apiPost } from '../../api/client';
import { newIdempotencyKey } from '../../api/idempotency';
import { toWireDate, wireId } from '../../api/wire';
import { MerchantInfo } from '../../config/merchantInfo';

/** A shape the decoders refuse; the API client turns it into `DecodingError`. */
export class CompanyPlanShapeError extends Error {
  constructor(readonly path: string) {
    super(`unexpected company-plan shape at ${path}`);
    this.name = 'CompanyPlanShapeError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Json = Record<string, unknown>;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CompanyPlanShapeError(path);
  return value as Json;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new CompanyPlanShapeError(path);
  return value;
}

/** Swift `String?`: absent or null is null; any other non-string fails. */
function optionalString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return string(value, path);
}

/** Swift `Int`: a whole number, nothing else. */
function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new CompanyPlanShapeError(path);
  return value;
}

function optionalInteger(value: unknown, path: string): number | null {
  if (value === null || value === undefined) return null;
  return integer(value, path);
}

/** Swift `UUID`, as the wire writes it (lower case). */
function uuid(value: unknown, path: string): string {
  const raw = string(value, path);
  if (!UUID.test(raw)) throw new CompanyPlanShapeError(path);
  return wireId(raw);
}

// MARK: - Context (GET /company-plans/context)

/** An employer invitation addressed to the member that is not claimed yet. */
export interface PendingInvite {
  readonly companyName: string;
}

/** A co-pay membership waiting for the member to accept it (iOS `PendingActivation`). */
export interface PendingActivation {
  /** Lower case, as the wire writes it. */
  readonly membershipId: string;
  readonly companyName: string;
  readonly productSlug: string;
  readonly productName: string;
  /** The plan's full monthly price. */
  readonly memberPriceIsk: number;
  /** The employer's monthly contribution. */
  readonly subsidyIsk: number;
  /**
   * The member's monthly share, `max(0, price - subsidy)`. Zero means the
   * subsidy covers it all and activation provisions at once, with no card.
   */
  readonly shareIsk: number;
  /** `existing_subscription` when a live personal plan blocks activation until it ends; else null. */
  readonly blocked: string | null;
}

export interface CompanyPlanContext {
  readonly pendingInvite: PendingInvite | null;
  readonly pendingActivation: PendingActivation | null;
}

function decodePendingInvite(value: unknown): PendingInvite | null {
  if (value === null || value === undefined) return null;
  const raw = object(value, 'pendingInvite');
  return { companyName: string(raw.companyName, 'pendingInvite.companyName') };
}

function decodePendingActivation(value: unknown): PendingActivation | null {
  if (value === null || value === undefined) return null;
  const raw = object(value, 'pendingActivation');
  const at = (key: string) => `pendingActivation.${key}`;
  return {
    membershipId: uuid(raw.membershipId, at('membershipId')),
    companyName: string(raw.companyName, at('companyName')),
    productSlug: string(raw.productSlug, at('productSlug')),
    productName: string(raw.productName, at('productName')),
    memberPriceIsk: integer(raw.memberPriceIsk, at('memberPriceIsk')),
    subsidyIsk: integer(raw.subsidyIsk, at('subsidyIsk')),
    shareIsk: integer(raw.shareIsk, at('shareIsk')),
    blocked: optionalString(raw.blocked, at('blocked')),
  };
}

/** `GET /company-plans/context`'s `data`. Both members optional, as on iOS (`{}` is "nothing to show"). */
export function decodeCompanyPlanContext(data: unknown): CompanyPlanContext {
  const raw = object(data, 'context');
  return {
    pendingInvite: decodePendingInvite(raw.pendingInvite),
    pendingActivation: decodePendingActivation(raw.pendingActivation),
  };
}

/** `GET /company-plans/context`: the member's company-plan state. */
export function fetchCompanyPlanContext(options: { signal?: AbortSignal } = {}): Promise<CompanyPlanContext> {
  return apiGet<CompanyPlanContext>('/company-plans/context', undefined, {
    signal: options.signal,
    decode: decodeCompanyPlanContext,
  });
}

// MARK: - Activate (POST /company-plans/activate)

export type CopayActivation =
  /** The subsidy covers the price: the subscription is live now and no card was taken. */
  | { readonly kind: 'provisioned' }
  /**
   * A share is due: open `checkoutUrl` (Kling takes the first share and saves
   * the card), then confirm `externalSessionId` on return. The session id is
   * optional to tolerate an older server, as on iOS.
   */
  | {
      readonly kind: 'checkout';
      readonly checkoutUrl: string;
      readonly shareIsk: number;
      readonly externalSessionId?: string;
    };

/**
 * The activation answer (iOS `CopayActivationResponse` read into
 * `CopayActivationResult`): anything but `provisioned` needs a checkout URL,
 * and a checkout without one is a response the app cannot use (iOS throws
 * `badServerResponse`), so it fails the call rather than opening nothing.
 */
export function decodeCopayActivation(data: unknown): CopayActivation {
  const raw = object(data, 'activation');
  const kind = string(raw.kind, 'kind');
  if (kind === 'provisioned') return { kind: 'provisioned' };
  const checkoutUrl = optionalString(raw.checkoutUrl, 'checkoutUrl');
  if (!checkoutUrl) throw new CompanyPlanShapeError('checkoutUrl');
  const externalSessionId = optionalString(raw.externalSessionId, 'externalSessionId');
  return {
    kind: 'checkout',
    checkoutUrl,
    shareIsk: optionalInteger(raw.shareIsk, 'shareIsk') ?? 0,
    ...(externalSessionId ? { externalSessionId } : {}),
  };
}

/**
 * The activation body. `terms` is the recurring-charge mandate the member
 * accepts, stamped with the SAME document versions every checkout sends
 * (`MerchantInfo`): the server stores them as evidence of what was agreed.
 */
export function activationBody(membershipId: string, acceptedAt: Date = new Date()) {
  return {
    membershipId: wireId(membershipId),
    terms: {
      acceptedAt: toWireDate(acceptedAt),
      privacyVersion: MerchantInfo.privacyVersion,
      termsVersion: MerchantInfo.termsVersion,
    },
  };
}

/**
 * Accepts the co-pay plan. A fresh Idempotency-Key per tap unless the caller
 * passes one (tests). Refusals the caller maps (iOS AccountView):
 * `kennitala_verification_required` (verify with Kenni first),
 * `subscription_already_exists_for_profile`, `copay_membership_not_eligible`.
 */
export function activateCompanyPlan(
  membershipId: string,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<CopayActivation> {
  return apiPost<CopayActivation>('/company-plans/activate', activationBody(membershipId), {
    idempotencyKey,
    decode: decodeCopayActivation,
  });
}

// MARK: - Dunning self-cure (POST /company-plans/retry-payment)

/** The hosted checkout for an overdue share (iOS `CopayRetryResult`). */
export interface CopayRetry {
  readonly checkoutUrl: string;
  readonly shareIsk: number;
  /** Kling's session, confirmed on return. Optional to tolerate an older server. */
  readonly externalSessionId?: string;
}

export function decodeCopayRetry(data: unknown): CopayRetry {
  const raw = object(data, 'retry');
  const externalSessionId = optionalString(raw.externalSessionId, 'externalSessionId');
  return {
    checkoutUrl: string(raw.checkoutUrl, 'checkoutUrl'),
    shareIsk: integer(raw.shareIsk, 'shareIsk'),
    ...(externalSessionId ? { externalSessionId } : {}),
  };
}

/**
 * The key of the dunning episode each past-due subscription is in, by
 * subscription id (lower case). In memory only, as on iOS (AccountView's
 * `retryIdempotencyKey`): an episode outlives the Account screen but not the
 * process, the sign-out (Account's copay register clears it) or the cure.
 */
const retryEpisodes = new Map<string, string>();

/**
 * The episode's key: minted at the first "Fix payment" and reused for every
 * re-tap until the subscription is no longer past due, so the server's
 * idempotent replay hands back the SAME Kling session (no parallel payables).
 */
export function retryEpisodeKey(subscriptionId: string): string {
  const id = wireId(subscriptionId);
  let key = retryEpisodes.get(id);
  if (!key) {
    key = newIdempotencyKey();
    retryEpisodes.set(id, key);
  }
  return key;
}

/** The subscription is cured (or gone): its next dunning starts a new episode with a new key. */
export function endRetryEpisode(subscriptionId: string): void {
  retryEpisodes.delete(wireId(subscriptionId));
}

/** Ends every episode except the one of `pastDueSubscriptionId` (null: all of them). */
export function endRetryEpisodesExcept(pastDueSubscriptionId: string | null): void {
  const keep = pastDueSubscriptionId ? wireId(pastDueSubscriptionId) : null;
  for (const id of [...retryEpisodes.keys()]) {
    if (id !== keep) retryEpisodes.delete(id);
  }
}

/** True while `subscriptionId` has an episode open (a key minted, not yet cured). */
export function hasRetryEpisode(subscriptionId: string): boolean {
  return retryEpisodes.has(wireId(subscriptionId));
}

/**
 * Self-cures a past-due CO-PAY subscription: the server mints a Kling hosted
 * checkout for the overdue share (or replays the episode's). The key defaults
 * to the episode's (`retryEpisodeKey`), never a fresh one.
 *
 * A personal (Kling-billed) past-due plan is refused with
 * `copay_subscription_not_found`: Kling's own dunning retries those, so the
 * caller says "we'll retry automatically". `copay_subscription_not_past_due`,
 * `copay_membership_not_eligible` and `copay_share_zero` mean the state moved
 * under the member: the caller re-reads instead of saying anything.
 */
export function retryCopayPayment(
  subscriptionId: string,
  idempotencyKey: string = retryEpisodeKey(subscriptionId),
): Promise<CopayRetry> {
  return apiPost<CopayRetry>(
    '/company-plans/retry-payment',
    { subscriptionId: wireId(subscriptionId) },
    { idempotencyKey, decode: decodeCopayRetry },
  );
}

/** Tests only: forget every episode. */
export function resetRetryEpisodesForTests(): void {
  retryEpisodes.clear();
}
