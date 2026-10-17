/**
 * The Plan & usage page as the member sees it (iOS CreditsDetailView), from
 * the app store the way Account leaves it: a Plus member's lanes, a pass
 * holder, a member in dunning, no plan, the banners, and Icelandic.
 */
import { fireEvent, screen, within } from '@testing-library/react-native';

import { decodeProfile } from '../../../../api/profile';
import { setCurrentLanguage } from '../../../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { MEMBER_A, profileJSON } from '../../../../stores/__tests__/storeHarness';
import { currentRoute, renderPushed, settle } from '../../billing/__tests__/screenHarness';
import PlanUsageScreen from '../PlanUsageScreen';
import { adventurerPass, PASS_ID_2, passOnlyUsageJSON, subscription, usageJSON } from './usageFixtures';

// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/; the kit's own tests point Jest at it the same way.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

beforeEach(() => {
  resetAppStoreForTests();
});

afterEach(() => {
  resetAppStoreForTests();
});

function member(
  usage: Record<string, unknown> | null,
  sub: ReturnType<typeof subscription> | null = null,
  locale: 'en' | 'is' = 'en',
): void {
  useAppStore.setState({
    isAuthenticated: true,
    isLoading: false,
    userId: MEMBER_A,
    profile: decodeProfile(profileJSON(usage ? { usage, locale } : { locale })),
    subscription: sub,
    subscriptionLoaded: true,
  });
}

async function show() {
  await renderPushed('PlanUsage', PlanUsageScreen);
  await settle();
}

it('a Plus member: the plan card, every lane with its words, open bookings, and the explainer last', async () => {
  member(usageJSON(), subscription());
  await show();

  expect(screen.getByText('Plan & usage')).toBeTruthy();
  const plan = within(screen.getByTestId('usage.plan'));
  expect(plan.getByText('Your plan')).toBeTruthy();
  expect(plan.getByText('LifePass Plus')).toBeTruthy();
  expect(plan.getByText('1 Nov 2026')).toBeTruthy();

  const gym = within(screen.getByTestId('usage.lane.gym'));
  expect(gym.getByText('Gym & studio visits')).toBeTruthy();
  expect(gym.getByText('3 of 8')).toBeTruthy();
  expect(gym.getByText('5 left')).toBeTruthy();
  expect(gym.getByText('Resets on 1 Nov 2026')).toBeTruthy();

  const daily = within(screen.getByTestId('usage.lane.daily'));
  expect(daily.getByText('0 of 2')).toBeTruthy();
  expect(daily.getByText('Resets daily')).toBeTruthy();

  const open = within(screen.getByTestId('usage.lane.open'));
  expect(open.getByText('Open bookings')).toBeTruthy();
  expect(open.getByText('1 of 3')).toBeTruthy();
  expect(open.getByText('2 left')).toBeTruthy();

  expect(screen.queryByTestId('usage.topUp')).toBeNull();
  expect(screen.queryByTestId('usage.passes')).toBeNull();
  expect(screen.queryByTestId('usage.noPlan')).toBeNull();
  expect(screen.getByText('How visits work')).toBeTruthy();
  expect(screen.getByText(/Allowances reset on your billing date/)).toBeTruthy();
});

it('at the limit: red words, a full bar, the gym top-up prompt, and "Cancel one to book another"', async () => {
  member(
    usageJSON({ network: { used: 8, cap: 8, resetsAt: '2026-11-01T00:00:00Z' }, concurrent: { open: 3, cap: 3 } }),
    subscription(),
  );
  await show();
  expect(
    within(screen.getByTestId('usage.topUp')).getByText(
      "You're out of gym & studio visits this period. Your next visit is a top-up from ISK 1,490.",
    ),
  ).toBeTruthy();
  const gym = within(screen.getByTestId('usage.lane.gym'));
  expect(gym.getByText('At limit')).toHaveStyle({ color: '#D02525' });
  expect(gym.getByTestId('usage.bar.fill', { includeHiddenElements: true })).toHaveStyle({ width: '100%', backgroundColor: '#D02525' });
  expect(within(screen.getByTestId('usage.lane.open')).getByText('Cancel one to book another')).toBeTruthy();
});

