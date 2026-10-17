/**
 * The app's one Supabase client: the Android twin of iOS `SupabaseService`
 * (Services/SupabaseService.swift).
 *
 * - URL and publishable key come from the build (src/config/env.ts) and fall
 *   back to PRODUCTION when missing or unusable, as iOS falls back from its
 *   Info.plist, instead of throwing at launch as the first Android build did.
 * - The session lives in Keystore-encrypted storage
 *   (src/lib/secureSessionStorage.ts), never in plain AsyncStorage; a session
 *   the first build left there is moved on its first read.
 * - Every request goes through `createAuthFetch()` (src/api/authFetch.ts): a
 *   failing auth server (a 500 or 429 on a refresh) must not sign anyone out,
 *   a refresh failure is reported at once, and every auth request has a
 *   ceiling.
 * - `autoRefreshToken` is on; the app store starts and stops the refresh
 *   ticker as the app comes and goes (src/stores/appStore.ts), the React
 *   Native recipe. `detectSessionInUrl` must be off in React Native: auth
 *   links are handled by the deep-link router.
 *
 * The storage key is supabase-js's default (`sb-<project ref>-auth-token`),
 * deliberately not set here: changing it would sign every existing member
 * out.
 */
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

import { createAuthFetch } from '../../api/authFetch';
import { env } from '../../config/env';
import { secureSessionStorage } from '../../lib/secureSessionStorage';

/**
 * The key supabase-js stores the session under for `supabaseUrl`: its own
 * default, `sb-<first label of the host>-auth-token`.
 */
export function supabaseStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

/** Where this build's session is stored (read directly for an offline cold start). */
export const SUPABASE_STORAGE_KEY = supabaseStorageKey(env.supabaseUrl);

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: secureSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    fetch: createAuthFetch(),
  },
});

// ---------------------------------------------------------------------------
// Ending the session, in supabase-swift's order

/**
 * Ends the session on this phone NOW: the stored session is removed and
 * SIGNED_OUT is emitted, without asking anyone. The first half of
 * supabase-swift's `signOut()`, which removes the session and emits
 * `.signedOut` before it sends the logout (`revokeSessionOnServer`).
 *
 * Not supabase-js's `signOut()`: that queues behind the SDK's session lock
 * (which a refresh retrying offline holds for up to 30 s), asks the auth
 * server first, and keeps the session when that request fails on the way.
 * This is the SDK's own local removal (`_removeSession`), which takes no
 * lock. It is not public API, so it is feature-checked (F2's
 * src/api/__tests__/auth.test.ts fails on an SDK upgrade that drops it), and
 * without it the stored keys are removed directly: the app store signs the
 * member out itself either way.
 */
export async function endSessionOnPhone(): Promise<void> {
  const auth = supabase.auth as unknown as { _removeSession?: () => Promise<void> };
  if (typeof auth._removeSession === 'function') {
    try {
      await auth._removeSession.call(supabase.auth);
      return;
    } catch {
      // Remove what it would have removed.
    }
  }
  await Promise.all(
    [SUPABASE_STORAGE_KEY, `${SUPABASE_STORAGE_KEY}-code-verifier`, `${SUPABASE_STORAGE_KEY}-user`].map((key) =>
      secureSessionStorage.removeItem(key).catch(() => undefined),
    ),
  );
}

/**
 * `POST /auth/v1/logout?scope=global` with the member's own token, as
 * supabase-swift's `signOut()` sends it once the session is gone from the
 * phone: every session of the member's ends on the server. The admin API's
 * `signOut(jwt, scope)` is exactly that request and nothing more (no service
 * key, no stored session touched, no lock). Waits at most `waitMs`; a
 * failure changes nothing (the session is already off the phone, and the
 * server's copy expires on its own).
 */
export async function revokeSessionOnServer(accessToken: string, waitMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      supabase.auth.admin.signOut(accessToken, 'global'),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, waitMs);
      }),
    ]);
  } catch {
    // As above: nothing more to do.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
