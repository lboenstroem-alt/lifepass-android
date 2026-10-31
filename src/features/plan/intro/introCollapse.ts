/**
 * The intro card's "Not now", per member (iOS UserDefaults
 * `plan.intro.collapsed.<profileId>`).
 *
 * IT NEVER EXPIRES: the collapsed row stays until the member has a plan,
 * because a card that reappears every week is nagging and a card that
 * vanishes for good hides the feature.
 *
 * The flag is health use, so its key is F7's (`planIntroCollapsedKey`) and
 * the health wipe removes it. iOS reads UserDefaults synchronously; here the
 * value is read once per member into memory, and the screen draws neither
 * form of the card until it is known, so a member who said Not now never
 * sees the full card flash first. The wipe hook (../register.ts) forgets the
 * memory with the stored flag.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import { create } from 'zustand';

import { planIntroCollapsedKey } from '../../../health';
import { storedFlag } from '../shell/adoptedBanner';

interface IntroCollapseState {
  /** profileId -> collapsed; absent until read. */
  readonly byProfile: Readonly<Record<string, boolean>>;
}

export const useIntroCollapse = create<IntroCollapseState>()(() => ({ byProfile: {} }));

const reading = new Set<string>();

/** Reads the stored flag once per member (again after `forgetIntroCollapse`). */
export async function loadIntroCollapsed(profileId: string): Promise<boolean> {
  const known = useIntroCollapse.getState().byProfile[profileId];
  if (known !== undefined) return known;
  if (reading.has(profileId)) return false;
  reading.add(profileId);
  let collapsed = false;
  try {
    collapsed = storedFlag(await AsyncStorage.getItem(planIntroCollapsedKey(profileId)));
  } catch {
    // Unreadable storage: the full card, which is what a first visit shows.
  } finally {
    reading.delete(profileId);
  }
  // A Not now tapped while the read was in flight wins.
  const now = useIntroCollapse.getState().byProfile[profileId];
  if (now !== undefined) return now;
  useIntroCollapse.setState((state) => ({ byProfile: { ...state.byProfile, [profileId]: collapsed } }));
  return collapsed;
}

/** Not now: collapsed at once, and stored for this member. */
export function collapseIntro(profileId: string): void {
  useIntroCollapse.setState((state) => ({ byProfile: { ...state.byProfile, [profileId]: true } }));
  AsyncStorage.setItem(planIntroCollapsedKey(profileId), 'true').catch(() => undefined);
}

/** The health wipe and sign-out: the next read goes to storage (which the wipe emptied). */
export function forgetIntroCollapse(): void {
  useIntroCollapse.setState({ byProfile: {} });
}

/** Whether this member collapsed the intro: null until known. */
export function useIntroCollapsed(profileId: string | null): boolean | null {
  const value = useIntroCollapse((s) => (profileId ? s.byProfile[profileId] : undefined));
  useEffect(() => {
    if (profileId && value === undefined) void loadIntroCollapsed(profileId);
  }, [profileId, value]);
  if (!profileId) return false;
  return value ?? null;
}