it('a concurrent cap of null shows just the open count', async () => {
  member(usageJSON({ concurrent: { open: 2, cap: null } }), subscription());
  await show();
  const open = within(screen.getByTestId('usage.lane.open'));
  expect(open.getByText('2')).toBeTruthy();
  expect(open.queryByText(/ of /)).toBeNull();
});

it('a live block comes first; a past one is ignored in favour of the strikes', async () => {
  member(usageJSON({ block: { until: '2099-01-01T00:00:00Z' }, strikes: { active: 3, threshold: 3 } }), subscription());
  await show();
  expect(screen.getByTestId('usage.banner.block')).toHaveTextContent(/Booking temporarily blocked/);
  expect(screen.getByTestId('usage.banner.block')).toHaveTextContent(/Booking is blocked until 1 Jan 2099/);
  expect(screen.queryByTestId('usage.banner.strikes')).toBeNull();
});

it('strikes without a live block', async () => {
  member(usageJSON({ block: { until: '2020-01-01T00:00:00Z' }, strikes: { active: 2, threshold: 3 } }), subscription());
  await show();
  expect(screen.queryByTestId('usage.banner.block')).toBeNull();
  expect(screen.getByTestId('usage.banner.strikes')).toHaveTextContent(/2 of 3 strikes/);
});

it('a pass holder: the passes panel, no plan card, no empty state', async () => {
  member(passOnlyUsageJSON([adventurerPass(), adventurerPass({ id: PASS_ID_2, type: 'day', visitsLeft: 1 })]));
  await show();
  const passes = within(screen.getByTestId('usage.passes'));
  expect(passes.getByText('Active passes')).toBeTruthy();
  expect(passes.getByText('Adventurer pass')).toBeTruthy();
  expect(passes.getAllByText('Expires 31 Dec 2026')).toHaveLength(2);
  expect(passes.getByText('5 visits left')).toBeTruthy();
  expect(passes.getByText('Day pass')).toBeTruthy();
  expect(screen.queryByTestId('usage.plan')).toBeNull();
  expect(screen.queryByTestId('usage.period')).toBeNull();
  expect(screen.queryByTestId('usage.noPlan')).toBeNull();
  expect(screen.queryByTestId('usage.pastDue')).toBeNull();
});

it('past due with no tier: the payment issue, not "not on a plan yet"', async () => {
  member(passOnlyUsageJSON([]), subscription({ status: 'past_due' }));
  await show();
  expect(screen.getByTestId('usage.pastDue')).toHaveTextContent(/Payment issue/);
  expect(screen.queryByTestId('usage.noPlan')).toBeNull();
  expect(screen.getByText('How visits work')).toBeTruthy();
});

it('no plan: the card and View plans, which opens Plans', async () => {
  member(passOnlyUsageJSON([]));
  await show();
  expect(screen.getByText("You're not on a plan yet")).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'View plans' }));
  expect(currentRoute()).toBe('Plans');
});

it('a profile without a usage block degrades this page only: no plan, and the explainer', async () => {
  member(null);
  await show();
  expect(screen.getByTestId('usage.noPlan')).toBeTruthy();
  expect(screen.getByTestId('usage.explainer')).toBeTruthy();
});

it('back returns to Account', async () => {
  member(usageJSON(), subscription());
  await show();
  await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
  expect(currentRoute()).toBe('Start');
});

it('speaks Icelandic, with Icelandic month words and plurals', async () => {
  setCurrentLanguage('is');
  member(usageJSON({ passes: [adventurerPass({ visitsLeft: 21 })] }), subscription(), 'is');
  await show();
  expect(screen.getByText('Áskrift og notkun')).toBeTruthy();
  expect(screen.getByText('Áskriftin þín')).toBeTruthy();
  expect(screen.getByText('1 nóv. 2026')).toBeTruthy();
  expect(within(screen.getByTestId('usage.lane.gym')).getByText('3 af 8')).toBeTruthy();
  expect(within(screen.getByTestId('usage.lane.gym')).getByText('5 eftir')).toBeTruthy();
  expect(screen.getByText('Adventurer-passi')).toBeTruthy();
  expect(screen.getByText('Rennur út 31 des. 2026')).toBeTruthy();
  // Icelandic 21 takes the singular (PassCopy.visitsLeft).
  expect(screen.getByText('21 heimsókn eftir')).toBeTruthy();
  expect(screen.getByText('Hvernig heimsóknir virka')).toBeTruthy();
});
