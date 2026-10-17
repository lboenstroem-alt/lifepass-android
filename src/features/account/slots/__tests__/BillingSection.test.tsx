/**
 * Account's billing section (iOS AccountView.billingSection and cardActions):
 * when it shows, what each row says, and the card actions through the real
 * money rail (src/payments) against the stub server, with the Custom Tab
 * mocked.
 */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { api, Reply } from '@test/server';
import * as WebBrowser from 'expo-web-browser';
import { AppState, type AppStateStatus } from 'react-native';

import { stubApiClientPerTest } from '../../../../api/testing';
import { setCurrentLanguage } from '../../../../i18n';
import { freshPaymentsPerTest, MEMBER_A, signIn, storedRecords } from '../../../../payments/__tests__/paymentsHarness';
import { navigationRef, renderInScreen, settle } from '../../billing/__tests__/screenHarness';
import BillingSection from '../BillingSection';

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/; the kit's own tests point Jest at it the same way.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const openAuthSession = jest.mocked(WebBrowser.openAuthSessionAsync);
const DISMISSED = { type: 'dismiss' } as WebBrowser.WebBrowserAuthSessionResult;

stubApiClientPerTest();
freshPaymentsPerTest();

const PERIOD_END = '2026-10-01T10:14:03.512Z';
const CARD = { id: '0b7d4a62-3c9e-4f1a-a2d5-6e8f9c1b2a34', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 };

const selfPaid = (paymentMethod: object | null = CARD) => ({
  subscription: {
    kind: 'self',
    subscriptionId: '5f0c2a6e-8a51-4e0b-9d7e-2b9a1f3c4d10',
    productName: 'Plus',
    productSlug: 'plan-plus',
    status: 'active',
    amountIsk: 14900,
    currentPeriodEndsAt: PERIOD_END,
  },
  paymentMethod,
});

const companyCovered = (paymentMethod: object | null = null) => ({
  subscription: {
    kind: 'company',
    subscriptionId: '5f0c2a6e-8a51-4e0b-9d7e-2b9a1f3c4d10',
    productName: 'Plus',
    productSlug: 'plan-plus',
    status: 'active',
    amountIsk: 0,
    currentPeriodEndsAt: PERIOD_END,
    companyName: 'KPMG',
    memberPriceIsk: 14900,
    subsidyIsk: 14900,
  },
  paymentMethod,
});

const noPlan = (paymentMethod: object | null) => ({ subscription: { kind: 'none' }, paymentMethod });

beforeEach(() => {
  signIn();
});

async function show() {
  await renderInScreen(BillingSection);
  await settle();
}

/** The row's label and value, as TalkBack reads the grouped row. */
function rowText(id: string): string {
  const row = screen.getByTestId(`billing.row.${id}`);
  const texts: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') texts.push(node);
    else if (node && typeof node === 'object' && 'children' in node) {
      for (const child of (node as { children: unknown[] }).children) walk(child);
    }
  };
  walk(row);
  return texts.join(' | ');
}

describe('when the section shows', () => {
  it('a member with nothing to pay and no card sees no Billing heading at all', async () => {
    api.on('GET', '/billing/summary', Reply.ok(noPlan(null)));
    await show();
    expect(screen.queryByTestId('billing.section')).toBeNull();
    expect(screen.queryByText('BILLING')).toBeNull();
  });

  it('a failed read, or a server without the route, leaves it hidden rather than guessing', async () => {
    api.on('GET', '/billing/summary', Reply.problem(500, 'internal_error'));
    await show();
    expect(screen.queryByTestId('billing.section')).toBeNull();

    api.on('GET', '/billing/summary', Reply.raw(404, '<html>Not found</html>'));
    await act(async () => navigationRef.navigate('Other'));
    await act(async () => navigationRef.goBack());
    await settle();
    expect(screen.queryByTestId('billing.section')).toBeNull();
  });

  it('an unknown future kind with a card shows only the card', async () => {
    api.on('GET', '/billing/summary', Reply.ok({ subscription: { kind: 'flex' }, paymentMethod: CARD }));
    await show();
    expect(screen.getByText('BILLING')).toBeTruthy();
    expect(screen.queryByTestId('billing.row.youPay')).toBeNull();
    expect(rowText('card')).toBe('Payment card | Visa ···· 4242');
  });

  it('is read again on every appearance of Account (iOS .task)', async () => {
    api.on('GET', '/billing/summary', Reply.ok(noPlan(null)));
    await show();
    expect(api.sentAll('/billing/summary')).toHaveLength(1);

    api.on('GET', '/billing/summary', Reply.ok(selfPaid()));
    await act(async () => navigationRef.navigate('Other'));
    await act(async () => navigationRef.goBack());
    await settle();
    expect(api.sentAll('/billing/summary')).toHaveLength(2);
    expect(screen.getByTestId('billing.section')).toBeTruthy();
  });
});

