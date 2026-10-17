/**
 * The Plan tab's page (iOS PlanView) in a real navigation stack, against the
 * stub server and the real health store: which body renders for which
 * member, the top bar's counter and gear, the reads (none without consent,
 * again on a language change, forced by pull to refresh and Try again), the
 * footer, the banners, the hand-offs to the Coach, Plans and Body and goals,
 * and a parked notification action answered once the read has landed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import { Linking, Text } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { stubApiClientPerTest } from '../../../api/testing';
import { UiKitProvider } from '../../../components/ui';
import { useHealthStore } from '../../../health';
import * as healthLocalStore from '../../../health/localStore';
import { translate } from '../../../i18n';
import { UPGRADED_FROM_PROFILE_TAB_KEY } from '../../../navigation/navPrefs';
import { useAppStore } from '../../../stores/appStore';
import { useIntentStore } from '../../../stores/intentStore';
import PlanScreen from '../PlanScreen';
import { installWeeklyCheckInOpener } from '../shell/bridges';
import { usePlanShell } from '../shell/planShell';
import { PLAN_CREDITS_URL } from '../shell/PlanChrome';
import { dayJSON, freshPlan, memberProfile, recordAnalytics, settle, signIn, TODAY } from './planFixtures';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));

stubApiClientPerTest();

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

/** The routes Plan pushes, as stand-ins that show their name and params. */
const OTHER_ROUTES = ['Account', 'BodyAndGoals', 'Profile', 'ProgramOverview', 'Plans', 'MealCapture'] as const;

function StandIn({ route }: { route: { name: string; params?: object } }) {
  return <Text>{`route:${route.name}:${JSON.stringify(route.params ?? {})}`}</Text>;
}

const Stack = createNativeStackNavigator();

async function renderPlan() {
  await render(
    <NavigationContainer>
      <UiKitProvider>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="PlanMain" component={PlanScreen as never} />
          {OTHER_ROUTES.map((name) => (
            <Stack.Screen key={name} name={name} component={StandIn as never} />
          ))}
        </Stack.Navigator>
      </UiKitProvider>
    </NavigationContainer>,
  );
  await act(async () => settle());
}

beforeEach(() => {
  freshPlan();
});

afterEach(async () => {
  await settle();
  await healthLocalStore.settled();
});

