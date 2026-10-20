/**
 * Every link that opens the app: the Android port of iOS
 * `LifePassApp.handleIncomingURL` and `routeScanURL` (App/LifePassApp.swift).
 *
 * Links arrive two ways and both come here: the one that started the app
 * (`Linking.getInitialURL`, a cold start) and any that arrive while it runs
 * (the `url` event). Each is routed by what it is:
 *
 * - CHECK-IN LINKS. A printed poster encodes `https://lifepass.is/scan?v=<id>`
 *   (an App Link, either host), and internal redirects use
 *   `lifepass://scan?v=<id>`. A link only PARKS the venue (the intent store);
 *   it never checks anyone in. The Scan tab asks "Check in at <venue>?" first:
 *   venue ids are public and any page or message can open such a link
 *   (2.5.0). A link that arrives while signed out waits for the sign-in, and
 *   sign-out forgets it.
 * - AUTH LINKS (email confirmation, password reset, D23):
 *   `https://www.lifepass.is/app/auth-callback` and `lifepass://auth/callback`
 *   go to AUTH-1's `handleAuthCallback`. The Google / Apple page's return,
 *   `lifepass://auth/callback/social?...`, goes to AUTH-2's
 *   `completeSocialReturn` instead, and never to the email-link handler: on
 *   iOS the web-auth session catches that return itself, so the email
 *   handler's "couldn't confirm your email" banner never follows a provider
 *   sign-in, and a launch by it (a process death behind the page) finishes
 *   the sign-in here, at the start, whatever screen shows.
 * - PAYMENT AND CARD-SETUP RETURNS (`lifepass://payment-success|canceled`,
 *   `lifepass://card-setup-success|canceled`) go to whoever registered for
 *   them (F8's in-flight recovery: `registerReturnHandler`). A hosted page
 *   that is still open captures its own return (openAuthSessionAsync), so
 *   what reaches here is a return the app was not waiting for in memory, a
 *   cold start after Android dropped the process behind the Custom Tab. A
 *   return is never a launch onto Explore: the member was elsewhere, so the
 *   launch filter presentation is cancelled first, whoever handles it. A
 *   return that arrives before its rail has registered (the rail's module
 *   loads later on a cold start) is kept, the last one per kind, and handed
 *   to the rail when it registers (iOS parks the outcome on AppState until a
 *   view takes it). Sign-out forgets it.
 *
 * Anything else is ignored.
 */
import { Linking } from 'react-native';

import { parseWalkInQr, isVenueUuid } from '../checkin/walkInQrParser';
import { handleAuthCallback } from '../features/auth/authCallback';
import { completeSocialReturn, isSocialReturnUrl } from '../features/auth/social';
import { useIntentStore } from '../stores/intentStore';
import { registerSignOutCleaner } from './signOut';

/** The custom scheme (app.json `scheme`). */
export const APP_SCHEME = 'lifepass';

/** The website's hosts the app claims App Links on (both, plan 5.4): check-in posters and auth emails. */
export const SCAN_LINK_HOSTS: readonly string[] = ['lifepass.is', 'www.lifepass.is'];

/** The App Link path for auth emails (D23). */
export const AUTH_APP_LINK_PATH = '/app/auth-callback';

export type ReturnKind = 'payment' | 'cardSetup';

/** A hosted page's return link. */
export interface HostedPageReturn {
  readonly kind: ReturnKind;
  /** `success` from `payment-success` / `card-setup-success`; the outcome is still verified by the rail. */
  readonly outcome: 'success' | 'canceled';
  readonly url: string;
}

export type DeepLink =
  | { readonly kind: 'scan'; readonly venueId: string }
  | { readonly kind: 'auth'; readonly url: string }
  | { readonly kind: 'return'; readonly hostedReturn: HostedPageReturn }
  | { readonly kind: 'ignored' };

interface LinkParts {
  readonly scheme: string;
  readonly host: string;
  readonly path: string;
  readonly query: string;
}

/**
 * Splits `scheme://host/path?query#fragment` by hand: the custom scheme is
 * not a "special" URL scheme, and URL polyfills disagree on its host.
 */
function splitLink(url: string): LinkParts | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(url.trim());
  if (!match) return null;
  return {
    scheme: match[1].toLowerCase(),
    host: match[2].toLowerCase(),
    path: match[3] ?? '',
    query: match[4] ?? '',
  };
}

function queryValue(query: string, name: string): string | null {
  for (const pair of query.split('&')) {
    const at = pair.indexOf('=');
    const key = at < 0 ? pair : pair.slice(0, at);
    if (key !== name) continue;
    const raw = at < 0 ? '' : pair.slice(at + 1);
    try {
      return decodeURIComponent(raw.replace(/\+/g, ' '));
    } catch {
      return raw;
    }
  }
  return null;
}

const RETURNS: Readonly<Record<string, HostedPageReturn['kind']>> = {
  'payment-success': 'payment',
  'payment-canceled': 'payment',
  'card-setup-success': 'cardSetup',
  'card-setup-canceled': 'cardSetup',
};