describe('what it says', () => {
  it('a self-paid membership: the monthly amount and the card; Replace, and no Remove while it bills the card', async () => {
    api.on('GET', '/billing/summary', Reply.ok(selfPaid()));
    await show();
    expect(rowText('youPay')).toBe('You pay | ISK 14,900 / month');
    expect(screen.queryByTestId('billing.row.employer')).toBeNull();
    expect(rowText('card')).toBe('Payment card | Visa ···· 4242');
    expect(screen.getByRole('button', { name: 'Replace card' })).toBeTruthy();
    expect(screen.queryByTestId('billing.card.remove')).toBeNull();
  });

  it('a fully covered company plan: 0 kr said plainly, the arithmetic, and no card as a fact', async () => {
    api.on('GET', '/billing/summary', Reply.ok(companyCovered()));
    await show();
    expect(rowText('youPay')).toBe('You pay | Nothing — fully covered');
    expect(rowText('employer')).toBe('Employer | KPMG covers ISK 14,900 of ISK 14,900');
    expect(rowText('card')).toBe('Payment card | No card on file');
    expect(screen.getByRole('button', { name: 'Add card' })).toBeTruthy();
    expect(screen.queryByTestId('billing.card.remove')).toBeNull();
  });

  it('a card nothing is charged to can be removed', async () => {
    api.on('GET', '/billing/summary', Reply.ok(companyCovered(CARD)));
    await show();
    expect(screen.getByRole('button', { name: 'Replace card' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove card' })).toBeTruthy();
  });

  it('in Icelandic', async () => {
    setCurrentLanguage('is');
    api.on('GET', '/billing/summary', Reply.ok(selfPaid()));
    await show();
    expect(screen.getByText('GREIÐSLUR')).toBeTruthy();
    expect(rowText('youPay')).toBe('Þú greiðir | ISK 14,900 / mán.');
    expect(rowText('card')).toBe('Greiðslukort | Visa ···· 4242');
    expect(screen.getByRole('button', { name: 'Skipta um kort' })).toBeTruthy();
  });
});

describe('removing the card', () => {
  beforeEach(() => {
    api.on('GET', '/billing/summary', Reply.ok(noPlan(CARD)));
  });

  it('takes two taps, then removes and reads the summary again', async () => {
    api.on('DELETE', '/billing/payment-method', () => {
      api.on('GET', '/billing/summary', Reply.ok(noPlan(null)));
      return Reply.ok({ removed: true });
    });
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Remove card' }));
    expect(api.sentAll('/billing/payment-method')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Tap again to remove' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Tap again to remove' }));
    await settle();
    expect(api.sentAll('/billing/payment-method', 'DELETE')).toHaveLength(1);
    expect(api.sentAll('/billing/summary')).toHaveLength(2);
    // Nothing to pay and no card any more: the section has nothing to say.
    expect(screen.queryByTestId('billing.section')).toBeNull();
  });

  it('409: the membership needs the card, said in its own words; the card stays', async () => {
    api.on('DELETE', '/billing/payment-method', Reply.problem(409, 'card_required_by_subscription'));
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove card' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Tap again to remove' }));
    await settle();
    expect(screen.getByTestId('billing.error')).toHaveTextContent(
      "This card pays for your membership and can't be removed.",
    );
    expect(rowText('card')).toBe('Payment card | Visa ···· 4242');
    // Disarmed again: the next removal starts with the first tap.
    expect(screen.getByRole('button', { name: 'Remove card' })).toBeTruthy();
  });

  it('502 (or anything else): nothing was changed', async () => {
    api.on('DELETE', '/billing/payment-method', Reply.problem(502, 'card_removal_failed'));
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove card' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Tap again to remove' }));
    await settle();
    expect(screen.getByTestId('billing.error')).toHaveTextContent("The card couldn't be removed. Nothing was changed.");
    expect(rowText('card')).toBe('Payment card | Visa ···· 4242');
  });
});

