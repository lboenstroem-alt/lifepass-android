/**
 * The phone's half of an account deletion (iOS
 * `AccountDeletionSheet.finishDeletionIfNeeded`), run against the REAL health
 * store: the member's health folder, reminder keys and health notifications
 * go, every package's health-wipe hook hears `account_deletion`, the Coach's
 * saved chats and their owner go (iOS `CoachViewModel.forgetSavedSessions()`,
 * called by name), another member's folder stays, and the profile is read
 * again whatever the wipe did.
 *
 * The Coach's keys are spelled out here, not imported: they are the keys iOS
 * uses, and a test that read them from the Coach would pass whatever they
 * were renamed to.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fileSystemState } from '@test/mocks/expoFileSystem';
import { notificationsState } from '@test/mocks/expoNotifications';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { decodeProfile } from '../../../../api/profile';
import { healthLocalStore, registerHealthWipeHook, ReminderKeys, useHealthStore, type HealthWipeContext } from '../../../../health';
import { scheduleAt } from '../../../../notifications';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import * as coach from '../../../coach';
import { finishAccountDeletionOnPhone, memberForDeletionWipe } from '../localWipe';

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const OTHER = '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22';

const PROFILE = { id: MEMBER, locale: 'en', kennitalaVerified: true, marketingConsent: false };

/** Where the Coach keeps its saved chats, and whose they are (iOS uses the same keys). */
const COACH_SESSIONS = 'coach.sessions.v1';
const COACH_SESSIONS_OWNER = 'coach.sessions.owner';

async function seedCoachChats(): Promise<void> {
  await AsyncStorage.setItem(
    COACH_SESSIONS,
    JSON.stringify([{ id: 's1', title: 'Is my weight ok?', date: '2026-10-17T09:00:00Z', messages: [] }]),
  );
  await AsyncStorage.setItem(COACH_SESSIONS_OWNER, MEMBER);
}

async function coachKeysLeft(): Promise<string[]> {
  const keys = await AsyncStorage.getAllKeys();
  return keys.filter((key) => key.startsWith('coach.sessions'));
}

const realWipe = useHealthStore.getState().wipeLocal;

beforeEach(() => {
  resetAppStoreForTests();
  useHealthStore.setState({ wipeLocal: realWipe, profileId: null });
});

afterEach(async () => {
  useHealthStore.setState({ wipeLocal: realWipe });
  resetAppStoreForTests();
  await healthLocalStore.settled();
});

describe('whose data the wipe is for', () => {
  it("the profile's id, else the session's user id, else nobody", () => {
    expect(memberForDeletionWipe()).toBeNull();
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: null });
    expect(memberForDeletionWipe()).toBe(MEMBER);
    useAppStore.setState({ userId: OTHER, profile: decodeProfile(PROFILE) });
    expect(memberForDeletionWipe()).toBe(MEMBER);
  });
});

describe('the wipe once the sheet has gone', () => {
  it("empties this member's health data on the phone, tells every hook why, and reads the profile again", async () => {
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: decodeProfile(PROFILE) });
    api.on('GET', '/profile', Reply.ok(PROFILE));
    fileSystemState.seed(`health/${MEMBER}/today.json`, '{}');
    fileSystemState.seed(`health/${MEMBER}/outbox.json`, '[]');
    fileSystemState.seed(`health/${OTHER}/today.json`, '{}');
    await AsyncStorage.setItem(ReminderKeys.workoutDay(MEMBER), '1');
    await seedCoachChats();
    const later = new Date(Date.now() + 3_600_000);
    await scheduleAt('health.weeklycheckin', later, { title: 'a', body: 'b' }, 'health');
    await scheduleAt('engagement.stayactive', later, { title: 'a', body: 'b' }, 'engagement');
    const seen: HealthWipeContext[] = [];
    const unregister = registerHealthWipeHook('test.acct4', (context) => void seen.push(context));

    try {
      await finishAccountDeletionOnPhone(MEMBER);
      await healthLocalStore.settled();
    } finally {
      unregister();
    }

    expect(fileSystemState.files()).toEqual([`files/health/${OTHER}/today.json`]);
    expect(await AsyncStorage.getItem(ReminderKeys.workoutDay(MEMBER))).toBeNull();
    expect(notificationsState.scheduled().map((n) => n.identifier)).toEqual(['engagement.stayactive']);
    // The hook every package registers for what else must go (the Coach's
    // health messages and saved chats, the feedback summary).
    expect(seen).toEqual([{ profileId: MEMBER, reason: 'account_deletion' }]);
    // The Coach's saved chats and their owner, as iOS forgets them by name.
    expect(await coachKeysLeft()).toEqual([]);
    expect(api.sentAll('/profile').length).toBe(1);
  });

  it('a wipe that fails part-way still reads the profile, and never throws', async () => {
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: decodeProfile(PROFILE) });
    api.on('GET', '/profile', Reply.ok(PROFILE));
    const failing = jest.fn(async () => {
      throw new Error('disk full');
    });
    useHealthStore.setState({ wipeLocal: failing });
    await seedCoachChats();

    await expect(finishAccountDeletionOnPhone(MEMBER)).resolves.toBeUndefined();

    expect(failing).toHaveBeenCalledWith({ profileId: MEMBER, reason: 'account_deletion' });
    expect(await coachKeysLeft()).toEqual([]);
    expect(api.sentAll('/profile').length).toBe(1);
  });

  it("forgets the Coach's saved chats even when the wipe can name nobody, as iOS calls it unconditionally", async () => {
    // No profile, no session user, and a health store that never loaded:
    // the health wipe has nobody's folder to delete and returns at once.
    api.on('GET', '/profile', Reply.ok(PROFILE));
    await seedCoachChats();

    await finishAccountDeletionOnPhone(null);

    expect(await coachKeysLeft()).toEqual([]);
  });

  it('a Coach store that refuses the delete still reads the profile, and never throws', async () => {
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: decodeProfile(PROFILE) });
    api.on('GET', '/profile', Reply.ok(PROFILE));
    const refuse = jest.spyOn(coach, 'forgetSavedCoachSessions').mockRejectedValueOnce(new Error('storage locked'));

    try {
      await expect(finishAccountDeletionOnPhone(MEMBER)).resolves.toBeUndefined();
      expect(refuse).toHaveBeenCalledTimes(1);
    } finally {
      refuse.mockRestore();
    }

    expect(api.sentAll('/profile').length).toBe(1);
  });
});
