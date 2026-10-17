/**
 * The Account screen (iOS AccountView), rendered in a real stack against the
 * stub server: the AccountPassRowTests cases on the screen itself, the
 * member card's states, the Membership and Account rows in iOS's order in
 * both languages, the slots' mount points, the company fallback row, the
 * referral row, the language switch, sign-out, and the links.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Linking, Share } from 'react-native';

import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { setCurrentLanguage } from '../../../i18n';
import { useAppStore } from '../../../stores/appStore';

import {
  ADVENTURER,
  currentRoute,
  navigationRef,
  profileJSON,
  renderAccount,
  rowsOf,
  settle,
  signedInAs,
  signedInAsSubscriber,
  subscriptionJSON,
  usageJSON,
} from './harness';

/* eslint-disable @typescript-eslint/no-require-imports */
// @expo/vector-icons loads its fonts through expo-asset, which npm nests under expo.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('../slots/BodyGoalsRow', () => require('./harness').slotStandIn('BodyGoalsRow'));
jest.mock('../slots/IdentityRow', () => require('./harness').slotStandIn('IdentityRow'));
jest.mock('../slots/DeletionRow', () => require('./harness').slotStandIn('DeletionRow'));
jest.mock('../slots/MembershipActions', () => require('./harness').slotStandIn('MembershipActions'));
jest.mock('../slots/CompanyPlanBanner', () => require('./harness').slotStandIn('CompanyPlanBanner'));
jest.mock('../slots/BillingSection', () => require('./harness').slotStandIn('BillingSection'));
jest.mock('../slots/PastDueFix', () => require('./harness').slotStandIn('PastDueFix'));
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const REFERRAL = { code: 'ANNA7K', link: 'https://www.lifepass.is/r/ANNA7K', referredCount: 2, rewardsEarned: 0 };

let openURL: jest.SpyInstance;
let share: jest.SpyInstance;

beforeEach(() => {
  // Every appearance reads both; by default the company context answers
  // "nothing pending" and the referral route is missing (an older server).
  api.on('GET', '/company-plans/context', Reply.ok({ pendingInvite: null, pendingActivation: null }));
  api.on('GET', '/referrals/me', Reply.problem(404, 'not_found'));
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});

afterEach(() => {
  openURL.mockRestore();
  share.mockRestore();
});

const kicker = () => screen.getByTestId('account.memberCard.kicker');
const caps = () => screen.getByTestId('account.memberCard.caps');
const footnote = () => screen.queryByTestId('account.memberCard.footnote');
const text = (testID: string) => screen.getByTestId(testID).props.children as string;

describe('a pass holder sees the pass, not "no membership" (iOS AccountPassRowTests, on the screen)', () => {
  beforeEach(() => signedInAs(profileJSON({ usage: usageJSON({ passes: [ADVENTURER] }) })));

  it('in English', async () => {
    await renderAccount();
    expect(text('account.memberCard.kicker')).toBe('ADVENTURER PASS');
    expect(text('account.memberCard.caps')).toBe('5 visits left');
    expect(text('account.memberCard.footnote')).toBe('Valid until 7 Dec 2026');
    expect(screen.getByRole('button', { name: 'View plans' })).toBeOnTheScreen();
    expect(rowsOf('account.membership')[0]).toBe('View plans, Adventurer pass · 5 visits left · valid until 7 Dec 2026');
    expect(screen.queryByText('No active membership')).toBeNull();
  });

  it('in Icelandic', async () => {
    signedInAs(profileJSON({ locale: 'is', usage: usageJSON({ passes: [ADVENTURER] }) }));
    await renderAccount();
    expect(text('account.memberCard.kicker')).toBe('ADVENTURER-PASSI');
    expect(text('account.memberCard.caps')).toBe('5 heimsóknir eftir');
    expect(text('account.memberCard.footnote')).toBe('Gildir til 7. des. 2026');
    expect(rowsOf('account.membership')[0]).toBe(
      'Skoða áskriftir, Adventurer-passi · 5 heimsóknir eftir · gildir til 7. des. 2026',
    );
  });

  it('two passes lead with the one the next visit uses, never the sum over both', async () => {
    const explorer = {
      id: '1b8e3c1a-2d4f-4a6b-8c9d-0e1f2a3b4c5d',
      type: 'explorer',
      visitsLeft: 1,
      expiresAt: '2027-01-31T12:00:00.000Z',
    };
    signedInAs(profileJSON({ usage: usageJSON({ passes: [explorer, ADVENTURER] }) }));
    await renderAccount();
    expect(text('account.memberCard.kicker')).toBe('EXPLORER PASS');
    expect(text('account.memberCard.caps')).toBe('1 visit left');
    expect(text('account.memberCard.footnote')).toBe('Valid until 31 Jan 2027');
    expect(rowsOf('account.membership')[0]).toBe('View plans, Explorer pass · 1 visit left · valid until 31 Jan 2027');
    expect(screen.queryByText('6 pass visits left')).toBeNull();
  });
});

