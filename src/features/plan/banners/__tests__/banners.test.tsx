/**
 * The banners at the top of Plan: ONE status banner, in the order of iOS
 * 3.5 (past due, then a failed outbox item, then offline); the failed item's
 * two decisions, Discard behind a confirmation; the adopted banner's three
 * honest lines; the bookings hint and its x.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { stubApiClientPerTest } from '../../../../api/testing';
import { DialogHost } from '../../../../components/ui';
import { TransportError } from '../../../../api';
import { ReminderKeys, useHealthStore } from '../../../../health';
import { HealthFormat, translate } from '../../../../i18n';
import { planVisitsKey } from '../../../../navigation/profile';
import { freshPlan, MEMBER, memberProfile, recordAnalytics, settle, signIn } from '../../__tests__/planFixtures';
import { ADOPTED_BANNER_KEYS, adoptedBannerKey, reminderDeniedKey } from '../../shell/adoptedBanner';
import { installPlanOutbox, type PlanOutboxItem } from '../../shell/bridges';
import { attachPlanNavigator, refreshOutbox, usePlanShell } from '../../shell/planShell';
import AdoptedBanner from '../AdoptedBanner';
import BookingsHintBanner from '../BookingsHintBanner';
import PlanStatusBanner, { planStatusBanner } from '../PlanStatusBanner';
import ProposalWaitingRow from '../ProposalWaitingRow';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const WORKOUT: PlanOutboxItem = { id: 'w-1', kind: 'workout' };
const MEAL: PlanOutboxItem = { id: 'm-1', kind: 'meal' };

function navigation() {
  const calls: { name: string; params?: object }[] = [];
  attachPlanNavigator({ navigate: (name, params) => calls.push({ name, params }), popToTop: () => undefined });
  return calls;
}

beforeEach(() => freshPlan());
afterEach(async () => settle());

describe('which status banner', () => {
  it('money first, then what quietly loses work, then offline', () => {
    expect(planStatusBanner({ isPastDue: true, failedItems: [WORKOUT], isOffline: true })).toEqual({ kind: 'pastDue' });
    expect(planStatusBanner({ isPastDue: false, failedItems: [MEAL, WORKOUT], isOffline: true })).toEqual({ kind: 'outbox', item: MEAL });
    expect(planStatusBanner({ isPastDue: false, failedItems: [], isOffline: true })).toEqual({ kind: 'offline' });
    expect(planStatusBanner({ isPastDue: false, failedItems: [], isOffline: false })).toBeNull();
  });
});

describe('the status banner on screen', () => {
  it('past due fixes the payment in Account', async () => {
    signIn(memberProfile({ access: 'past_due' }));
    const calls = navigation();
    await render(<PlanStatusBanner />);
    expect(screen.getByText(en('health.past_due.banner'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('health.past_due.cta') }));
    expect(calls).toEqual([{ name: 'Account', params: undefined }]);
  });

  it('offline says when what is shown was saved', async () => {
    signIn();
    const cachedAt = new Date('2026-10-17T08:05:00Z');
    useHealthStore.setState({ lastError: new TransportError('offline'), cachedAt });
    await render(<PlanStatusBanner />);
    expect(screen.getByText(en('health.offline.banner', { time: HealthFormat.time(cachedAt) }))).toBeOnTheScreen();
  });

  it('a failed workout: Save as extra reposts it; Discard asks first', async () => {
    signIn(memberProfile({ consent: false }));
    const saved: string[] = [];
    const discarded: string[] = [];
    let failed: PlanOutboxItem[] = [WORKOUT];
    installPlanOutbox('workout', {
      flush: async () => undefined,
      failedItems: () => failed,
      saveAsExtra: async (item) => {
        saved.push(item.id);
        failed = [];
      },
      discard: async (item) => {
        discarded.push(item.id);
        failed = [];
      },
    });
    refreshOutbox();
    const events = recordAnalytics();
    await render(
      <>
        <PlanStatusBanner />
        <DialogHost />
      </>,
    );
    expect(screen.getByText(en('plan.outbox.failed'))).toBeOnTheScreen();
    // Discard: a confirmation first, Cancel keeps it.
    await fireEvent.press(screen.getByRole('button', { name: en('plan.outbox.discard') }));
    expect(screen.getByText(en('plan.outbox.discard_title'))).toBeOnTheScreen();
    expect(discarded).toEqual([]);
    await fireEvent.press(screen.getByRole('button', { name: en('common.cancel') }));
    expect(discarded).toEqual([]);

    await fireEvent.press(screen.getByRole('button', { name: en('plan.outbox.save_extra') }));
    await waitFor(() => expect(saved).toEqual(['w-1']));
    await waitFor(() => expect(screen.queryByTestId('plan.banner.outbox')).toBeNull());
    expect(events.some((e) => e.event === 'outbox_item_discarded')).toBe(false);
  });

  it('a failed meal can only be discarded, and the discard is reported', async () => {
    signIn(memberProfile({ consent: false }));
    let failed: PlanOutboxItem[] = [MEAL];
    installPlanOutbox('meal', {
      flush: async () => undefined,
      failedItems: () => failed,
      discard: async () => {
        failed = [];
      },
    });
    refreshOutbox();
    const events = recordAnalytics();
    await render(
      <>
        <PlanStatusBanner />
        <DialogHost />
      </>,
    );
    expect(screen.getByText(en('plan.outbox.meal_failed'))).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('plan.outbox.save_extra') })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.outbox.discard') }));
    const confirm = screen.getAllByRole('button', { name: en('plan.outbox.discard') }).at(-1)!;
    await fireEvent.press(confirm);
    await waitFor(() => expect(events).toContainEqual({ event: 'outbox_item_discarded', params: { kind: 'meal' } }));
    await waitFor(() => expect(screen.queryByTestId('plan.banner.outbox')).toBeNull());
  });
});

describe('the adopted banner', () => {
  it('has all three lines in both languages', () => {
    for (const key of ADOPTED_BANNER_KEYS) {
      expect(translate(key, 'en')).not.toBe(key);
      expect(translate(key, 'is')).not.toBe(key);
    }
    expect(adoptedBannerKey(false, true)).toBe('plan.adopted.banner_plain');
    expect(adoptedBannerKey(true, true)).toBe('plan.adopted.banner_no_notes');
    expect(adoptedBannerKey(true, false)).toBe('plan.adopted.banner');
  });

  it('promises the notes only when the toggle is on and the phone allows them; Change opens the reminders', async () => {
    signIn();
    const calls = navigation();
    await AsyncStorage.setItem(reminderDeniedKey(MEMBER), 'true');
    usePlanShell.setState({ adoptedBanner: { startsOn: '2026-10-19' }, adoptedBannerShown: true });
    await render(<AdoptedBanner />);
    expect(await screen.findByText(en('plan.adopted.banner_no_notes', { date: 'Mon 19 Oct' }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.adopted.reminders') }));
    expect(calls).toEqual([{ name: 'BodyAndGoals', params: { anchor: 'reminders' } }]);
  });

  it('says only the date to a member who turned the notes off', async () => {
    signIn();
    await AsyncStorage.setItem(ReminderKeys.workoutDay(MEMBER), 'false');
    usePlanShell.setState({ adoptedBanner: { startsOn: null }, adoptedBannerShown: true });
    await render(<AdoptedBanner />);
    expect(await screen.findByText(en('plan.adopted.banner_plain', { date: '' }))).toBeOnTheScreen();
  });

  it('is not there without an adopt', async () => {
    signIn();
    await render(<AdoptedBanner />);
    await act(async () => settle());
    expect(screen.queryByTestId('plan.banner.adopted')).toBeNull();
  });
});

describe('the bookings hint', () => {
  it('opens bookings, and its x ends it for good', async () => {
    signIn();
    const calls = navigation();
    const events = recordAnalytics();
    usePlanShell.setState({ bookingsHintFor: MEMBER });
    await render(<BookingsHintBanner />);
    expect(screen.getByText(en('plan.where_bookings'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.open_bookings') }));
    expect(calls).toEqual([{ name: 'Profile', params: { initialTab: 'bookings' } }]);
    await fireEvent.press(screen.getByRole('button', { name: en('common.done') }));
    expect(screen.queryByTestId('plan.banner.bookingsHint')).toBeNull();
    expect(events).toContainEqual({ event: 'profile_hint_dismissed', params: {} });
    await waitFor(async () => expect(await AsyncStorage.getItem(planVisitsKey(MEMBER))).toBe('99'));
  });

  it('never shows to a minor, or for a member who is not the one on screen', async () => {
    signIn(memberProfile({ access: 'minor' }));
    usePlanShell.setState({ bookingsHintFor: MEMBER });
    await render(<BookingsHintBanner />);
    expect(screen.queryByTestId('plan.banner.bookingsHint')).toBeNull();
    await screen.unmount();
    signIn();
    usePlanShell.setState({ bookingsHintFor: 'someone-else' });
    await render(<BookingsHintBanner />);
    expect(screen.queryByTestId('plan.banner.bookingsHint')).toBeNull();
  });
});

describe('a proposal over a live plan', () => {
  it('opens the proposal in the programme overview', async () => {
    signIn();
    const calls = navigation();
    const events = recordAnalytics();
    await render(<ProposalWaitingRow programId="p-next" />);
    expect(screen.getByText(en('plan.proposal_waiting'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.review') }));
    expect(calls).toEqual([{ name: 'ProgramOverview', params: { programId: 'p-next', mode: 'proposal' } }]);
    expect(events).toContainEqual({ event: 'plan_proposal_review_opened', params: {} });
  });
});
