/**
 * Refer a friend, `GET /referrals/me`: the Android port of iOS
 * `ProfileService.fetchReferral()` and `ReferralInfo`
 * (Services/ProfileService.swift).
 *
 * The server mints the member's personal code on the first call (a read with
 * one possible write) and owns every reward rule: a friend who buys their
 * first package earns the member a free visit. The app only shows the link
 * and the counts.
 *
 * Read strictly, as the Swift `Decodable` does: all four members are
 * required and the counts are whole numbers, so a shape the app does not
 * understand fails the read and the Account row stays hidden (the row is
 * best-effort; see `shareableReferralLink`).
 */
import { API_TIMEOUTS, apiGet } from './client';

export interface ReferralInfo {
  readonly code: string;
  /** The shareable sign-up link carrying the code. */
  readonly link: string;
  /** Friends whose sign-up was attributed to this member (they may not have bought yet). */
  readonly referredCount: number;
  /** Free visits earned: one per referred friend who completed a purchase. */
  readonly rewardsEarned: number;
}

/** A shape the decoder refuses; the API client turns it into `DecodingError`. */
export class ReferralShapeError extends Error {
  constructor(readonly path: string) {
    super(`unexpected referral shape at ${path}`);
    this.name = 'ReferralShapeError';
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new ReferralShapeError(path);
  return value;
}

/** Swift's `Int`: a JSON number with no fraction. */
function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new ReferralShapeError(path);
  return value;
}

/** `GET /referrals/me`'s `data`, read strictly. */
export function decodeReferral(data: unknown): ReferralInfo {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new ReferralShapeError('referral');
  const raw = data as Record<string, unknown>;
  return {
    code: string(raw.code, 'code'),
    link: string(raw.link, 'link'),
    referredCount: integer(raw.referredCount, 'referredCount'),
    rewardsEarned: integer(raw.rewardsEarned, 'rewardsEarned'),
  };
}

/**
 * `GET /referrals/me`. Best-effort at the call site: an older server without
 * the route, or any failure, just means no referral row. Shares the profile
 * rail's 60 second patience (iOS `ProfileService.requestTimeout`).
 */
export function fetchReferral(options: { signal?: AbortSignal } = {}): Promise<ReferralInfo> {
  return apiGet<ReferralInfo>('/referrals/me', undefined, {
    timeoutMs: API_TIMEOUTS.profile,
    signal: options.signal,
    decode: decodeReferral,
  });
}

const WEB_LINK = /^https?:\/\/[^\s/?#]+\.[^\s/?#]+[^\s]*$/i;

/**
 * The link the share sheet carries, or null when there is no real URL to
 * share. iOS renders the row only once `URL(string: referral.link)` parses,
 * "so the share sheet always has a real URL"; Android shares the link as
 * text (Android's share sheet ignores a separate URL), so it insists on a
 * web address a friend can open rather than anything that parses.
 */
export function shareableReferralLink(referral: Pick<ReferralInfo, 'link'> | null | undefined): string | null {
  const link = referral?.link.trim() ?? '';
  return WEB_LINK.test(link) ? link : null;
}