describe('the member card', () => {
  it('someone with neither still reads "Plan · None" and no membership', async () => {
    signedInAs(profileJSON());
    await renderAccount();
    expect(text('account.memberCard.kicker')).toBe('PLAN · NONE');
    expect(text('account.memberCard.caps')).toBe('No active membership');
    expect(footnote()).toBeNull();
    expect(rowsOf('account.membership')[0]).toBe('View plans, No active membership');
  });

  it('a subscriber reads the plan, the lanes and the renewal; the capsule says Change plan', async () => {
    signedInAsSubscriber();
    await renderAccount();
    expect(text('account.memberCard.kicker')).toBe('PLAN · PLUS');
    expect(text('account.memberCard.caps')).toBe('Gym & studio 3 of 8 · Pool 2 of 4');
    expect(text('account.memberCard.footnote')).toBe('Renews 1 Oct 2026');
    expect(within(screen.getByTestId('account.memberCard')).getByRole('button', { name: 'Change plan' })).toBeOnTheScreen();
    expect(screen.getByText('Anna Jónsdóttir')).toBeOnTheScreen();
    expect(screen.getByText('anna@example.com')).toBeOnTheScreen();
    // The letter is decoration to TalkBack (the name is read beside it).
    expect(screen.getByText('A', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('a member without a name reads "Member" under the letter L', async () => {
    signedInAs(profileJSON({ fullName: null }));
    await renderAccount();
    expect(screen.getByText('Member')).toBeOnTheScreen();
    expect(screen.getByText('L', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('in dunning: the past-due body and the fix (ACCT-3’s slot), never the caps line', async () => {
    signedInAs(profileJSON(), subscriptionJSON({ status: 'past_due' }));
    await renderAccount();
    expect(text('account.memberCard.kicker')).toBe('PLAN · PLUS');
    expect(screen.getByText(/Your last plan payment didn't go through/)).toBeOnTheScreen();
    expect(within(screen.getByTestId('account.memberCard')).getByTestId('slot.PastDueFix')).toBeOnTheScreen();
    expect(screen.queryByTestId('account.memberCard.caps')).toBeNull();
    expect(footnote()).toBeNull();
    expect(screen.queryByText('No active membership')).toBeNull();
  });

  it('outside dunning there is no past-due fix', async () => {
    signedInAsSubscriber();
    await renderAccount();
    expect(screen.queryByTestId('slot.PastDueFix')).toBeNull();
    expect(caps()).toBeOnTheScreen();
    expect(kicker()).toBeOnTheScreen();
  });

  it('the capsule opens Plans', async () => {
    signedInAs(profileJSON());
    await renderAccount();
    await fireEvent.press(screen.getByTestId('account.memberCard.plans'));
    expect(currentRoute()).toBe('Plans');
  });
});

describe('the rows, in iOS’s order', () => {
  beforeEach(() => {
    api.on('GET', '/referrals/me', Reply.ok(REFERRAL));
  });

  it('in English', async () => {
    signedInAsSubscriber();
    await renderAccount();
    expect(rowsOf('account.membership')).toEqual([
      'Change plan, Plus · 8 gym & studio / mo · 4 pool / mo',
      '[MembershipActions]',
      'Receipts & invoices',
      'Plan & usage, Caps, passes & limits',
    ]);
    expect(rowsOf('account.account')).toEqual([
      '[BodyGoalsRow]',
      'Refer a friend, They buy their first package, you earn a free visit',
      '[IdentityRow]',
      'Language, English',
      'Notifications',
      'Help & support, support@lifepass.is',
      'Log out',
      '[DeletionRow]',
    ]);
  });

  it('in Icelandic', async () => {
    signedInAsSubscriber({ locale: 'is' });
    await renderAccount();
    expect(rowsOf('account.membership')).toEqual([
      'Skipta um áskrift, Plus · 8 rækt og stúdíó / mán · 4 sund / mán',
      '[MembershipActions]',
      'Kvittanir og reikningar',
      'Áskrift og notkun, Þök, passar og takmarkanir',
    ]);
    expect(rowsOf('account.account')).toEqual([
      '[BodyGoalsRow]',
      'Bjóddu vini, Vinur kaupir fyrsta pakkann, þú færð fría heimsókn',
      '[IdentityRow]',
      'Tungumál, Íslenska',
      'Tilkynningar',
      'Aðstoð, support@lifepass.is',
      'Skrá út',
      '[DeletionRow]',
    ]);
    expect(screen.getByText('PRÓFÍLL')).toBeOnTheScreen();
    expect(screen.getByText('AÐILD')).toBeOnTheScreen();
    expect(screen.getByText('AÐGANGUR')).toBeOnTheScreen();
  });

  it('the page: member card, company banner, billing, Membership, Account, footer', async () => {
    signedInAsSubscriber();
    const view = await renderAccount();
    const order = ['account.memberCard', 'slot.CompanyPlanBanner', 'slot.BillingSection', 'account.membership', 'account.account', 'account.footer'];
    const json = JSON.stringify(view.toJSON());
    const positions = order.map((id) => json.indexOf(`"testID":"${id}"`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('a member without a plan has no cancel slot', async () => {
    signedInAs(profileJSON());
    await renderAccount();
    expect(screen.queryByTestId('slot.MembershipActions')).toBeNull();
  });

  it('Receipts and Plan & usage push their screens; the back chevron returns', async () => {
    signedInAsSubscriber();
    await renderAccount();
    await fireEvent.press(screen.getByTestId('account.row.receipts'));
    expect(currentRoute()).toBe('Receipts');
    await act(async () => navigationRef.goBack());
    await fireEvent.press(screen.getByTestId('account.row.usage'));
    expect(currentRoute()).toBe('PlanUsage');
  });

  it('the back chevron leaves Account', async () => {
    signedInAsSubscriber();
    await renderAccount();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(currentRoute()).toBe('Start');
  });

  it('Change plan and View plans open Plans', async () => {
    signedInAsSubscriber();
    await renderAccount();
    await fireEvent.press(screen.getByTestId('account.row.changePlans'));
    expect(currentRoute()).toBe('Plans');
  });
});

describe('the company plan fallback (GET /company-plans/context)', () => {
  it('a failed read offers the web dashboard', async () => {
    api.on('GET', '/company-plans/context', Reply.problem(404, 'not_found'));
    signedInAs(profileJSON());
    await renderAccount();
    expect(rowsOf('account.membership')).toEqual([
      'View plans, No active membership',
      'Have a company plan?, Activate it on lifepass.is',
      'Receipts & invoices',
      'Plan & usage, Caps, passes & limits',
    ]);
    await fireEvent.press(screen.getByTestId('account.row.companyPlan'));
    expect(openURL).toHaveBeenCalledWith('https://www.lifepass.is/dashboard');
  });

  it('any failure counts, offline included', async () => {
    api.on('GET', '/company-plans/context', Reply.fail());
    signedInAs(profileJSON());
    await renderAccount();
    expect(screen.getByTestId('account.row.companyPlan')).toBeOnTheScreen();
  });

  it('a read that answers hides it', async () => {
    signedInAs(profileJSON());
    await renderAccount();
    expect(api.sentAll('/company-plans/context')).toHaveLength(1);
    expect(screen.queryByTestId('account.row.companyPlan')).toBeNull();
  });

  it('a plan holder never sees it (iOS shows it only beside View plans)', async () => {
    api.on('GET', '/company-plans/context', Reply.problem(500, 'internal_error'));
    signedInAsSubscriber();
    await renderAccount();
    expect(screen.queryByTestId('account.row.companyPlan')).toBeNull();
  });
});

describe('Refer a friend', () => {
  it('stays hidden while the read fails', async () => {
    signedInAs(profileJSON());
    await renderAccount();
    expect(api.sentAll('/referrals/me')).toHaveLength(1);
    expect(screen.queryByTestId('account.row.refer')).toBeNull();
  });

  it('stays hidden without a link a friend could open', async () => {
    api.on('GET', '/referrals/me', Reply.ok({ ...REFERRAL, link: '' }));
    signedInAs(profileJSON());
    await renderAccount();
    expect(screen.queryByTestId('account.row.refer')).toBeNull();
  });

  it.each([
    [0, 'Refer a friend, They buy their first package, you earn a free visit'],
    [1, 'Refer a friend, 1 free visit earned — keep sharing'],
    [5, 'Refer a friend, 5 free visits earned — keep sharing'],
  ])('reads %i rewards earned', async (rewardsEarned, label) => {
    api.on('GET', '/referrals/me', Reply.ok({ ...REFERRAL, rewardsEarned }));
    signedInAs(profileJSON());
    await renderAccount();
    expect(screen.getByTestId('account.row.refer').props.accessibilityLabel).toBe(label);
  });

  it('shares the message with the link', async () => {
    api.on('GET', '/referrals/me', Reply.ok(REFERRAL));
    signedInAs(profileJSON());
    await renderAccount();
    await fireEvent.press(screen.getByTestId('account.row.refer'));
    expect(share).toHaveBeenCalledTimes(1);
    const message = (share.mock.calls[0][0] as { message: string }).message;
    expect(message).toContain('https://www.lifepass.is/r/ANNA7K');
    expect(message.startsWith("I'm using LifePass")).toBe(true);
  });

  it('is read again each time Account appears', async () => {
    api.on('GET', '/referrals/me', Reply.ok(REFERRAL));
    signedInAs(profileJSON());
    await renderAccount();
    await fireEvent.press(screen.getByTestId('account.row.receipts'));
    await act(async () => navigationRef.goBack());
    await settle();
    expect(api.sentAll('/referrals/me')).toHaveLength(2);
    expect(api.sentAll('/company-plans/context')).toHaveLength(2);
  });
});

describe('the language (iOS AccountView.setLanguage)', () => {
  const pickerButton = (name: string) => within(screen.getByTestId('account.languagePicker')).getByRole('button', { name });

  it('opens a dialog with English, Íslenska and Cancel, titled and explained', async () => {
    signedInAs(profileJSON());
    await renderAccount();
    await fireEvent.press(screen.getByTestId('account.row.language'));
    const picker = screen.getByTestId('account.languagePicker');
    expect(within(picker).getByText('Choose the language for venue descriptions and emails.')).toBeOnTheScreen();
    expect(within(picker).getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual([
      'English',
      'Íslenska',
      'Cancel',
    ]);
  });

  it('the language it already speaks sends nothing', async () => {
    signedInAs(profileJSON({ locale: 'en' }));
    await renderAccount();
    await fireEvent.press(screen.getByTestId('account.row.language'));
    await fireEvent.press(pickerButton('English'));
    await settle();
    expect(api.sentAll('/profile/locale')).toHaveLength(0);
    expect(api.sentAll('/profile')).toHaveLength(0);
  });

  it('with no profile nothing is sent', async () => {
    signedInAs(profileJSON());
    useAppStore.setState({ profile: null });
    await renderAccount();
    await fireEvent.press(screen.getByTestId('account.row.language'));
    await fireEvent.press(pickerButton('Íslenska'));
    await settle();
    expect(api.sentAll('/profile/locale')).toHaveLength(0);
  });

  it('a new language is posted, the profile re-read, and every label changes at once', async () => {
    signedInAs(profileJSON({ locale: 'en' }));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.on('POST', '/profile/locale', async () => {
      await gate;
      return Reply.ok({ locale: 'is' });
    });
    api.on('GET', '/profile', Reply.ok(profileJSON({ locale: 'is' })));
    await renderAccount();

    await fireEvent.press(screen.getByTestId('account.row.language'));
    await fireEvent.press(pickerButton('Íslenska'));
    await settle();
    expect(screen.getByTestId('account.row.language').props.accessibilityLabel).toBe('Language, Saving…');
    expect(api.sent('/profile/locale', 'POST').body).toEqual({ locale: 'is' });

    await act(async () => release());
    await settle();
    await waitFor(() => expect(screen.getByTestId('account.row.language').props.accessibilityLabel).toBe('Tungumál, Íslenska'));
    expect(api.sentAll('/profile', 'GET')).toHaveLength(1);
    expect(useAppStore.getState().language).toBe('is');
    expect(screen.getByText('PRÓFÍLL')).toBeOnTheScreen();
    expect(screen.getByTestId('account.row.logout').props.accessibilityLabel).toBe('Skrá út');
  });

  it('a failure keeps the language and says so in it', async () => {
    signedInAs(profileJSON({ locale: 'is' }));
    api.on('POST', '/profile/locale', Reply.fail());
    await renderAccount();
    await fireEvent.press(screen.getByTestId('account.row.language'));
    await fireEvent.press(pickerButton('English'));
    await settle();
    const alert = screen.getByTestId('account.languageError');
    expect(within(alert).getByText('Tungumálinu var ekki breytt')).toBeOnTheScreen();
    expect(useAppStore.getState().language).toBe('is');
    expect(api.sentAll('/profile', 'GET')).toHaveLength(0);
    expect(screen.getByTestId('account.row.language').props.accessibilityLabel).toBe('Tungumál, Íslenska');

    expect(within(alert).getByText('Netvilla. Reyndu aftur.')).toBeOnTheScreen();
    await fireEvent.press(within(alert).getByRole('button', { name: 'Í lagi' }));
    expect(screen.queryByTestId('account.languageError')).toBeNull();
  });
});

describe('the other rows', () => {
  beforeEach(() => signedInAs(profileJSON()));

  it('Log out signs out at once, with no confirmation (decision D4)', async () => {
    const signOut = jest.fn(async () => undefined);
    useAppStore.setState({ signOut });
    await renderAccount();
    await fireEvent.press(screen.getByTestId('account.row.logout'));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Help & support writes to support', async () => {
    await renderAccount();
    await fireEvent.press(screen.getByTestId('account.row.help'));
    expect(openURL).toHaveBeenCalledWith('mailto:support@lifepass.is');
  });

  it('Notifications opens the phone’s notification settings for LifePass', async () => {
    const sendIntent = jest.spyOn(Linking, 'sendIntent').mockResolvedValue(undefined);
    try {
      await renderAccount();
      const row = screen.getByTestId('account.row.notifications');
      expect(row.props.accessibilityHint).toBe('Opens the notification settings on your phone');
      await fireEvent.press(row);
      await settle();
      expect(sendIntent).toHaveBeenCalledWith('android.settings.APP_NOTIFICATION_SETTINGS', expect.any(Array));
    } finally {
      sendIntent.mockRestore();
    }
  });

  it('a phone that cannot open the mail app stays quiet', async () => {
    openURL.mockRejectedValueOnce(new Error('no activity'));
    await renderAccount();
    await fireEvent.press(screen.getByTestId('account.row.help'));
    await settle();
    expect(screen.getByTestId('account.row.help')).toBeOnTheScreen();
  });
});

describe('the footer', () => {
  beforeEach(() => signedInAs(profileJSON()));

  it('links Terms, Privacy and Contact, and names the company', async () => {
    await renderAccount();
    const footer = screen.getByTestId('account.footer');
    await fireEvent.press(within(footer).getByRole('link', { name: 'Terms' }));
    await fireEvent.press(within(footer).getByRole('link', { name: 'Privacy' }));
    await fireEvent.press(within(footer).getByRole('link', { name: 'Contact' }));
    expect(openURL.mock.calls.map((c) => c[0])).toEqual([
      'https://lifepass.is/terms',
      'https://lifepass.is/privacy',
      'mailto:support@lifepass.is',
    ]);
    expect(within(footer).getByText('Sporta ehf. · Reykjavík, Iceland')).toBeOnTheScreen();
  });

  it('in Icelandic', async () => {
    signedInAs(profileJSON({ locale: 'is' }));
    await renderAccount();
    const footer = screen.getByTestId('account.footer');
    expect(within(footer).getByRole('link', { name: 'Skilmálar' })).toBeOnTheScreen();
    expect(within(footer).getByRole('link', { name: 'Persónuvernd' })).toBeOnTheScreen();
    expect(within(footer).getByRole('link', { name: 'Hafa samband' })).toBeOnTheScreen();
    expect(within(footer).getByText('Sporta ehf. · Reykjavík, Íslandi')).toBeOnTheScreen();
  });
});

afterAll(() => setCurrentLanguage('en'));
