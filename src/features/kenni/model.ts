/**
 * The Kenni sheet's flow, apart from the view so a test can run it against
 * the stub server with a stand-in for the browser step: the Android port of
 * iOS `KenniVerificationModel` and `KenniFailure`
 * (ViewModels/KenniVerificationModel.swift).
 *
 *   start → (already verified | eID in a Custom Tab) → complete
 *
 * A round trip that ends without a verification always says why (`failure`),
 * and the sheet stays put with the way on: try again, visitor passes, or
 * support. It never just reopens the same screen with nothing said, which is
 * what a cancel did in the first Android build.
 *
 * WHAT THE SERVER CAN ANSWER (`POST /auth/kenni/complete`, openapi 0.24.0+):
 * - `409 kennitala_already_linked`: the kennitala already belongs to another
 *   LifePass account. Nothing is written and the state is spent. A server
 *   from before 0.24.0 answers this with an unhandled `500 internal_error`,
 *   so a 5xx from complete reads as "maybe that" (`serverError`), never as a
 *   bare "something went wrong";
 * - `410 kenni_state_expired` (about ten minutes passed) and
 *   `kenni_state_already_failed` (a spent state): restart from start;
 * - any other 4xx or 5xx: the check could not be finished.
 * The `lifepass://kenni-callback` redirect itself can carry Kenni's own
 * `?error=` (OIDC): `access_denied` is the member cancelling in the eID app.
 *
 * The sentences are the web's eID step (`plans-copy.ts`, `eid.reasons`) in
 * both languages, generated from iOS; this file only picks the key.
 */
import { isApiError } from '../../api';
import { track } from '../../lib/analytics';

import { KenniNoAuthorizationUrlError, kenniService, type KenniService } from './service';
import { KenniWebAuthError, type Authenticate } from './webAuth';

// ---------------------------------------------------------------------------
// Why a round trip ended unverified

export type KenniFailure =
  /** The member closed the eID tab, or cancelled in Kenni. */
  | 'cancelled'
  /** The verification state ran out (`kenni_state_expired`). */
  | 'expired'
  /** `409 kennitala_already_linked`: the kennitala is on another account. */
  | 'alreadyLinked'
  /** A 5xx from complete; an older server answers a linked kennitala this way. */
  | 'serverError'
  /** No answer from LifePass (offline, a timeout). */
  | 'offline'
  /** The eID tab could not be opened, or start was refused. */
  | 'couldNotStart'
  /** Anything else: a refused or incomplete completion. */
  | 'failed';

/** Every failure, in iOS's declaration order. */
export const KENNI_FAILURES: readonly KenniFailure[] = [
  'cancelled',
  'expired',
  'alreadyLinked',
  'serverError',
  'offline',
  'couldNotStart',
  'failed',
];

const MESSAGE_KEYS: Readonly<Record<KenniFailure, string>> = {
  cancelled: 'kenni.err.cancelled',
  expired: 'kenni.err.expired',
  alreadyLinked: 'kenni.err.linked',
  serverError: 'kenni.err.server',
  offline: 'kenni.err.offline',
  couldNotStart: 'kenni.err.start',
  failed: 'kenni.err.failed',
};

/** The one sentence the sheet says about `failure`. */
export function failureMessageKey(failure: KenniFailure): string {
  return MESSAGE_KEYS[failure];
}

/**
 * Whether another try can help. The same eID gives the same kennitala, which
 * is still on the other account: no "Try again" for that one.
 */
export function failureOffersRetry(failure: KenniFailure): boolean {
  return failure !== 'alreadyLinked';
}

/** Whether the sheet offers to write to support (the two that may mean a kennitala on another account). */
export function failureOffersSupport(failure: KenniFailure): boolean {
  return failure === 'alreadyLinked' || failure === 'serverError';
}

/**
 * Whether the sheet offers "Sign in with another account" (it signs out):
 * both sentences that may mean a kennitala on another account tell the member
 * to sign in with that account, and an older server answers that case with a
 * 5xx, so `serverError` needs the button as much as `alreadyLinked` does.
 */
