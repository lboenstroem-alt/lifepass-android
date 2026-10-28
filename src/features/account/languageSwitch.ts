/**
 * Changing the account language from Account: iOS `AccountView.setLanguage`.
 *
 * The language is the ACCOUNT's (`profiles.locale`), not the phone's: it
 * decides the app's words, venue descriptions and the emails LifePass sends.
 * Choosing one posts `POST /profile/locale` and re-reads the profile; the app
 * store derives its language from the profile, so every screen re-labels at
 * once (src/stores/appStore `deriveLanguage`).
 *
 * - No profile yet, or the language it already has: nothing is sent.
 * - A refusal or no answer: the language stays as it was (the profile was
 *   not re-read), and the screen says why, in that language.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage } from '../../api/errorFormatter';
import { setProfileLocale, type Profile } from '../../api/profile';
import type { Lang } from '../../i18n';
import { useAppStore } from '../../stores/appStore';

/** Whether choosing `code` should reach the server (iOS's two guards). */
export function languageChangeNeeded(profile: Pick<Profile, 'locale'> | null, code: Lang): boolean {
  if (!profile) return false;
  return profile.locale !== code;
}

/**
 * Posts the language and re-reads the profile. Answers null when it was
 * saved, else the member-facing reason (in the language still on screen).
 */
export async function saveAccountLanguage(code: Lang): Promise<string | null> {
  try {
    await setProfileLocale(code);
    await useAppStore.getState().loadProfile();
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

export interface LanguageSwitch {
  /** A change is on its way: the row reads "Saving…". */
  readonly saving: boolean;
  /** Why the last change did not happen; the screen shows it in an alert. */
  readonly error: string | null;
  readonly dismissError: () => void;
  /** The member picked a language in the dialog. */
  readonly choose: (code: Lang) => Promise<void>;
}

export function useLanguageSwitch(): LanguageSwitch {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const choose = useCallback(async (code: Lang) => {
    if (!languageChangeNeeded(useAppStore.getState().profile, code)) return;
    setSaving(true);
    const failure = await saveAccountLanguage(code);
    if (!mounted.current) return;
    setSaving(false);
    if (failure !== null) setError(failure);
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return { saving, error, dismissError, choose };
}
