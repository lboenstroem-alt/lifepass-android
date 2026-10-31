/**
 * The build-time environment: which servers this build talks to, and the
 * build switches. The Android twin of iOS `APIConfig`, `SupabaseConfig` and
 * the `LPSocialSignIn` Info.plist flag.
 *
 * Values come from `EXPO_PUBLIC_*` variables, which Expo inlines into the
 * bundle at build time: eas.json sets them for every EAS profile, and a
 * git-ignored `.env` (see `.env.example`) for local runs. Each read below must
 * name `process.env.EXPO_PUBLIC_…` literally, or the inlining misses it.
 *
 * ONE ENVIRONMENT. Every profile points at PRODUCTION, as iOS Debug builds do
 * (there is no staging for this app; DECISIONS.md). A missing or unusable
 * value therefore falls back to production, exactly as iOS falls back, and a
 * development build says so in the log when a value was given but unusable.
 * Tests point everything at unresolvable `.test` hosts (test/setup/env.ts).
 */

/** Production, as iOS `APIConfig.fallbackBaseURL` and `SupabaseConfig`. */
export const PRODUCTION = {
  /**
   * Must be the `www.` host: the apex `lifepass.is` 308-redirects to www, and
   * the Authorization header is dropped on that cross-host redirect, so every
   * authenticated call through the apex fails with 401.
   */
  apiBaseUrl: 'https://www.lifepass.is/api/v1',
  /** The project the API validates bearer tokens against. */
  supabaseUrl: 'https://katielfjlyidadfftsnz.supabase.co',
  /** Publishable key: public by design, the same key the website ships. */
  supabaseAnonKey: 'sb_publishable_QmVpB8ckWzz6NCZpKzqGWg_Ngev7KM3',
} as const;

/**
 * A base URL from the environment, or `fallback` when it is missing, blank,
 * an unresolved placeholder, not http(s), or has no host. Trailing slashes are
 * dropped so `${base}/profile` never doubles them.
 */
export function resolveBaseUrl(raw: string | undefined | null, fallback: string, name = 'URL'): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return fallback;
  if (!value.includes('$(') && !value.includes('${')) {
    try {
      const url = new URL(value);
      if ((url.protocol === 'https:' || url.protocol === 'http:') && url.host) {
        return value.replace(/\/+$/, '');
      }
    } catch {
      // Not a URL: fall through to the fallback.
    }
  }
  if (__DEV__) {
    console.warn(`[env] ${name} "${value}" is not a usable URL; falling back to PRODUCTION (${fallback})`);
  }
  return fallback;
}

/** A key from the environment, or `fallback` when missing, blank or a placeholder. */
export function resolveKey(raw: string | undefined | null, fallback: string): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || value.includes('$(') || value.includes('${')) return fallback;
  return value;
}

/**
 * A YES/NO build switch, read like iOS `SocialSignInGate.isEnabled`: YES,
 * TRUE or 1 in any case switch it on; anything else (unset, blank, NO, an
 * unresolved placeholder, a non-string) leaves it off.
 */
export function parseBuildFlag(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const value = raw.trim().toLowerCase();
  if (value.includes('$(') || value.includes('${')) return false;
  return value === 'yes' || value === 'true' || value === '1';
}

export const env = {
  /** The LifePass API, e.g. `https://www.lifepass.is/api/v1` (no trailing slash). */
  get apiBaseUrl(): string {
    return resolveBaseUrl(process.env.EXPO_PUBLIC_LIFEPASS_API_URL, PRODUCTION.apiBaseUrl, 'EXPO_PUBLIC_LIFEPASS_API_URL');
  },

  /** The API's host, e.g. `www.lifepass.is` (for "is this our own link?" checks). */
  get apiHost(): string {
    return new URL(env.apiBaseUrl).host.toLowerCase();
  },

  get supabaseUrl(): string {
    return resolveBaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL, PRODUCTION.supabaseUrl, 'EXPO_PUBLIC_SUPABASE_URL');
  },

  get supabaseAnonKey(): string {
    return resolveKey(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, PRODUCTION.supabaseAnonKey);
  },

  /** The runtime Mapbox `pk.` token, or null (the map then shows no tiles). */
  get mapboxToken(): string | null {
    const value = resolveKey(process.env.EXPO_PUBLIC_MAPBOX_TOKEN, '');
    return value || null;
  },

  /**
   * Whether this BUILD may offer Continue with Google / Apple. The buttons
   * still need the Supabase project to have the provider on (AUTH-2's gate).
   */
  get socialSignInBuildEnabled(): boolean {
    return parseBuildFlag(process.env.EXPO_PUBLIC_SOCIAL_SIGN_IN);
  },
};