export function failureOffersSignInOther(failure: KenniFailure): boolean {
  return failure === 'alreadyLinked' || failure === 'serverError';
}

/** A failed `POST /auth/kenni/complete` (iOS `KenniFailure.fromCompletion`). */
export function failureFromCompletion(error: unknown): KenniFailure {
  if (!isApiError(error)) return 'failed';
  if (error.isProblem('kennitala_already_linked')) return 'alreadyLinked';
  if (error.isProblem('kenni_state_expired')) return 'expired';
  switch (error.kind) {
    case 'transport':
      return error.isCancellation ? 'cancelled' : 'offline';
    case 'problem':
    case 'http-status': {
      // A problem's own status (iOS `statusCode` reads `p.status`), or the
      // response's for an edge's HTML page.
      const status = error.status;
      return status !== undefined && status >= 500 ? 'serverError' : 'failed';
    }
    default:
      // A body that did not decode, or a session the server refused.
      return 'failed';
  }
}

/**
 * A failed `POST /auth/kenni/start` (iOS `fromStart`). Nothing was checked
 * yet, so there is no kennitala to be already linked: anything but no answer
 * is "we couldn't start the eID check".
 */
export function failureFromStart(error: unknown): KenniFailure {
  if (isApiError(error) && error.kind === 'transport') return error.isCancellation ? 'cancelled' : 'offline';
  return 'couldNotStart';
}

/** The eID tab ended without a redirect (iOS `fromAuthentication`). */
export function failureFromAuthentication(error: unknown): KenniFailure {
  if (error instanceof KenniWebAuthError) return error.reason;
  if (error instanceof KenniNoAuthorizationUrlError) return 'couldNotStart';
  return 'failed';
}

/**
 * The redirect's query items, percent-decoded, in order (iOS
 * `URLComponents.queryItems`: the query only, never the fragment; a `+` stays
 * a `+`). React Native's `URL` cannot read a query, so this is by hand.
 */
export function callbackQueryItems(url: string): { readonly name: string; readonly value: string }[] {
  const start = url.indexOf('?');
  if (start < 0) return [];
  const hash = url.indexOf('#', start);
  const query = url.slice(start + 1, hash < 0 ? undefined : hash);
  if (!query) return [];
  return query.split('&').map((pair) => {
    const equals = pair.indexOf('=');
    const name = equals < 0 ? pair : pair.slice(0, equals);
    const value = equals < 0 ? '' : pair.slice(equals + 1);
    return { name: decodeComponent(name), value: decodeComponent(value) };
  });
}

