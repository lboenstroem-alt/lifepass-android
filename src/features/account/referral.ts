/**
 * The Refer a friend row's data and its share: iOS `AccountView.referral`,
 * `loadReferral()` and the row's `ShareLink`.
 *
 * Best-effort, as on iOS: the row renders only once a real link has loaded,
 * so the share sheet always carries a URL; a failed read (an older server
 * without `/referrals/me`, offline) hides it, including a read that fails
 * after an earlier one worked (iOS assigns `try?`'s nil). Every reward rule
 * is the server's.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';

import { fetchReferral, shareableReferralLink, type ReferralInfo } from '../../api/referrals';
import type { Lang } from '../../i18n';

import { referralShareMessage } from './accountCopy';

export interface ReferralRowData {
  readonly rewardsEarned: number;
  /** The link to share; the row exists only when there is one. */
  readonly link: string;
}

/** The row's data from an answer, or null when the answer has no link a friend could open. */
export function referralRowData(referral: ReferralInfo | null): ReferralRowData | null {
  const link = shareableReferralLink(referral);
  if (!referral || !link) return null;
  return { rewardsEarned: referral.rewardsEarned, link };
}

export function useReferral(): { readonly row: ReferralRowData | null; readonly load: () => Promise<void> } {
  const [row, setRow] = useState<ReferralRowData | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    let answer: ReferralInfo | null;
    try {
      answer = await fetchReferral();
    } catch {
      answer = null;
    }
    if (mounted.current) setRow(referralRowData(answer));
  }, []);

  return { row, load };
}

/**
 * Opens the system share sheet with the referral message and link (WhatsApp,
 * Messages, email and copy in one gesture, as the iOS share sheet).
 */
export async function shareReferral(link: string, lang: Lang): Promise<void> {
  try {
    await Share.share({ message: referralShareMessage(link, lang) });
  } catch {
    // The sheet could not open; nothing was shared and nothing is lost.
  }
}
