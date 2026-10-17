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
