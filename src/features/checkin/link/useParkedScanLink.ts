/**
 * The Scan tab takes a check-in link's venue: the Android port of iOS
 * `CheckInView.consumePendingScan` (Views/CheckIn/CheckInView.swift) and the
 * Scan half of `MainTabView`'s link handling.
 *
 * A link (a printed poster's App Link, `lifepass://scan?v=`) only PARKS its
 * venue (src/app/deepLinks.ts, the intent store), and the tabs shell brings
 * Scan forward (src/navigation/TabNavigator.tsx). This hook is the last step:
 * once the Scan tab's own scanner is on screen it takes the venue, ONCE, and
 * hands it to the walk-in flow with `fromLink: true`, which stops on
 * "Check in at <venue>?" before anything is recorded. A link never checks
 * anyone in by itself: venue ids are public and any page or message can
 * open such a link (iOS 2.5.0).
 *
 * WHEN. On the Scan tab's first screen only (the scanner pushed from a venue
 * leaves links to it), and only while that screen is focused, so the flow's
 * sheets open over the scanner. A link that arrives while something is pushed
 * over the scanner on the Scan tab's own stack (Profile from the person
 * button) brings the scanner back first, as iOS rebuilds the tab on a switch.
 * One that arrives while a root modal covers the tabs waits until it closes;
 * one that arrives signed out waits for the sign-in (the tabs mount then, on
 * Scan); sign-out forgets it (the intent store's cleaner).
 */
import { useEffect, useRef, useState } from 'react';

import { useIntentStore } from '../../../stores/intentStore';

/** The little of a stack screen's navigation this needs. */
export interface ScanLinkNavigation {
  isFocused(): boolean;
  getParent(): { isFocused(): boolean; addListener(event: 'focus', listener: () => void): () => void } | undefined;
  popToTop(): void;
}

export interface ParkedScanLinkOptions {
  /** The Scan tab's own first screen (false for the pushed scanner). */
  readonly enabled: boolean;
  /** The scanner screen is focused. */
  readonly isFocused: boolean;
  readonly navigation: ScanLinkNavigation;
  /** Start the linked walk-in (lock the QR first, then `startWalkIn(id, { fromLink: true })`). */
  readonly onLink: (venueId: string) => void;
}

export function useParkedScanLink({ enabled, isFocused, navigation, onLink }: ParkedScanLinkOptions): void {
  const pending = useIntentStore((s) => s.pendingScanVenueId);
  const latestOnLink = useRef(onLink);
  latestOnLink.current = onLink;
  // The Scan TAB coming forward (the shell's switch) while this screen is
  // still covered by a page on its own stack: re-run the check below.
  const [tabFocusCount, setTabFocusCount] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    return navigation.getParent()?.addListener('focus', () => setTabFocusCount((n) => n + 1));
  }, [enabled, navigation]);

  useEffect(() => {
    if (!enabled || pending === null) return;
    if (!isFocused) {
      // On the Scan tab, under a page pushed on its stack: back to the scanner.
      if (navigation.getParent()?.isFocused()) navigation.popToTop();
      return;
    }
    // AFTER THE SHELL HAS SPOKEN. At a cold start the tabs open on Scan
    // because a venue is parked, and the shell's own first-appearance effect,
    // which runs after this screen's (a parent's effects run after its
    // children's), decides the tab by asking whether a venue is still parked.
    // Taking it in this commit would answer "no" and the shell would switch
    // away (to a tapped notification's Plan, say) under the walk-in's
    // question. So the venue is taken on the next turn, if this scanner is
    // still the screen in front.
    const timer = setTimeout(() => {
      if (!navigation.isFocused()) return;
      const venueId = useIntentStore.getState().takeScanVenue();
      if (venueId) latestOnLink.current(venueId);
    }, 0);
    return () => clearTimeout(timer);
  }, [enabled, pending, isFocused, tabFocusCount, navigation]);
}
