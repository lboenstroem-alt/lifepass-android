/**
 * The first Android build's auth hook, kept for the screens that still call
 * it (RootNavigator, Home, Account, ProfileCreditCard) until their owners
 * move them to the app store. It no longer keeps a session of its own: each
 * call used to re-read the session and add its own auth listener; now it
 * reads the one app store (src/stores/appStore.ts), whose single listener and
 * launch sequence decide who is signed in.
 *
 * New code reads `useAppStore` directly.
 */
import { useEffect } from 'react';
import type { Session, User } from '@supabase/supabase-js';

import { useAppStore } from '../../stores/appStore';
import { signIn, signUp } from '../services/auth';

type AuthState = {
  /** The signed-in member's session (a stored one after an offline cold start), else null. */
  session: Session | null;
  user: User | null;
  /** Launch: until the session is resolved and the first profile read has answered. */
  loading: boolean;
};

type AuthActions = {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    nationality: string | undefined,
    marketingOptIn: boolean,
  ) => Promise<void>;
  /** Signs out (never throws: an offline sign-out ends the session on this phone). */
  signOut: () => Promise<void>;
};

export function useAuth(): AuthState & AuthActions {
  const session = useAppStore((s) => (s.isAuthenticated ? s.session : null));
  const loading = useAppStore((s) => s.isLoading);

  // The launch sequence runs once whoever asks first; later calls share it.
  useEffect(() => {
    void useAppStore.getState().bootstrap();
  }, []);

  return {
    session,
    user: session?.user ?? null,
    loading,
    signIn: async (email, password) => {
      // The SIGNED_IN this produces runs the app store's sign-in.
      await signIn(email, password);
    },
    signUp: async (email, password, fullName, nationality, marketingOptIn) => {
      await signUp(email, password, fullName, nationality, marketingOptIn);
    },
    signOut: () => useAppStore.getState().signOut(),
  };
}