describe('adding or replacing the card', () => {
  beforeEach(() => {
    api.on('POST', '/billing/payment-methods/setup-session', Reply.ok({ url: 'https://pay.kling.is/setup/s_1' }));
  });

  it('opens the setup page and, however it closed, confirms and reads the summary again', async () => {
    api.on('GET', '/billing/summary', Reply.ok(companyCovered()));
    api.on('POST', '/billing/payment-methods/confirm', () => {
      api.on('GET', '/billing/summary', Reply.ok(companyCovered(CARD)));
      return Reply.ok({ card: { brand: 'visa', last4: '4242' } });
    });
    openAuthSession.mockResolvedValueOnce(DISMISSED);
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Add card' }));
    await settle();

    const setup = api.sent('/billing/payment-methods/setup-session', 'POST');
    expect(setup.body).toEqual({
      successUrl: 'lifepass://card-setup-success',
      cancelUrl: 'lifepass://card-setup-canceled',
    });
    expect(setup.headers['idempotency-key']).toBeTruthy();
    expect(openAuthSession).toHaveBeenCalledWith('https://pay.kling.is/setup/s_1', 'lifepass://card-setup-', {
      createTask: false,
    });
    expect(api.sentAll('/billing/payment-methods/confirm')).toHaveLength(1);
    expect(api.sentAll('/billing/summary')).toHaveLength(2);
    expect(rowText('card')).toBe('Payment card | Visa ···· 4242');
    expect(screen.getByRole('button', { name: 'Replace card' })).toBeTruthy();
    expect(await storedRecords(MEMBER_A)).toEqual([]);
  });

  it('the cancel link confirms too: the way the page closed proves nothing', async () => {
    api.on('GET', '/billing/summary', Reply.ok(selfPaid()));
    api.on('POST', '/billing/payment-methods/confirm', Reply.ok({ card: null }));
    openAuthSession.mockResolvedValueOnce({ type: 'success', url: 'lifepass://card-setup-canceled' });
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Replace card' }));
    await settle();
    expect(api.sentAll('/billing/payment-methods/confirm')).toHaveLength(1);
    expect(api.sentAll('/billing/summary')).toHaveLength(2);
    expect(screen.queryByTestId('billing.error')).toBeNull();
  });

  it('a page that could not be opened says so, and confirms nothing', async () => {
    api.on('GET', '/billing/summary', Reply.ok(selfPaid()));
    api.on('POST', '/billing/payment-methods/setup-session', Reply.problem(503, 'internal_error'));
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Replace card' }));
    await settle();
    expect(screen.getByTestId('billing.error')).toHaveTextContent("Couldn't open the card page. Try again.");
    expect(openAuthSession).not.toHaveBeenCalled();
    expect(api.sentAll('/billing/payment-methods/confirm')).toHaveLength(0);
  });

  it('reads "Opening…" and refuses a second tap until the page is up, then the usual words while it is open', async () => {
    api.on('GET', '/billing/summary', Reply.ok(selfPaid()));
    api.on('POST', '/billing/payment-methods/confirm', Reply.ok({ card: null }));
    let closePage: (() => void) | null = null;
    openAuthSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          closePage = () => resolve(DISMISSED);
        }),
    );
    const listeners: ((state: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
      if (type === 'change') listeners.push(listener as (state: AppStateStatus) => void);
      return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
    });
    await show();

    await fireEvent.press(screen.getByRole('button', { name: 'Replace card' }));
    await settle();
    const busy = screen.getByTestId('billing.card.add');
    expect(busy).toHaveAccessibleName('Opening…');
    expect(busy).toBeDisabled();
    await fireEvent.press(busy);
    expect(api.sentAll('/billing/payment-methods/setup-session')).toHaveLength(1);

    // The Custom Tab covers the app.
    await act(async () => listeners.forEach((listener) => listener('background')));
    expect(screen.getByTestId('billing.card.add')).toHaveAccessibleName('Replace card');
    expect(screen.getByTestId('billing.card.add')).toBeDisabled();

    await act(async () => closePage!());
    await settle();
    expect(screen.getByTestId('billing.card.add')).not.toBeDisabled();
    expect(api.sentAll('/billing/payment-methods/confirm')).toHaveLength(1);
  });
});
