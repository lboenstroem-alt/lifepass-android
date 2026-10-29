/**
 * Who Home offers "Get offers by email", and how a tap that failed ends.
 *
 * THE SERVER DECIDES. `GET /profile` carries `offersCard` (API 0.51.0): `show`
 * by the website dashboard's own rule (not opted in, an active account with
 * no deletion asked for, pending or scheduled, no "no" of the member's own on
 * the consent ledger, and no "No thanks" on the card on any device) and
 * `dismissed` (that "No thanks"). The app never works the rule out itself; it
 * only ever takes the card away:
 *
 * - signed out, or no profile read yet: no card;
 * - no `offersCard` (a server older than 0.51.0, or one that could not read
 *   it this time): no card, so the card can only ask a server that takes its
 *   `app_card` source;
 * - opted in, or "No thanks" on the account: no card, whatever `show` says;
 * - "No thanks" on this phone (kept per member, ./storage.ts): no card, and
 *   none while that is still being read;
 * - answered on this phone this session (opted in, "No thanks", or refused as
 *   an account on its way out): no card, before the profile says so too.
 */
import { isProblem, NotAuthenticatedError } from '../../../api';
import type { Profile } from '../../../api/profile';

export interface OffersCardInputs {
  readonly signedIn: boolean;
  readonly profile: Pick<Profile, 'marketingConsent' | 'offersCard'> | null;
  /** "No thanks" kept on this phone for this member; null while it is being read. */
  readonly noThanksOnPhone: boolean | null;
  /** The member answered the card on this phone this session. */
  readonly answeredHere: boolean;
}

/** Whether Home offers the card now. */
export function offersCardOffered(input: OffersCardInputs): boolean {
  const { signedIn, profile } = input;
  if (!signedIn || !profile) return false;
  const card = profile.offersCard;
  if (!card || !card.show || card.dismissed) return false;
  if (profile.marketingConsent) return false;
  if (input.noThanksOnPhone !== false) return false;
  return !input.answeredHere;
}

/**
 * How a failed "Email me offers" ends:
 *
 * - `gone`: refused as an account on its way out (pending deletion, or
 *   scheduled at the end of the paid period). The website never offers such
 *   an account the card, so it closes without a word rather than ask for a
 *   tap that can never work.
 * - `signedOut`: the client has already ended the session, and the app is on
 *   its way to sign-in.
 * - `failed`: anything else (offline, a timeout, a 5xx, a 429, a refusal the
 *   card does not know): the card stays, says it could not save, and a tap
 *   tries again (the server writes an opt-in once, however many arrive).
 */
export type OptInFailure = 'gone' | 'signedOut' | 'failed';

export function optInFailure(error: unknown): OptInFailure {
  if (error instanceof NotAuthenticatedError) return 'signedOut';
  if (isProblem(error, 'account_pending_deletion', 'account_deletion_scheduled')) return 'gone';
  return 'failed';
}
