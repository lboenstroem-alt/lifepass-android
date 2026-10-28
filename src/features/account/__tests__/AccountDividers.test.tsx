/**
 * The hairlines of the Account cards with the slots drawn as their fillers
 * draw them (./slotFillers.tsx): iOS writes exactly one `divider` between two
 * rows, so a member never sees a missing line, a doubled one, or one hanging
 * at the end of a card, whichever rows the member's state shows.
 */
import { screen } from '@testing-library/react-native';

import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { useAppStore } from '../../../stores/appStore';

import { linesAndRows, seenInCard } from './slotFillers';
import { profileJSON, renderAccount, signedInAs, signedInAsSubscriber, subscriptionJSON, usageJSON, LANES } from './harness';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('../slots/BodyGoalsRow', () => require('./slotFillers').bodyGoalsRow);
jest.mock('../slots/IdentityRow', () => require('./slotFillers').identityRow);
jest.mock('../slots/DeletionRow', () => require('./slotFillers').deletionRow);
jest.mock('../slots/MembershipActions', () => require('./slotFillers').membershipActions);
jest.mock('../slots/CompanyPlanBanner', () => require('./harness').slotStandIn('CompanyPlanBanner'));
jest.mock('../slots/BillingSection', () => require('./harness').slotStandIn('BillingSection'));
jest.mock('../slots/PastDueFix', () => require('./harness').slotStandIn('PastDueFix'));
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const REFERRAL = { code: 'ANNA7K', link: 'https://www.lifepass.is/r/ANNA7K', referredCount: 2, rewardsEarned: 0 };

beforeEach(() => {
  api.on('GET', '/company-plans/context', Reply.ok({ pendingInvite: null, pendingActivation: null }));
  api.on('GET', '/referrals/me', Reply.problem(404, 'not_found'));
});

const card = (testID: string) => seenInCard(linesAndRows(screen.getByTestId(testID) as never));

/** One line between every two rows, none at either end, none doubled. */
function expectOneLineBetweenRows(seen: string[]) {
  seen.forEach((token, i) => {
    const isLine = token === '—';
    expect({ at: i, token, line: isLine }).toEqual({ at: i, token, line: i % 2 === 1 });
  });
  expect(seen.length % 2).toBe(1);
}

it('a subscriber with a referral link: one line between every row of both cards', async () => {
  api.on('GET', '/referrals/me', Reply.ok(REFERRAL));
  signedInAsSubscriber();
  await renderAccount();

  expect(card('account.membership')).toEqual([
    'Change plan, Plus · 8 gym & studio / mo · 4 pool / mo',
    '—',
    'Cancel subscription',
    '—',
    'Receipts & invoices',
    '—',
    'Plan & usage, Caps, passes & limits',
  ]);
  expect(card('account.account')).toEqual([
    'Body and goals',
    '—',
    'Refer a friend, They buy their first package, you earn a free visit',
    '—',
    'Identity (kennitala)',
    '—',
    'Language, English',
    '—',
    'Notifications',
    '—',
    'Help & support, support@lifepass.is',
    '—',
    'Log out',
    '—',
    'Delete account',
  ]);
});

it('without a referral link, Body and goals meets the identity row with one line', async () => {
  signedInAsSubscriber();
  await renderAccount();
  const seen = card('account.account');
  expect(seen.slice(0, 3)).toEqual(['Body and goals', '—', 'Identity (kennitala)']);
  expectOneLineBetweenRows(seen);
});

it('before the profile has loaded there is no identity row and no line for it', async () => {
  signedInAs(profileJSON());
  useAppStore.setState({ profile: null });
  await renderAccount();
  const seen = card('account.account');
  expect(seen).not.toContain('Identity (kennitala)');
  expect(seen.slice(0, 3)).toEqual(['Body and goals', '—', 'Language, English']);
  expectOneLineBetweenRows(seen);
});

it('a plan that is already ending has no cancel row and no line for it', async () => {
  signedInAs(profileJSON({ usage: usageJSON(LANES) }), subscriptionJSON({ cancelAtPeriodEnd: true }));
  await renderAccount();
  const seen = card('account.membership');
  expect(seen).not.toContain('Cancel subscription');
  expectOneLineBetweenRows(seen);
});

it('a member without a plan whose company context failed: View plans, the fallback, Receipts, Plan & usage', async () => {
  api.on('GET', '/company-plans/context', Reply.fail());
  signedInAs(profileJSON());
  await renderAccount();
  expect(card('account.membership')).toEqual([
    'View plans, No active membership',
    '—',
    'Have a company plan?, Activate it on lifepass.is',
    '—',
    'Receipts & invoices',
    '—',
    'Plan & usage, Caps, passes & limits',
  ]);
  expectOneLineBetweenRows(card('account.account'));
});
