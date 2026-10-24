/**
 * `GET /app-version?platform=android`: the update check at launch
 * (monorepo docs/05_MOBILE_API.md, "App version check").
 *
 * The server answers which version this app should be on; the app decides
 * (src/features/appUpdate/policy.ts):
 *
 *   { platform: 'android', minimumVersion: '2.6.0' | null,
 *     latestVersion: '2.7.0' | null, storeUrl: 'https://play.google.com/...' }
 *
 * `minimumVersion` is the owner's one setting (APP_MIN_VERSION_ANDROID; null
 * = no minimum); `latestVersion` is what Google Play sells as far as the
 * server knows (APP_LATEST_VERSION_ANDROID; null = unknown, no soft prompt).
 *
 * ANONYMOUS. The answer is the same for everyone and cacheable at the edge,
 * so no token goes with it (`auth: 'none'`): the check never waits on the
 * auth SDK, and a member on the sign-in screen is checked too. The app's own
 * version is not sent.
 *
 * TOLERANT. The decoder never throws on a field it does not like: a version
 * that is not a string is "none", a missing store link is the Play listing.
 * Anything that is not an answer at all (no envelope, another platform's
 * answer) throws, and the caller fails OPEN: an update check that cannot be
 * read never stops anybody using the app.
 */
import { apiGet, type RequestOptions } from './client';
import { DecodingError } from './errors';

/** This app's package on Google Play. */
export const ANDROID_PACKAGE_NAME = 'is.lifepass.android';

/** The Play listing, when the server names none (the same URL the server sends). */
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE_NAME}`;

/** The check runs at launch: it must never keep anything waiting for long (the contract says about 5 s). */
export const APP_VERSION_TIMEOUT_MS = 5_000;

export interface AppVersionPolicy {
  /** Below this the app blocks with an Update button; null = no minimum. */
  readonly minimumVersion: string | null;
  /** The newest version on Google Play; null = unknown (no soft prompt). */
  readonly latestVersion: string | null;
  /** Where Update goes: always a Google Play listing. */
  readonly storeUrl: string;
}

function versionField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * The store link, only when it is a Google Play listing over https: the
 * button says Google Play, and a server bug must not send members anywhere
 * else.
 */
export function playStoreUrl(value: unknown): string {
  if (typeof value !== 'string') return PLAY_STORE_URL;
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'https:' && url.host === 'play.google.com' && url.pathname.startsWith('/store/apps/')) {
      return url.toString();
    }
  } catch {
    // Not a URL: the default listing.
  }
  return PLAY_STORE_URL;
}

/** The envelope's `data` for this platform. Throws only when it is not an answer at all. */
export function decodeAppVersionPolicy(data: unknown): AppVersionPolicy {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new DecodingError('app-version: data is not an object');
  }
  const record = data as Record<string, unknown>;
  if (typeof record.platform === 'string' && record.platform.toLowerCase() !== 'android') {
    throw new DecodingError(`app-version: answer for ${record.platform}, not android`);
  }
  return {
    minimumVersion: versionField(record.minimumVersion),
    latestVersion: versionField(record.latestVersion),
    storeUrl: playStoreUrl(record.storeUrl),
  };
}

/** `GET /app-version?platform=android`. Throws on any failure; the caller fails open. */
export function fetchAppVersionPolicy(
  options: Pick<RequestOptions<AppVersionPolicy>, 'signal' | 'timeoutMs'> = {},
): Promise<AppVersionPolicy> {
  return apiGet<AppVersionPolicy>(
    '/app-version',
    { platform: 'android' },
    {
      auth: 'none',
      // Public and the same for everyone: the HTTP cache may keep it for the
      // minute the server allows.
      cache: 'default',
      timeoutMs: options.timeoutMs ?? APP_VERSION_TIMEOUT_MS,
      signal: options.signal,
      decode: decodeAppVersionPolicy,
    },
  );
}