describe('which body renders', () => {
  it('a member under 18: the card, no gear, no footer, and nothing read', async () => {
    signIn(memberProfile({ access: 'minor', consent: false }));
    await renderPlan();
    expect(screen.getByRole('header', { name: en('health.minor.title') })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('a11y.body_goals') })).toBeNull();
    expect(screen.queryByText(en('health.disclaimer'))).toBeNull();
    expect(api.sentAll('/health')).toHaveLength(0);
  });

  it('a member without a membership or consent: the gate and the footer, and nothing read', async () => {
    signIn(memberProfile({ access: 'not_member', consent: false }));
    await renderPlan();
    expect(screen.getByRole('header', { name: en('plan.gate.title') })).toBeOnTheScreen();
    expect(screen.queryByText(en('plan.gate.history_line'))).toBeNull();
    expect(screen.getByText(en('health.disclaimer'))).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('a11y.body_goals') })).toBeOnTheScreen();
    expect(api.sentAll('/health')).toHaveLength(0);
  });

  it('an entitled member with a plan: the skeleton, then the plan with its week and the counter', async () => {
    signIn();
    let answer: ((value: unknown) => void) | null = null;
    api.on('GET', '/health', () => new Promise((resolve) => (answer = resolve)).then(() => Reply.ok(dayJSON())));
    await renderPlan();
    expect(screen.getByLabelText(en('a11y.loading'))).toBeOnTheScreen();
    await act(async () => {
      answer?.(null);
      await settle();
    });
    expect(screen.queryByLabelText(en('a11y.loading'))).toBeNull();
    expect(screen.getByText(en('plan.week_of', { week: 2, weeks: 4 }).toUpperCase())).toBeOnTheScreen();
    expect(screen.getByText(en('plan.week.progress', { done: 1, planned: 3 }))).toBeOnTheScreen();
    expect(screen.getByTestId('plan.slot.today')).toBeTruthy();
    expect(screen.getByTestId('plan.slot.overview')).toBeTruthy();
    expect(screen.getByTestId('plan.slot.history')).toBeTruthy();
    expect(screen.queryByRole('header', { name: en('plan.gate.title') })).toBeNull();
  });

  it('an entitled member without a plan: the intro, and Not now collapses it for good', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { program: null })));
    await renderPlan();
    expect(await screen.findByRole('header', { name: en('plan.intro.title') })).toBeOnTheScreen();
    expect(screen.queryByText(en('plan.week_of', { week: 2, weeks: 4 }).toUpperCase())).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.intro.not_now') }));
    expect(screen.getByRole('button', { name: en('plan.intro.collapsed') })).toBeOnTheScreen();
    expect(await AsyncStorage.getItem(`plan.intro.collapsed.${useAppStore.getState().profile!.id}`)).toBe('true');
  });

  it('Get a 4-week plan hands the member to the Coach wizard', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { program: null })));
    await renderPlan();
    await fireEvent.press(await screen.findByRole('button', { name: en('plan.intro.cta') }));
    expect(useIntentStore.getState().pendingCoachProgram).toEqual({ kind: 'planTab' });
    expect(useIntentStore.getState().pendingTab).toBe('Coach');
  });

  it('a failed read with nothing cached: the error, and Try again reads again', async () => {
    signIn();
    api.on('GET', '/health', Reply.problem(503, 'unavailable'));
    await renderPlan();
    expect(await screen.findByRole('button', { name: en('health.retry') })).toBeOnTheScreen();
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await fireEvent.press(screen.getByRole('button', { name: en('health.retry') }));
    await act(async () => settle());
    expect(screen.getByText(en('plan.week.progress', { done: 1, planned: 3 }))).toBeOnTheScreen();
    expect(api.sentAll('/health')).toHaveLength(2);
  });

  it('past_due with a plan keeps it, read only, under the payment banner', async () => {
    signIn(memberProfile({ access: 'past_due' }));
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await renderPlan();
    expect(screen.getByText(en('health.past_due.banner'))).toBeOnTheScreen();
    expect(screen.getByText(en('plan.week_of', { week: 2, weeks: 4 }).toUpperCase())).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('health.past_due.cta') }));
    expect(screen.getByText('route:Account:{}')).toBeOnTheScreen();
  });

  it('a lapsed member with consent: the gate over their history, and no counter over it', async () => {
    signIn(memberProfile({ access: 'not_member' }));
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await renderPlan();
    expect(screen.getByRole('header', { name: en('plan.gate.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('plan.gate.history_line'))).toBeOnTheScreen();
    expect(screen.queryByText(en('plan.week_of', { week: 2, weeks: 4 }).toUpperCase())).toBeNull();
    expect(screen.getByTestId('plan.slot.nutrition')).toBeTruthy();
    expect(screen.getByTestId('plan.slot.history')).toBeTruthy();
    expect(screen.queryByTestId('plan.slot.feedback')).toBeNull();
    expect(screen.queryByTestId('plan.slot.today')).toBeNull();
  });
});

describe('where its buttons go', () => {
  it('the gear opens Body and goals', async () => {
    signIn(memberProfile({ access: 'not_member', consent: false }));
    await renderPlan();
    await fireEvent.press(screen.getByRole('button', { name: en('a11y.body_goals') }));
    expect(screen.getByText('route:BodyAndGoals:{}')).toBeOnTheScreen();
  });

  it('the gate: memberships, the trial page, the Coach with "Plan my day" waiting', async () => {
    signIn(memberProfile({ access: 'not_member', consent: false, trialEligible: true }));
    await renderPlan();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.gate.cta_trial') }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://www.lifepass.is/en/plans?trial=1');
    await fireEvent.press(screen.getByRole('button', { name: en('plan.gate.day_plan') }));
    expect(useIntentStore.getState().pendingCoachPrompt).toBe(en('coach.chip.plan_day'));
    expect(useIntentStore.getState().pendingTab).toBe('Coach');
    await fireEvent.press(screen.getByRole('button', { name: en('plan.gate.cta_choose') }));
    expect(screen.getByText('route:Plans:{}')).toBeOnTheScreen();
  });

  it('the footer opens the sources and credits', async () => {
    signIn(memberProfile({ access: 'not_member', consent: false }));
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderPlan();
    await fireEvent.press(screen.getByRole('link', { name: en('plan.footer.credits') }));
    expect(open).toHaveBeenCalledWith(PLAN_CREDITS_URL);
    open.mockRestore();
  });
});

describe('when it reads', () => {
  it('pull to refresh reads again inside the freshness window', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await renderPlan();
    expect(api.sentAll('/health')).toHaveLength(1);
    const scroll = screen.getByTestId('plan.scroll');
    await act(async () => {
      await scroll.props.refreshControl.props.onRefresh();
    });
    expect(api.sentAll('/health')).toHaveLength(2);
  });

  it('reads again in the new language when the account language changes', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON()));
    await renderPlan();
    expect(api.sentAll('/health')).toHaveLength(1);
    await act(async () => {
      // The account language is the profile's locale.
      signIn(memberProfile({ locale: 'is' }));
      await settle();
    });
    expect(api.sentAll('/health')).toHaveLength(2);
    expect(api.sentAll('/health')[1]!.query.locale).toBe('is');
  });

  it('counts the visit, and says which body it showed', async () => {
    signIn(memberProfile({ access: 'not_member', consent: false }));
    const events = recordAnalytics();
    await renderPlan();
    expect(events).toContainEqual({ event: 'plan_viewed', params: { state: 'gate' } });
  });
});

