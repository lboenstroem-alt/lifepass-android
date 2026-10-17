/**
 * A refusal's next step, taken: the Android port of iOS `RefusalStepPresenter`
 * (Views/Booking/BookingConfirmComponents.swift, 2.5.5).
 *
 * When the server refuses a booking, a check-in, a cancel or a purchase, the
 * screen shows the refusal's copy (src/api/refusals.ts) and, when there is
 * one, its next step as the panel's button or the dialog's second button.
 * This file says where each step goes, using screens the app already has:
 *
 *   See plans                    the Plans modal (closing it re-checks)
 *   Manage / Resume membership   Account
 *   Cancel deletion              the deletion sheet (ACCT-4; closing it re-checks), Account until it lands
 *   Verify identity              the Kenni sheet, in the app
 *   My bookings, Refresh         Profile on Bookings
 *   Book a time                  the venue's page, when the screen knows its slug
 *   Add nationality              the web profile (no in-app editor yet)
 *   Contact support              the support address
 *
 * A screen takes its OWN steps first (`local`): the booking screens' Choose
 * another time, Change guests and Try again; My bookings' Refresh and Try
 * again. A step neither the screen nor this file can take is never offered as
 * a button (`presentsRefusalStep`), so a refusal with nowhere to go is an
 * OK-only dialog. A refusal never opens the pay rail.
 *
 * WHERE A PAGE OPENS. iOS presents every destination as a sheet over the
 * refusing screen. Here a screen in a tab pushes the page onto its tab (the
 * tab bar stays; back returns to the refusal), and a root modal (Plans, the
 * classes sheet) gets it in the shared sheet over itself, so closing it
 * lands back on the modal as on iOS (./sharedSheet.ts). A refusal shown in a
 * UI-kit sheet closes that sheet first (`beforeOpen`): sheets are drawn over
 * every page, and the page would open under it.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef } from 'react';
import { Linking } from 'react-native';

import { REFUSAL_SUPPORT_URL, REFUSAL_WEB_PROFILE_URL, type RefusalCta } from '../api/refusals';
import { openAccountDeletion } from '../features/account/deletion';
import { openKenniSheet } from '../features/kenni';
import { useAppNavigation } from './hooks';
import { openSharedRoute, type SharedRouteNavigation } from './sharedSheet';

/** Where a step goes when the screen does not take it (iOS `RefusalStepPresenter.Destination`). */
export type RefusalDestination =
  | { readonly kind: 'plans' }
  | { readonly kind: 'account' }
  | { readonly kind: 'deletion' }
  | { readonly kind: 'identity' }
  | { readonly kind: 'bookings' }
  | { readonly kind: 'venue'; readonly slug: string };

/** iOS `destination(for:venueSlug:)`: a screen to open for `cta`, or null. */
export function refusalDestination(cta: RefusalCta, venueSlug: string | null | undefined): RefusalDestination | null {
  switch (cta) {
    case 'seePlans':
      return { kind: 'plans' };
    case 'manageMembership':
    case 'resumeMembership':
      return { kind: 'account' };
    case 'cancelDeletion':
      return { kind: 'deletion' };
    case 'verifyIdentity':
      return { kind: 'identity' };
    case 'myBookings':
    case 'refreshBookings':
      return { kind: 'bookings' };
    case 'bookATime':
      return venueSlug ? { kind: 'venue', slug: venueSlug } : null;
    default:
      return null;
  }
}

/** iOS `presents(_:venueSlug:)`: true when this file can take `cta` on its own. */
export function presentsRefusalStep(cta: RefusalCta, venueSlug: string | null | undefined): boolean {
  if (cta === 'addNationality' || cta === 'contactSupport') return true;
  return refusalDestination(cta, venueSlug) !== null;
}

/** The link a step opens outside the app, or null. */
export function refusalLink(cta: RefusalCta): string | null {
  switch (cta) {
    case 'addNationality':
      return REFUSAL_WEB_PROFILE_URL;
    case 'contactSupport':
      return REFUSAL_SUPPORT_URL;
    default:
      return null;
  }
}

export interface RefusalStepOptions {
  /** The venue "Book a time" opens, when the screen knows it. */
  readonly venueSlug?: string | null;
  /** The screen's own steps; true when it took the step. */
  readonly local?: (cta: RefusalCta) => boolean;
  /**
   * Runs when the member comes back from a step that opened something (the
   * Plans modal, Account, the Kenni sheet...): the booking screens re-check
   * the refused selection, since a plan may have been bought meanwhile.
   */
  readonly onReturn?: () => void;
  /**
   * Runs just before a step opens a page or a modal (Plans, Account, Profile,
   * a venue's page). A refusal shown in a UI-kit sheet closes the sheet here:
   * sheets are drawn over every page, and the page would open under it. Not
   * run for the Kenni or deletion sheet, which open over a sheet, as on iOS.
   */
  readonly beforeOpen?: () => void;
}

