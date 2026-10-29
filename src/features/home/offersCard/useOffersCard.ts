/**
 * Home's "Get offers by email" card: what it shows, and its two taps, as the
 * website dashboard's card has them (apps/web/src/components/offers-opt-in/
 * offers-opt-in-card.tsx) and iOS HomeOffersCard and OffersCardStore do.
 *
 *   hidden  not offered (./rules.ts)
 *   offer   the card: what the member gets, Email me offers, No thanks
 *   done    after the opt-in, the done line, until this Home visit ends
 *           (another tab is selected, ../useHomeVisit.ts); the next time
 *           Home opens it is gone
 *
 * EMAIL ME OFFERS. The done line only once the server says so. A refusal
 * because the account is on its way out closes the card without a word;
 * anything else keeps the card with its "could not save" line, and a tap
 * tries again. Either way the buttons wait while a tap is on its way. Once
 * opted in (or refused as on its way out), the profile is read again, so the
 * app's own copy says so too. An answer that comes after the member has left
 * Home is shown when they come back: the visit count moves as Home is left.
 *
 * NO THANKS. The card goes at once and stays gone: kept on this phone for this
 * member (./storage.ts) and on the account, which shares it with the website
 * (best effort, as there). A No thanks the account never heard is said again,
 * once a session, while a profile read still offers the card.
 *
 * THE SESSION. What was answered here lives as long as Home, which is
 * mounted for the whole signed-in session: the tabs unmount at sign-out.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { newIdempotencyKey } from '../../../api';
import { useAppStore } from '../../../stores/appStore';
import { dismissOffersCard, optInToOffersByEmail } from './api';
import { offersCardOffered, optInFailure, type OptInFailure } from './rules';
import { keepNoThanksOnPhone, readNoThanksOnPhone } from './storage';

export type OffersCardMode = 'hidden' | 'offer' | 'done';

export interface OffersCard {
  readonly mode: OffersCardMode;
  /** Email me offers is on its way and the server has not answered. */
  readonly working: boolean;
  /** The last Email me offers could not be saved (shown for the visit it failed in). */
  readonly failed: boolean;
  readonly optIn: () => void;
  readonly dismiss: () => void;
}

/** One member, one Home visit: what a done line or a failure belongs to. */
interface Stamp {
  readonly profileId: string;
  readonly visit: number;
}

export function useOffersCard(visit: number): OffersCard {
  const signedIn = useAppStore((state) => state.isAuthenticated);
  const profile = useAppStore((state) => state.profile);
  const profileId = profile?.id ?? null;

  /** This phone's No thanks, per member, once read. */
  const [noThanks, setNoThanks] = useState<Readonly<Record<string, boolean>>>({});
  /** The members who answered the card on this phone this session. */
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  /** Whose Email me offers is on its way. */
  const [working, setWorking] = useState<string | null>(null);
  const [done, setDone] = useState<Stamp | null>(null);
  const [failed, setFailed] = useState<Stamp | null>(null);

  /** A tap is on its way: the next waits (state lags a render behind a double tap). */
  const busy = useRef(false);
  const visitNow = useRef(visit);
  /** The members whose No thanks has gone to the account this session. */
  const told = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    visitNow.current = visit;
  }, [visit]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // This phone's No thanks for the member on screen, read once.
  const noThanksHere = profileId === null ? undefined : noThanks[profileId];
  useEffect(() => {
    if (profileId === null || noThanksHere !== undefined) return undefined;
    let live = true;
    void readNoThanksOnPhone(profileId).then((value) => {
      if (live) setNoThanks((known) => (profileId in known ? known : { ...known, [profileId]: value }));
    });
    return () => {
      live = false;
    };
  }, [profileId, noThanksHere]);

  // A No thanks said here that the account never heard (offline at the
  // time): the profile still offers the card, so it is said again.
  const serverOffers = profile?.offersCard?.show === true && !profile.offersCard.dismissed;
  useEffect(() => {
    if (!signedIn || profileId === null || noThanksHere !== true || !serverOffers) return;
    if (told.current.has(profileId)) return;
    told.current.add(profileId);
    void dismissOffersCard(newIdempotencyKey()).catch(() => undefined);
  }, [signedIn, profileId, noThanksHere, serverOffers]);

  const optIn = useCallback(() => {
    if (profileId === null || busy.current) return;
    const id = profileId;
    busy.current = true;
    setWorking(id);
    setFailed(null);
    void (async () => {
      let outcome: 'done' | OptInFailure;
      try {
        await optInToOffersByEmail(newIdempotencyKey());
        outcome = 'done';
      } catch (error) {
        outcome = optInFailure(error);
      }
      busy.current = false;
      if (!mounted.current) return;
      setWorking(null);
      if (outcome === 'done') setDone({ profileId: id, visit: visitNow.current });
      if (outcome === 'failed') setFailed({ profileId: id, visit: visitNow.current });
      if (outcome === 'done' || outcome === 'gone') {
        setAnswered((known) => new Set(known).add(id));
        // The app's own copy of the profile: opted in now, or on its way out.
        void useAppStore.getState().loadProfile();
      }
    })();
  }, [profileId]);

  const dismiss = useCallback(() => {
    if (profileId === null || busy.current) return;
    const id = profileId;
    setAnswered((known) => new Set(known).add(id));
    setNoThanks((known) => ({ ...known, [id]: true }));
    setFailed(null);
    told.current.add(id);
    void keepNoThanksOnPhone(id);
    // Kept on the account too. Best effort: the card is gone here whatever the answer.
    void dismissOffersCard(newIdempotencyKey()).catch(() => undefined);
  }, [profileId]);

  const current = (stamp: Stamp | null) => stamp !== null && stamp.profileId === profileId && stamp.visit === visit;
  const workingHere = profileId !== null && working === profileId;
  let mode: OffersCardMode = 'hidden';
  if (signedIn && current(done)) mode = 'done';
  // A tap on its way keeps the card, whatever a profile read meanwhile says.
  else if (signedIn && workingHere) mode = 'offer';
  else if (
    offersCardOffered({
      signedIn,
      profile,
      noThanksOnPhone: noThanksHere ?? null,
      answeredHere: profileId !== null && answered.has(profileId),
    })
  ) {
    mode = 'offer';
  }

  return { mode, working: workingHere, failed: mode === 'offer' && current(failed), optIn, dismiss };
}
