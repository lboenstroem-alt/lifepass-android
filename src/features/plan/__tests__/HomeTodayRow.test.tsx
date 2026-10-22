/**
 * Home's Today row as Home mounts it (iOS HomeTodayRow and the
 * NavigationAccessibility UI tests `testTheHomeTodayRowReadsAsOneThing` and
 * `testStartOnHomeOpensTheRunner`): one element with a hint, a Start that
 * names what it starts, the hand-offs and their analytics, the done tile,
 * and nothing at all when there is nothing to say.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { decodeProfile } from '../../../api/profile';
import { decodeHealthDay, useHealthStore } from '../../../health';
import { restoreTestFontScale, setTestFontScale } from '../../../hooks/testing';
import { setCurrentLanguage, translate } from '../../../i18n';
import { useAppStore } from '../../../stores/appStore';
import { useWorkoutOutbox } from '../../runner';
import HomeTodayRow from '../HomeTodayRow';
import { freshPlan, MEMBER, recordAnalytics, settle, TODAY } from './planFixtures';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const SESSION = 'a2f1c3d4-5b6e-4f70-8a9b-0c1d2e3f4a5b';

/** The one line the row shows (drawn for the eye; TalkBack reads the row's own label). */
const title = () => screen.getByTestId('home.todayRow.title', { includeHiddenElements: true });

function signInWith(today: Record<string, unknown> | null, health: Record<string, unknown> = {}, locale = 'en') {
  const profile = decodeProfile({
    id: MEMBER,
    email: 'member@example.com',
    locale,
    kennitalaVerified: true,
    marketingConsent: false,
    health: {
      access: 'entitled',
      consent: { version: '2026-09-v1', consentedAt: '2026-09-20T10:00:00Z' },
      program: { id: 'p-1', status: 'active', weekNo: 2, weeks: 4, today },
      ...health,
    },
  });
  useAppStore.setState({ isAuthenticated: true, isLoading: false, userId: MEMBER, profile });
}

const strength = { sessionId: SESSION, kind: 'strength', title: 'Full body strength', minutes: 40, status: 'planned' };

async function renderRow(upcomingBookingId: string | null = null) {
  const onOpenPlan = jest.fn();
  const onStart = jest.fn();
  await render(<HomeTodayRow upcomingBookingId={upcomingBookingId} onOpenPlan={onOpenPlan} onStart={onStart} />);
  return { onOpenPlan, onStart };
}

beforeEach(() => {
  freshPlan();
  setTestFontScale(1);
});

afterEach(async () => {
  setCurrentLanguage('en');
  restoreTestFontScale();
  useWorkoutOutbox.setState({ items: [] });
  await settle();
});

it('reads as one thing, and Start names what it starts', async () => {
  signInWith(strength);
  await renderRow();
  const row = screen.getByTestId('home.todayRow');
  expect(row).toHaveProp('accessibilityLabel', 'Today · week 2 of 4. Full body strength, 40 min');
  expect(row).toHaveProp('accessibilityHint', en('a11y.opens_plan'));
  expect(screen.getByRole('button', { name: 'Start Full body strength, 40 min' })).toBeOnTheScreen();
});

it('Start hands the session to Plan, and the row opens Plan', async () => {
  const events = recordAnalytics();
  signInWith(strength);
  const { onStart, onOpenPlan } = await renderRow();
  await fireEvent.press(screen.getByRole('button', { name: 'Start Full body strength, 40 min' }));
  expect(onStart).toHaveBeenCalledWith(SESSION);
  expect(onOpenPlan).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('home.todayRow'));
  expect(onOpenPlan).toHaveBeenCalledTimes(1);
  expect(events).toEqual([
    { event: 'home_today_tapped', params: { kind: 'strength', action: 'start' } },
    { event: 'home_today_tapped', params: { kind: 'strength', action: 'open' } },
  ]);
});

it('speaks Icelandic', async () => {
  setCurrentLanguage('is');
  signInWith({ ...strength, minutes: 75 }, {}, 'is');
  await renderRow();
  expect(screen.getByTestId('home.todayRow')).toHaveProp('accessibilityLabel', 'Í dag · vika 2 af 4. Full body strength, 1 klst 15 mín');
  expect(screen.getByRole('button', { name: 'Byrja Full body strength, 1 klst 15 mín' })).toBeOnTheScreen();
});

it('a pool day is a plain row with no Start', async () => {
  signInWith({ ...strength, kind: 'swim', title: 'Easy swim', minutes: 30 });
  await renderRow();
  expect(title()).toHaveTextContent('Easy swim, 30 min');
  expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
});

it('a workout saved on this phone is done, with the tick, and no Start', async () => {
  signInWith(strength);
  useWorkoutOutbox.setState({
    items: [
      { id: 'i-1', sessionId: SESSION, body: { action: 'done' } as never, key: 'key-12345678', createdAt: new Date(), state: 'pending', converted: false },
    ],
  });
  await renderRow();
  expect(title()).toHaveTextContent(en('home.today.done'));
  expect(screen.getByTestId('home.todayRow.tile', { includeHiddenElements: true })).toHaveStyle({ backgroundColor: 'rgba(71,133,194,0.14)' });
  expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
});

it("the Plan read on this phone outranks the profile's older planned", async () => {
  signInWith(strength);
  useHealthStore.setState({
    today: decodeHealthDay({ date: TODAY, day: { date: TODAY, session: { id: SESSION, status: 'done', kind: 'strength' } } }),
  });
  await renderRow();
  expect(title()).toHaveTextContent(en('home.today.done'));
});

it('a class Home already shows is not announced twice', async () => {
  signInWith({ sessionId: SESSION, kind: 'class', title: 'Yoga', status: 'planned', hasBooking: true, bookingId: 'b-1', bookingTitle: 'Hot yoga', bookingStartsAt: '2026-10-21T18:00:00Z' });
  await renderRow('b-1');
  expect(screen.queryByTestId('home.todayRow')).toBeNull();
});

it('renders nothing for a member who is not entitled, has no consent or no plan today', async () => {
  signInWith(strength, { access: 'past_due' });
  const first = await render(<HomeTodayRow upcomingBookingId={null} onOpenPlan={jest.fn()} onStart={jest.fn()} />);
  expect(first.toJSON()).toBeNull();
  await first.unmount();

  signInWith(strength, { consent: null });
  const second = await render(<HomeTodayRow upcomingBookingId={null} onOpenPlan={jest.fn()} onStart={jest.fn()} />);
  expect(second.toJSON()).toBeNull();
  await second.unmount();

  signInWith(null);
  const third = await render(<HomeTodayRow upcomingBookingId={null} onOpenPlan={jest.fn()} onStart={jest.fn()} />);
  expect(third.toJSON()).toBeNull();
});
