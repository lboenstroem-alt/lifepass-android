/**
 * The membership gate a member without a membership meets instead of any
 * meal screen (iOS MealGateSheet and MealGatePresenter), the consent
 * presenter, the under-18 card, and the host the app shell mounts.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { bottomSheetMock } from '../../components/ui/testing/bottomSheetMock';
import { restoreTestFontScale, setTestFontScale } from '../../hooks/testing';
import { translate } from '../../i18n';
import { registeredHookIds, runSignOutCleaners } from '../../app/signOut';
import HealthHost from '../HealthHost';
import { openHealthConsent, closeHealthConsent, resetHealthConsentPresenter, useHealthConsentPresenter } from '../consent/presenter';
import { mealGateCopy, presentMealGate, resetMealGatePresenter, useMealGatePresenter } from '../gate/mealGate';
import MinorCard from '../minor/MinorCard';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const en = (key: string) => translate(key, 'en');

beforeEach(() => {
  bottomSheetMock.reset();
  setTestFontScale(1);
  resetMealGatePresenter();
  resetHealthConsentPresenter();
});
afterEach(() => restoreTestFontScale());

describe('the meal gate copy per access value', () => {
  it('a pass holder, a company member, a payment problem and everyone else', () => {
    expect(mealGateCopy('pass_only')).toEqual(expect.objectContaining({ bodyKey: 'meal.gate.body_pass', ctaKey: 'plan.gate.cta_choose', opens: 'plans' }));
    expect(mealGateCopy('company_inactive')).toEqual(expect.objectContaining({ bodyKey: 'meal.gate.body_company', ctaKey: 'plan.gate.cta_company', opens: 'account' }));
    expect(mealGateCopy('past_due')).toEqual(expect.objectContaining({ bodyKey: 'meal.gate.body_past_due', ctaKey: 'health.past_due.cta', opens: 'account' }));
    for (const access of ['not_member', 'unknown', 'entitled', 'minor'] as const) {
      expect(mealGateCopy(access)).toEqual(expect.objectContaining({ bodyKey: 'meal.gate.body', ctaKey: 'plan.gate.cta_choose', opens: 'plans' }));
    }
  });
});

describe('the host', () => {
  function renderHost() {
    const routes: string[] = [];
    const view = render(
      <HealthHost onSeeMemberships={() => routes.push('plans')} onOpenAccount={() => routes.push('account')} />,
    );
    return { routes, view };
  }

  it('shows nothing until something is presented', async () => {
    await renderHost().view;
    expect(screen.queryByText(en('meal.gate.title'))).toBeNull();
    expect(screen.queryByText(en('healthconsent.title'))).toBeNull();
  });

  it('a gate presented from a refusal: See memberships closes it, then opens the catalogue', async () => {
    const { routes, view } = renderHost();
    await view;
    await act(async () => presentMealGate('not_member'));
    expect(screen.getByRole('header', { name: en('meal.gate.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('meal.gate.body'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.gate.cta_choose') }));
    await waitFor(() => expect(routes).toEqual(['plans']));
    expect(useMealGatePresenter.getState().visible).toBe(false);
  });

  it('a company member is sent to Account; Cancel only closes', async () => {
    const { routes, view } = renderHost();
    await view;
    await act(async () => presentMealGate('company_inactive'));
    expect(screen.getByText(en('meal.gate.body_company'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.gate.cta_company') }));
    await waitFor(() => expect(routes).toEqual(['account']));

    await act(async () => presentMealGate('past_due'));
    await fireEvent.press(screen.getByRole('button', { name: en('common.cancel') }));
    expect(routes).toEqual(['account']);
    expect(useMealGatePresenter.getState().visible).toBe(false);
  });

  it('the consent sheet opens from anywhere, once at a time, and runs what was asked after a grant', async () => {
    await renderHost().view;
    const first = jest.fn();
    await act(async () => {
      expect(openHealthConsent({ entry: 'scan', onGranted: first })).toBe(true);
    });
    expect(openHealthConsent({ entry: 'coach' })).toBe(false);
    expect(screen.getByRole('header', { name: en('healthconsent.title') })).toBeOnTheScreen();
    await act(async () => closeHealthConsent());
    expect(useHealthConsentPresenter.getState().visible).toBe(false);
    expect(first).not.toHaveBeenCalled();
  });

  it('a sign-out drops whatever was presented for the member who left', async () => {
    expect(registeredHookIds().signOut).toContain('health.sheets');
    presentMealGate('pass_only');
    openHealthConsent({ entry: 'plan' });
    await runSignOutCleaners({ memberId: null });
    expect(useMealGatePresenter.getState()).toEqual({ access: null, visible: false });
    expect(useHealthConsentPresenter.getState()).toEqual({ request: null, visible: false });
  });
});

describe('the under-18 card', () => {
  it('on the Plan tab: the plan kicker, the title, the body in a card, no controls', async () => {
    await render(<MinorCard variant="plan" />);
    expect(screen.getByRole('header', { name: en('health.minor.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('health.minor.body'))).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('in the consent sheet: Done closes it', async () => {
    const done = jest.fn();
    await render(<MinorCard variant="sheet" onDone={done} />);
    await fireEvent.press(screen.getByRole('button', { name: en('common.done') }));
    expect(done).toHaveBeenCalledTimes(1);
  });
});