describe('the banners', () => {
  it('"Looking for your bookings?" for a member who knew Profile as a tab', async () => {
    signIn(memberProfile({ access: 'not_member', consent: false }));
    await AsyncStorage.setItem(UPGRADED_FROM_PROFILE_TAB_KEY, 'true');
    await renderPlan();
    await act(async () => settle());
    expect(screen.getByText(en('plan.where_bookings'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.open_bookings') }));
    expect(screen.getByText('route:Profile:{"initialTab":"bookings"}')).toBeOnTheScreen();
  });

  it('the adopted banner after an adopt, once', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON()));
    useIntentStore.getState().parkPlanAction({ kind: 'showAdoptedBanner', startsOn: '2026-10-19' });
    await renderPlan();
    await act(async () => settle());
    expect(screen.getByTestId('plan.banner.adopted')).toBeOnTheScreen();
    expect(usePlanShell.getState().adoptedBannerShown).toBe(true);
  });
});

describe('a parked notification action', () => {
  it('opens the weekly check-in once the read says it is due', async () => {
    signIn();
    const opened: string[] = [];
    installWeeklyCheckInOpener((entry) => opened.push(entry));
    let answer: ((value: unknown) => void) | null = null;
    api.on('GET', '/health', () =>
      new Promise((resolve) => (answer = resolve)).then(() => Reply.ok(dayJSON(TODAY, { checkIn: { due: true } }))),
    );
    useIntentStore.getState().parkPlanAction({ kind: 'openWeeklyCheckIn' });
    await renderPlan();
    // Taken off the intent store at once, held until the read answers.
    expect(useIntentStore.getState().pendingPlanAction).toBeNull();
    expect(opened).toEqual([]);
    await act(async () => {
      answer?.(null);
      await settle();
    });
    await waitFor(() => expect(opened).toEqual(['notification']));
  });

  it('lands on the review instead when the check-in is done', async () => {
    signIn();
    api.on('GET', '/health', Reply.ok(dayJSON(TODAY, { checkIn: { due: false }, review: { weekStartsOn: '2026-10-05', planned: 3, done: 3 } })));
    useIntentStore.getState().parkPlanAction({ kind: 'openWeeklyCheckIn' });
    await renderPlan();
    await act(async () => settle());
    // The review section is PLAN-5's and draws nothing yet, so the scroll
    // waits for it to be laid out rather than landing nowhere.
    expect(usePlanShell.getState().scrollTarget).toBe('review');
    expect(useHealthStore.getState().today?.review).not.toBeNull();
  });
});

describe('a cold launch onto Plan', () => {
  it('decides the bookings hint once the profile arrives, without counting another visit', async () => {
    useAppStore.setState({ isAuthenticated: true, isLoading: false, userId: 'x', profile: null });
    await AsyncStorage.setItem(UPGRADED_FROM_PROFILE_TAB_KEY, 'true');
    await renderPlan();
    expect(screen.queryByText(en('plan.where_bookings'))).toBeNull();
    await act(async () => {
      signIn(memberProfile({ access: 'not_member', consent: false }));
      await settle();
    });
    expect(screen.getByText(en('plan.where_bookings'))).toBeOnTheScreen();
    expect(await AsyncStorage.getItem(`nav.profileHint.${useAppStore.getState().profile!.id}.planVisits`)).toBeNull();
  });
});
