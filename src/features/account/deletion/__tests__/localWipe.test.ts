/**
 * The phone's half of an account deletion (iOS
 * `AccountDeletionSheet.finishDeletionIfNeeded`), run against the REAL health
 * store: the member's health folder, reminder keys and health notifications
 * go, every package's health-wipe hook hears `account_deletion` (the Coach's
 * saved chats ride on that hook once COACH-1 registers it), another member's
 * folder stays, and the profile is read again whatever the wipe did.
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
import { finishAccountDeletionOnPhone, memberForDeletionWipe } from '../localWipe';

stubApiClientPerTest();

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
const OTHER = '3c4c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c22';

const PROFILE = { id: MEMBER, locale: 'en', kennitalaVerified: true, marketingConsent: false };

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
    expect(api.sentAll('/profile').length).toBe(1);
  });

  it('a wipe that fails part-way still reads the profile, and never throws', async () => {
    useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile: decodeProfile(PROFILE) });
    api.on('GET', '/profile', Reply.ok(PROFILE));
    const failing = jest.fn(async () => {
      throw new Error('disk full');
    });
    useHealthStore.setState({ wipeLocal: failing });

    await expect(finishAccountDeletionOnPhone(MEMBER)).resolves.toBeUndefined();

    expect(failing).toHaveBeenCalledWith({ profileId: MEMBER, reason: 'account_deletion' });
    expect(api.sentAll('/profile').length).toBe(1);
  });
});
