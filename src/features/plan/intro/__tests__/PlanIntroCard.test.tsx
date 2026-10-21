/**
 * The intro card (iOS PlanIntroCard): Get a 4-week plan, Log a meal, Not now;
 * no Apple Health button on Android; Not now collapses for good, per member,
 * and goes with the health wipe.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { planIntroCollapsedKey } from '../../../../health';
import { runHealthWipeHooks } from '../../../../health/wipe';
import { translate } from '../../../../i18n';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { runSignOutCleaners } from '../../../../app/signOut';
import '../../register';
import { collapseIntro, forgetIntroCollapse, loadIntroCollapsed, useIntroCollapse, useIntroCollapsed } from '../introCollapse';
import PlanIntroCard from '../PlanIntroCard';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const en = (key: string) => translate(key, 'en');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => forgetIntroCollapse());

describe('the card', () => {
  let taps: string[];
  let events: { event: string; params: AnalyticsParams }[];

  beforeEach(() => {
    taps = [];
    events = [];
    setAnalyticsObserver((event, params) => events.push({ event, params }));
  });
  afterEach(() => setAnalyticsObserver(null));

  async function renderIntro(isCollapsed: boolean) {
    await render(
      <PlanIntroCard
        isCollapsed={isCollapsed}
        onGetPlan={() => taps.push('coach')}
        onLogMeal={() => taps.push('meal')}
        onNotNow={() => taps.push('notNow')}
      />,
    );
  }

  it('offers the plan, a meal and Not now, and no Apple Health', async () => {
    await renderIntro(false);
    expect(screen.getByRole('header', { name: en('plan.intro.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('plan.intro.r2'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.intro.cta') }));
    await fireEvent.press(screen.getByRole('button', { name: en('plan.intro.log_meal') }));
    await fireEvent.press(screen.getByRole('button', { name: en('plan.intro.not_now') }));
    expect(taps).toEqual(['coach', 'meal', 'notNow']);
    expect(events.map((e) => e.params.cta)).toEqual(['get_plan', 'log_meal', 'not_now']);
    expect(screen.queryByText(en('plan.intro.connect_ah'))).toBeNull();
  });

  it('collapsed, is one row that opens the Coach', async () => {
    await renderIntro(true);
    expect(screen.queryByText(en('plan.intro.title'))).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.intro.collapsed') }));
    expect(taps).toEqual(['coach']);
  });
});

describe('Not now, per member', () => {
  function Probe({ profileId }: { profileId: string | null }) {
    const collapsed = useIntroCollapsed(profileId);
    return <PlanIntroCardProbe collapsed={collapsed} />;
  }
  function PlanIntroCardProbe({ collapsed }: { collapsed: boolean | null }) {
    if (collapsed === null) return null;
    return <PlanIntroCard isCollapsed={collapsed} onGetPlan={() => undefined} onLogMeal={() => undefined} onNotNow={() => collapseIntro(A)} />;
  }

  it('is unknown until read, so neither form flashes', async () => {
    await AsyncStorage.setItem(planIntroCollapsedKey(A), 'true');
    await render(<Probe profileId={A} />);
    expect(screen.getByRole('button', { name: en('plan.intro.collapsed') })).toBeOnTheScreen();
    expect(screen.queryByText(en('plan.intro.title'))).toBeNull();
  });

  it('is stored for the member who tapped it, and not for another', async () => {
    await render(<Probe profileId={A} />);
    await fireEvent.press(screen.getByRole('button', { name: en('plan.intro.not_now') }));
    expect(screen.getByRole('button', { name: en('plan.intro.collapsed') })).toBeOnTheScreen();
    expect(await AsyncStorage.getItem(planIntroCollapsedKey(A))).toBe('true');
    expect(await AsyncStorage.getItem(planIntroCollapsedKey(B))).toBeNull();
    expect(await loadIntroCollapsed(B)).toBe(false);
  });

  it('a member with no profile yet sees the full card', async () => {
    await render(<Probe profileId={null} />);
    expect(screen.getByRole('header', { name: en('plan.intro.title') })).toBeOnTheScreen();
  });

  it('is forgotten with the health wipe and at sign-out', async () => {
    collapseIntro(A);
    expect(useIntroCollapse.getState().byProfile[A]).toBe(true);
    // The wipe removes the stored key (F7); the memory goes with it.
    await AsyncStorage.removeItem(planIntroCollapsedKey(A));
    await act(async () => runHealthWipeHooks({ profileId: A, reason: 'withdrawn' }));
    expect(useIntroCollapse.getState().byProfile).toEqual({});
    expect(await loadIntroCollapsed(A)).toBe(false);

    collapseIntro(B);
    await act(async () => runSignOutCleaners({ memberId: B }));
    expect(useIntroCollapse.getState().byProfile).toEqual({});
  });
});