/** Who performs the steps: a screen's navigation, and what opens things outside the navigator. */
export interface RefusalStepDeps {
  /** The refusing screen's own `navigation` (it says whether a page can be pushed there). */
  readonly navigation: SharedRouteNavigation;
  readonly openUrl?: (url: string) => void;
  readonly openKenni?: typeof openKenniSheet;
  readonly openDeletion?: typeof openAccountDeletion;
}

/**
 * What a step did: `local` (the screen took it), the destination opened
 * (`deletion` is Account standing in for the deletion sheet), `deletionSheet`
 * (ACCT-4's sheet opened over the screen), `link`, or `none` (nothing can
 * take it; a screen that only offers what `presentsRefusalStep` allows never
 * gets here).
 */
export type RefusalStepOutcome = RefusalDestination['kind'] | 'deletionSheet' | 'local' | 'link' | 'none';

/**
 * Where the member comes back from a step that opened something: a page or a
 * modal (`focus`, the refusing screen's next focus) or a sheet over the
 * screen (`sheetClose`: `onClosed` runs; no focus change follows a sheet).
 */
export function refusalReturnBy(outcome: RefusalStepOutcome): 'focus' | 'sheetClose' | null {
  switch (outcome) {
    case 'plans':
    case 'account':
    case 'bookings':
    case 'venue':
    case 'deletion':
      return 'focus';
    case 'identity':
    case 'deletionSheet':
      return 'sheetClose';
    default:
      return null;
  }
}

/** Takes one step (see `RefusalStepOutcome`). */
export function takeRefusalStep(
  cta: RefusalCta,
  deps: RefusalStepDeps,
  options: RefusalStepOptions & { readonly onClosed?: () => void } = {},
): RefusalStepOutcome {
  if (options.local?.(cta)) return 'local';
  const link = refusalLink(cta);
  if (link) {
    (deps.openUrl ?? ((url: string) => void Linking.openURL(url).catch(() => undefined)))(link);
    return 'link';
  }
  const destination = refusalDestination(cta, options.venueSlug);
  if (!destination) return 'none';
  const { navigation } = deps;
  const beforeOpen = () => options.beforeOpen?.();
  switch (destination.kind) {
    case 'plans':
      beforeOpen();
      // A root modal: reachable from every screen and sheet.
      navigation.navigate('Plans');
      break;
    case 'account':
      beforeOpen();
      openSharedRoute(navigation, 'Account');
      break;
    case 'deletion':
      // The deletion sheet when ACCT-4 has it (closing it re-checks, as the
      // Kenni sheet does); Account (where deletion lives) until then.
      if ((deps.openDeletion ?? openAccountDeletion)({ onClose: () => options.onClosed?.() })) {
        return 'deletionSheet';
      }
      beforeOpen();
      openSharedRoute(navigation, 'Account');
      break;
    case 'identity':
      (deps.openKenni ?? openKenniSheet)({
        bodyKey: 'kenni.onboarding_body',
        onClose: () => options.onClosed?.(),
      });
      break;
    case 'bookings':
      beforeOpen();
      openSharedRoute(navigation, 'Profile', { initialTab: 'bookings' });
      break;
    case 'venue':
      beforeOpen();
      openSharedRoute(navigation, 'VenueDetail', { slug: destination.slug });
      break;
  }
  return destination.kind;
}

/**
 * The hook a refusing screen uses: `offers(cta)` says whether to draw the
 * step's button, `take(cta)` takes it. `onReturn` runs once the member is
 * back on this screen after a step that left it (the next focus), or when
 * the Kenni or deletion sheet closes (never also at a later focus: a sheet
 * opens over this screen, so no focus marks the return).
 */
export function useRefusalStep(options: RefusalStepOptions = {}): {
  offers: (cta: RefusalCta, screenTakes?: (cta: RefusalCta) => boolean) => boolean;
  take: (cta: RefusalCta) => void;
} {
  const navigation = useAppNavigation();
  const latest = useRef(options);
  latest.current = options;
  const awaitingReturn = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!awaitingReturn.current) return;
      awaitingReturn.current = false;
      latest.current.onReturn?.();
    }, []),
  );

  const offers = useCallback(
    (cta: RefusalCta, screenTakes?: (step: RefusalCta) => boolean) =>
      (screenTakes?.(cta) ?? false) || presentsRefusalStep(cta, latest.current.venueSlug),
    [],
  );

  const take = useCallback(
    (cta: RefusalCta) => {
      const { venueSlug, local, onReturn, beforeOpen } = latest.current;
      const outcome = takeRefusalStep(
        cta,
        { navigation },
        { venueSlug, local, onReturn, beforeOpen, onClosed: () => latest.current.onReturn?.() },
      );
      // A step that pushed or presented a screen: re-check when the member is
      // back here. A sheet re-checks as it closes (`onClosed`) instead.
      awaitingReturn.current = refusalReturnBy(outcome) === 'focus';
    },
    [navigation],
  );

  return { offers, take };
}
