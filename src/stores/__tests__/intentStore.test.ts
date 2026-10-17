/**
 * The intent store: what a link, a notification or another screen parks for
 * the tabs shell or a screen to take once. Ports the router half of iOS
 * CheckInLinkTests (a parked link survives sign-in, sign-out forgets it) and
 * the AppState rules around `pendingTab`, `pendingScanVenueId` and the
 * launch presentation.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../api/testing';
import { KENNITALA_PROMPT_DISMISSED_KEY, useAppStore } from '../appStore';
import { isPlanActionFresh, PLAN_ACTION_WINDOW_MS, resetIntentStoreForTests, useIntentStore } from '../intentStore';
import { freshStorePerTest, MEMBER_A, PLUS_SUBSCRIPTION, profileJSON } from './storeHarness';

stubApiClientPerTest();
freshStorePerTest();

beforeEach(() => resetIntentStoreForTests());

const intents = () => useIntentStore.getState();
const app = () => useAppStore.getState();

const VENUE = '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f';

function serveMember(options: Parameters<typeof profileJSON>[0] = {}) {
  api.on('GET', '/profile', Reply.ok(profileJSON({ kennitalaVerified: true, ...options })));
  api.on('GET', '/subscriptions', Reply.ok(PLUS_SUBSCRIPTION));
}

describe('a check-in link', () => {
  it('only parks a venue id, lower-cased, and posts nothing', () => {
    expect(intents().parkScanVenue(VENUE.toUpperCase())).toBe(true);
    expect(intents().pendingScanVenueId).toBe(VENUE);
    expect(api.sentAll('/check-ins/walk-in', 'POST')).toHaveLength(0);
  });

  it('ignores anything that is not a venue UUID', () => {
    for (const bad of ['', 'laugar', '3f2b8c1e-7d4a-4b6e-9c2f', '3f2b8c1e-7d4a-0b6e-9c2f-1a2b3c4d5e6f']) {
      expect(intents().parkScanVenue(bad)).toBe(false);
    }
    expect(intents().pendingScanVenueId).toBeNull();
    expect(intents().scanArrivedThisSession).toBe(false);
  });

  it('is taken once, and the session still remembers a link arrived', () => {
    intents().parkScanVenue(VENUE);
    expect(intents().takeScanVenue()).toBe(VENUE);
    expect(intents().takeScanVenue()).toBeNull();
    expect(intents().scanArrivedThisSession).toBe(true);
  });

  it('cancels the launch-time Explore presentation', () => {
    intents().setExploreLaunchPresentation(true);
    intents().parkScanVenue(VENUE);
    expect(intents().exploreLaunchPresentation).toBe(false);
  });

  it('cancels it for good: launch deciding Explore after the link opens no filters', () => {
    intents().parkScanVenue(VENUE);
    intents().setExploreLaunchPresentation(true);
    expect(intents().exploreLaunchPresentation).toBe(false);
  });

  it('counts every arrival, the same venue again included', () => {
    expect(intents().scanLinkCount).toBe(0);
    intents().parkScanVenue(VENUE);
    intents().parkScanVenue(VENUE);
    expect(intents().scanLinkCount).toBe(2);
    intents().parkScanVenue('not a venue');
    expect(intents().scanLinkCount).toBe(2);
  });

  it('retracts a Kenni nudge on screen without counting it as dismissed', async () => {
    useAppStore.setState({ pendingKennitalaPrompt: true });
    intents().parkScanVenue(VENUE);
    expect(app().pendingKennitalaPrompt).toBe(false);
    expect(await AsyncStorage.getItem(KENNITALA_PROMPT_DISMISSED_KEY)).toBeNull();
  });

  it('survives a sign-in (a link that opened a signed-out app is waiting)', async () => {
    serveMember();
    intents().parkScanVenue(VENUE);
    await app().handleSignIn(MEMBER_A);
    expect(app().isAuthenticated).toBe(true);
    expect(intents().pendingScanVenueId).toBe(VENUE);
  });

  // iOS CheckInLinkTests.testSignOutForgetsAParkedLink
  it('is forgotten at sign-out, so it never opens under the next member', async () => {
    serveMember();
    await app().handleSignIn(MEMBER_A);
    intents().parkScanVenue(VENUE);
    await app().handleSignOut();
    expect(intents().pendingScanVenueId).toBeNull();
  });

  it('holds the post-sign-up Kenni nudge back for the rest of the session', async () => {
    serveMember({ kennitalaVerified: false, createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });
    // Without a link this account gets the nudge...
    await app().handleSignIn(MEMBER_A);
    expect(app().pendingKennitalaPrompt).toBe(true);
    await app().handleSignOut();
    // ... and with one this session, even after the Scan tab took the venue, it does not.
    intents().parkScanVenue(VENUE);
    intents().takeScanVenue();
    await app().handleSignIn(MEMBER_A);
    expect(app().pendingKennitalaPrompt).toBe(false);
  });
});

describe('a parked tab', () => {
  it('cancels the Explore presentation unless it is Explore', () => {
    intents().setExploreLaunchPresentation(true);
    intents().requestTab('Explore');
    expect(intents().exploreLaunchPresentation).toBe(true);
    intents().requestTab('Plan');
    expect(intents().exploreLaunchPresentation).toBe(false);
    expect(intents().pendingTab).toBe('Plan');
    intents().clearPendingTab();
    expect(intents().pendingTab).toBeNull();
    intents().setExploreLaunchPresentation(true);
    expect(intents().exploreLaunchPresentation).toBe(false);
  });
});

describe('the launch presentation', () => {
  it('is taken once', () => {
    intents().setExploreLaunchPresentation(true);
    expect(intents().takeExploreLaunchPresentation()).toBe(true);
    expect(intents().takeExploreLaunchPresentation()).toBe(false);
  });

  it('is cancelled by a payment or card return', () => {
    intents().setExploreLaunchPresentation(true);
    intents().cancelExploreLaunchPresentation();
    expect(intents().takeExploreLaunchPresentation()).toBe(false);
  });
});

describe('a parked Plan action', () => {
  it('is taken once, with when it was parked', () => {
    intents().parkPlanAction({ kind: 'openWeeklyCheckIn' }, 1_000);
    expect(intents().takePlanAction(2_000)).toEqual({ action: { kind: 'openWeeklyCheckIn' }, parkedAt: 1_000 });
    expect(intents().takePlanAction(2_000)).toBeNull();
  });

  it('is worth performing for five minutes, and dropped after', () => {
    expect(PLAN_ACTION_WINDOW_MS).toBe(5 * 60 * 1000);
    const parked = { action: { kind: 'openFeedbackNote' as const }, parkedAt: 0 };
    expect(isPlanActionFresh(parked, PLAN_ACTION_WINDOW_MS)).toBe(true);
    expect(isPlanActionFresh(parked, PLAN_ACTION_WINDOW_MS + 1)).toBe(false);

    intents().parkPlanAction({ kind: 'startWorkout', sessionId: 's-1' }, 0);
    expect(intents().takePlanAction(PLAN_ACTION_WINDOW_MS + 1)).toBeNull();
    expect(intents().pendingPlanAction).toBeNull();
  });
});

describe('the Coach and Explore requests', () => {
  it('are taken once', () => {
    intents().parkCoachPrompt('  Swimming pools near me  ');
    expect(intents().takeCoachPrompt()).toBe('Swimming pools near me');
    expect(intents().takeCoachPrompt()).toBeNull();

    intents().parkCoachProgram({ kind: 'nextBlock', programId: 'p-1' });
    expect(intents().takeCoachProgram()).toEqual({ kind: 'nextBlock', programId: 'p-1' });
    expect(intents().takeCoachProgram()).toBeNull();

    intents().requestExploreSights();
    expect(intents().takeExploreSights()).toBe(true);
    expect(intents().takeExploreSights()).toBe(false);
  });

  it('an empty prompt parks nothing', () => {
    intents().parkCoachPrompt('   ');
    expect(intents().pendingCoachPrompt).toBeNull();
  });
});

describe('sign-out', () => {
  it('forgets everything a member parked, and keeps that a link arrived this session', async () => {
    serveMember();
    await app().handleSignIn(MEMBER_A);
    intents().parkScanVenue(VENUE);
    intents().requestTab('Plan');
    intents().parkPlanAction({ kind: 'openDiary', date: '2026-10-17' });
    intents().parkCoachPrompt('My knee hurts when I run');
    intents().parkCoachProgram({ kind: 'planTab' });
    intents().requestExploreSights();
    intents().setScanCameraLive(true);
    intents().setExploreLaunchPresentation(true);

    await app().handleSignOut();

    expect(intents()).toMatchObject({
      pendingTab: null,
      pendingPlanAction: null,
      pendingCoachPrompt: null,
      pendingCoachProgram: null,
      pendingExploreSights: false,
      pendingScanVenueId: null,
      exploreLaunchPresentation: false,
      scanCameraLive: false,
      scanArrivedThisSession: true,
    });
  });
});