/** What a link is (pure; `handleDeepLink` acts on it). */
export function parseDeepLink(url: string | null | undefined): DeepLink {
  if (!url) return { kind: 'ignored' };
  const parts = splitLink(url);
  if (!parts) return { kind: 'ignored' };
  const path = parts.path.replace(/\/+$/, '');

  if (parts.scheme === 'https' || parts.scheme === 'http') {
    if (SCAN_LINK_HOSTS.includes(parts.host)) {
      if (path === AUTH_APP_LINK_PATH) return { kind: 'auth', url };
      // The printed form goes through the canonical poster parser, as on iOS.
      if (path === '/scan') {
        const result = parseWalkInQr(url);
        return result.ok ? { kind: 'scan', venueId: result.venueId.toLowerCase() } : { kind: 'ignored' };
      }
    }
    return { kind: 'ignored' };
  }

  if (parts.scheme === APP_SCHEME) {
    if (parts.host === 'scan') {
      // Internal redirects: only the `v` query item, validated as a venue UUID.
      const v = queryValue(parts.query, 'v');
      return v !== null && isVenueUuid(v) ? { kind: 'scan', venueId: v.toLowerCase() } : { kind: 'ignored' };
    }
    if (parts.host === 'auth') return { kind: 'auth', url };
    const returnKind = RETURNS[parts.host];
    if (returnKind) {
      return {
        kind: 'return',
        hostedReturn: { kind: returnKind, outcome: parts.host.endsWith('-success') ? 'success' : 'canceled', url },
      };
    }
    return { kind: 'ignored' };
  }

  // Expo Go during development: `exp://<host>/--/auth/callback`.
  if (__DEV__ && (parts.scheme === 'exp' || parts.scheme === 'exps') && path.endsWith('/--/auth/callback')) {
    return { kind: 'auth', url };
  }
  return { kind: 'ignored' };
}

// ---------------------------------------------------------------------------
// Hosted-page returns: whoever owns the rail registers for them

type ReturnHandler = (hostedReturn: HostedPageReturn) => void | Promise<void>;

const returnHandlers = new Map<ReturnKind, ReturnHandler>();

/** The last return of each kind that arrived with no rail registered, waiting for one. */
const unhandledReturns = new Map<ReturnKind, HostedPageReturn>();

function deliverReturn(handler: ReturnHandler, hostedReturn: HostedPageReturn): void {
  try {
    void Promise.resolve(handler(hostedReturn)).catch(() => undefined);
  } catch {
    // A failing rail must not take the router down with it.
  }
}

/**
 * Takes the `kind` returns that reach the app as links (F8's cold-start
 * recovery). One handler per kind; registering again replaces it. A return
 * that arrived before any handler did is delivered (once) on the next
 * microtask, not inside this call. Returns an unregister.
 */
export function registerReturnHandler(kind: ReturnKind, handler: ReturnHandler): () => void {
  returnHandlers.set(kind, handler);
  if (unhandledReturns.has(kind)) {
    void Promise.resolve().then(() => {
      const waiting = unhandledReturns.get(kind);
      // Still this rail's to take (not unregistered, replaced or signed out meanwhile).
      if (!waiting || returnHandlers.get(kind) !== handler) return;
      unhandledReturns.delete(kind);
      deliverReturn(handler, waiting);
    });
  }
  return () => {
    if (returnHandlers.get(kind) === handler) returnHandlers.delete(kind);
  };
}

// A return parked for one member is never handed to the next member's rail.
registerSignOutCleaner('nav.hostedPageReturns', () => unhandledReturns.clear());

// ---------------------------------------------------------------------------
// Routing

/** Acts on one link. Returns what it was. Never throws. */
export function handleDeepLink(url: string | null | undefined): DeepLink {
  const link = parseDeepLink(url);
  switch (link.kind) {
    case 'scan':
      useIntentStore.getState().parkScanVenue(link.venueId);
      break;
    case 'auth':
      if (isSocialReturnUrl(link.url)) void completeSocialReturn(link.url);
      else void handleAuthCallback(link.url);
      break;
    case 'return': {
      useIntentStore.getState().cancelExploreLaunchPresentation();
      const handler = returnHandlers.get(link.hostedReturn.kind);
      if (handler) deliverReturn(handler, link.hostedReturn);
      else unhandledReturns.set(link.hostedReturn.kind, link.hostedReturn);
      break;
    }
    default:
      break;
  }
  return link;
}

/**
 * The last launch link handled in this process.
 *
 * WHY THE LAUNCH LINK IS READ AT EVERY START. On Android the JS runtime
 * outlives the Activity: when Android destroys the Activity but keeps the
 * process (back on the first screen on Android 11 and older, memory
 * pressure, "Don't keep activities"), the next link starts a NEW Activity,
 * the app remounts, and React Native delivers that link only through
 * `getInitialURL` (the `url` event fires only for a link that reaches a
 * running Activity). Reading it once per process would drop it: a poster
 * link would open the app without reaching Scan, a payment return behind a
 * Custom Tab would be lost. Only the same link again is skipped: a relaunch
 * from Recents replays the Activity's original link.
 */
let lastLaunchUrl: string | null = null;

/**
 * Listens for links for the life of the app: the one that started it (each
 * time the app mounts, see `lastLaunchUrl`), then every one that arrives.
 * Returns a stop.
 */
export function startDeepLinks(): () => void {
  const subscription = Linking.addEventListener('url', ({ url }) => {
    handleDeepLink(url);
  });
  Linking.getInitialURL()
    .then((url) => {
      if (!url || url === lastLaunchUrl) return;
      lastLaunchUrl = url;
      handleDeepLink(url);
    })
    .catch(() => undefined);
  return () => subscription.remove();
}

/** Back to a fresh process (tests). */
export function resetDeepLinksForTests(): void {
  lastLaunchUrl = null;
  returnHandlers.clear();
  unhandledReturns.clear();
}