function decodeComponent(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The first item named `name`, or null when it is missing or empty (as iOS reads it). */
function callbackValue(url: string, name: string): string | null {
  const item = callbackQueryItems(url).find((entry) => entry.name === name);
  return item && item.value ? item.value : null;
}

/**
 * The `lifepass://kenni-callback` redirect (iOS `fromCallback`): null when it
 * carries a code and a state to complete with. Kenni's `?error=` is never
 * shown as is.
 */
export function failureFromCallback(url: string): KenniFailure | null {
  const error = callbackValue(url, 'error');
  if (error !== null) return error === 'access_denied' ? 'cancelled' : 'failed';
  if (callbackValue(url, 'code') === null || callbackValue(url, 'state') === null) return 'failed';
  return null;
}

// ---------------------------------------------------------------------------
// The flow

export type KenniPhase = 'idle' | 'working' | 'verified';

export interface KenniModelState {
  readonly phase: KenniPhase;
  readonly failure: KenniFailure | null;
}

/** Whether the main button reads "Try again with eID" (after a failure another try can fix). */
export function isRetry(state: KenniModelState): boolean {
  return state.failure !== null && failureOffersRetry(state.failure);
}

/** The main button: hidden for a kennitala already on another account, where another try gives the same answer. */
export function offersVerifyButton(state: KenniModelState): boolean {
  return state.failure === null || failureOffersRetry(state.failure);
}

/**
 * What verifying stores and why (GDPR Art. 13: said before the kennitala is
 * collected), wherever the sheet offers to start the eID check: before the
 * first try and before every retry. Not once the kennitala is verified, and
 * not for one already on another account, where there is nothing to start
 * (as the web's eID step does).
 */
export function showsDataNote(state: KenniModelState): boolean {
  return state.phase !== 'verified' && offersVerifyButton(state);
}

export interface KenniModelDeps {
  /** The API calls; the app's own by default. */
  readonly service?: KenniService;
  /** The eID browser step (./webAuth.ts in the app). */
  readonly authenticate: Authenticate;
  /** Runs once the kennitala is verified (the app re-reads `GET /profile`). Awaited. */
  readonly onVerified: () => Promise<void> | void;
}

const INITIAL: KenniModelState = { phase: 'idle', failure: null };

/**
 * One sheet's round trips. Observable (`subscribe` / `getState`, for
 * `useSyncExternalStore`); every change replaces the state object.
 */
export class KenniVerificationModel {
  private state: KenniModelState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private readonly service: KenniService;
  private readonly authenticate: Authenticate;
  private readonly onVerified: () => Promise<void> | void;

  constructor(deps: KenniModelDeps) {
    this.service = deps.service ?? kenniService;
    this.authenticate = deps.authenticate;
    this.onVerified = deps.onVerified;
  }

  getState = (): KenniModelState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get phase(): KenniPhase {
    return this.state.phase;
  }

  get failure(): KenniFailure | null {
    return this.state.failure;
  }

  get isRetry(): boolean {
    return isRetry(this.state);
  }

  get offersVerifyButton(): boolean {
    return offersVerifyButton(this.state);
  }

  get showsDataNote(): boolean {
    return showsDataNote(this.state);
  }

  /** The main button. Ignored unless idle (a double tap starts one round trip). */
  async start(): Promise<void> {
    if (this.state.phase !== 'idle') return;
    this.set({ phase: 'working', failure: null });
    track('kenni_verification_started');

    let authorizationUrl: string;
    try {
      const started = await this.service.startVerification();
      if (started.kind === 'alreadyVerified') {
        // Never opens the browser.
        await this.finishVerified();
        return;
      }
      authorizationUrl = started.url;
    } catch (error) {
      this.fail(failureFromStart(error));
      return;
    }

    let callback: string;
    try {
      callback = await this.authenticate(authorizationUrl);
    } catch (error) {
      this.fail(failureFromAuthentication(error));
      return;
    }
    await this.complete(callback);
  }

  /**
   * Finishes a round trip whose redirect arrived without the tab that asked
   * for it: Android stopped the app while the member was in the eID app, and
   * the redirect started it again (./callbackLink.ts). The state is still
   * the server's, bound to this member's profile, so it completes as usual;
   * one that was not theirs is refused there. Ignored unless idle.
   */
  async resume(callbackUrl: string): Promise<void> {
    if (this.state.phase !== 'idle') return;
    this.set({ phase: 'working', failure: null });
    await this.complete(callbackUrl);
  }

  private async complete(callback: string): Promise<void> {
    const refused = failureFromCallback(callback);
    if (refused) {
      this.fail(refused);
      return;
    }
    const code = callbackValue(callback, 'code') ?? '';
    const state = callbackValue(callback, 'state') ?? '';
    let verified: boolean;
    try {
      verified = await this.service.completeVerification(code, state);
    } catch (error) {
      this.fail(failureFromCompletion(error));
      return;
    }
    if (verified) await this.finishVerified();
    else this.fail('failed');
  }

  private fail(reason: KenniFailure): void {
    this.set({ phase: 'idle', failure: reason });
  }

  private async finishVerified(): Promise<void> {
    this.set({ phase: 'verified', failure: null });
    track('kenni_verification_completed');
    try {
      await this.onVerified();
    } catch {
      // The profile read keeps what it had; the sheet still says verified,
      // which it is on the server.
    }
  }

  private set(next: KenniModelState): void {
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }
}
