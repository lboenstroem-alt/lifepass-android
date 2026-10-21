/**
 * The gate (iOS PlanGateCard): the buttons per access value, the trial only
 * when the server allows it, the pass line, the example week in full and read
 * as one element, the history line with consent, and the third bullet's
 * Android wording (no Health Connect).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { HealthAccess } from '../../../../health';
import { setCurrentLanguage, translate } from '../../../../i18n';
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import PlanGateCard, { type PlanGateCardProps } from '../PlanGateCard';
import { GATE_BULLETS, gateActions, gateBodyKey, SAMPLE_WEEK, showsPassLine, trialUrl } from '../gateRules';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

describe('the gate table', () => {
  it('sends a company member and a failed payment to Account, with nothing else', () => {
    expect(gateActions('company_inactive', true)).toEqual(['company']);
    expect(gateActions('past_due', true)).toEqual(['fix_payment']);
  });

  it('offers everyone else memberships and the Coach, and the trial only when eligible', () => {
    for (const access of ['not_member', 'pass_only', 'unknown'] as const) {
      expect(gateActions(access, false)).toEqual(['choose', 'day_plan']);
      expect(gateActions(access, true)).toEqual(['choose', 'trial', 'day_plan']);
    }
  });

  it('tells past_due what is wrong, a pass holder what the pass includes', () => {
    expect(gateBodyKey('past_due')).toBe('plan.gate.past_due_body');
    expect(gateBodyKey('not_member')).toBe('plan.gate.body');
    expect(showsPassLine('pass_only')).toBe(true);
    expect(showsPassLine('not_member')).toBe(false);
    expect(showsPassLine('past_due')).toBe(false);
  });

  it('keeps the example week whole: Mon strength 40, Wed swim 30, Fri class 45, Sat hike 60, the rest days', () => {
    expect(SAMPLE_WEEK.map((row) => [row.weekday, row.kind, row.minutes])).toEqual([
      [1, 'strength', 40],
      [2, 'rest', null],
      [3, 'swim', 30],
      [4, 'rest', null],
      [5, 'class', 45],
      [6, 'hike', 60],
      [7, 'rest', null],
    ]);
  });

  it('opens the trial page in the account language', () => {
    expect(trialUrl('en')).toBe('https://www.lifepass.is/en/plans?trial=1');
    expect(trialUrl('is')).toBe('https://www.lifepass.is/is/plans?trial=1');
  });

  it('never promises Apple Health on Android, in either language', () => {
    for (const bullet of GATE_BULLETS) {
      expect(translate(bullet.key, 'en')).not.toMatch(/Apple Health/);
      expect(translate(bullet.key, 'is')).not.toMatch(/Apple Health/);
      expect(translate(bullet.key, 'is')).not.toBe(bullet.key);
    }
  });
});

describe('the gate card', () => {
  let taps: string[];
  let events: { event: string; params: AnalyticsParams }[];

  beforeEach(() => {
    taps = [];
    events = [];
    setAnalyticsObserver((event, params) => events.push({ event, params }));
  });
  afterEach(() => setAnalyticsObserver(null));

  async function renderGate(access: HealthAccess, overrides: Partial<PlanGateCardProps> = {}) {
    await render(
      <PlanGateCard
        access={access}
        trialEligible={false}
        hasConsent={false}
        onChoosePlans={() => taps.push('plans')}
        onOpenAccount={() => taps.push('account')}
        onStartTrial={() => taps.push('trial')}
        onPlanMyDay={() => taps.push('coach')}
        onManageData={() => taps.push('bodyAndGoals')}
        {...overrides}
      />,
    );
  }

  it('says what is included, never what is locked', async () => {
    await renderGate('not_member');
    expect(screen.getByRole('header', { name: en('plan.gate.title') })).toBeOnTheScreen();
    expect(screen.getByText(en('plan.gate.body'))).toBeOnTheScreen();
    expect(screen.getByText(en('plan.gate.b1'))).toBeOnTheScreen();
    expect(screen.getByText(en('plan.gate.b3_android'))).toBeOnTheScreen();
    expect(screen.queryByText(en('plan.gate.b3'))).toBeNull();
  });

  it('a company member activates the company plan in Account', async () => {
    await renderGate('company_inactive', { trialEligible: true });
    await fireEvent.press(screen.getByRole('button', { name: en('plan.gate.cta_company') }));
    expect(taps).toEqual(['account']);
    expect(events).toContainEqual({ event: 'plan_gate_cta_tapped', params: { cta: 'company' } });
    expect(screen.queryByRole('button', { name: en('plan.gate.cta_choose') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('plan.gate.cta_trial') })).toBeNull();
  });

  it('past_due is told about the payment and fixes it in Account', async () => {
    await renderGate('past_due');
    expect(screen.getByText(en('plan.gate.past_due_body'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('health.past_due.cta') }));
    expect(taps).toEqual(['account']);
    expect(events).toContainEqual({ event: 'plan_gate_cta_tapped', params: { cta: 'fix_payment' } });
  });

  it('a pass holder reads the pass line and can plan a day in the Coach', async () => {
    await renderGate('pass_only');
    expect(screen.getByText(en('plan.gate.pass_line'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.gate.day_plan') }));
    await fireEvent.press(screen.getByRole('button', { name: en('plan.gate.cta_choose') }));
    expect(taps).toEqual(['coach', 'plans']);
    expect(events.map((e) => e.params.cta)).toEqual(['day_plan', 'choose']);
  });

  it('shows Try it free only when the server says this account may start a trial', async () => {
    await renderGate('not_member');
    expect(screen.queryByRole('button', { name: en('plan.gate.cta_trial') })).toBeNull();
    await screen.unmount();
    await renderGate('not_member', { trialEligible: true });
    await fireEvent.press(screen.getByRole('button', { name: en('plan.gate.cta_trial') }));
    expect(taps).toEqual(['trial']);
    expect(events).toContainEqual({ event: 'plan_gate_cta_tapped', params: { cta: 'trial' } });
  });

  it('reads the example week as one element', async () => {
    await renderGate('not_member');
    const sample = screen.getByTestId('plan.gate.sample');
    expect(sample.props.accessible).toBe(true);
    expect(sample.props.accessibilityLabel).toBe(`${en('plan.gate.sample_kicker')}. ${en('plan.gate.sample_note')}`);
    expect(screen.getByText(en('plan.gate.sample.sat'), { includeHiddenElements: true })).toBeTruthy();
  });

  it('with consent, says the history is still here and opens Body and goals', async () => {
    await renderGate('not_member');
    expect(screen.queryByText(en('plan.gate.history_line'))).toBeNull();
    await screen.unmount();
    await renderGate('not_member', { hasConsent: true });
    expect(screen.getByText(en('plan.gate.history_line'))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: en('plan.gate.manage_data') }));
    expect(taps).toEqual(['bodyAndGoals']);
  });

  it('speaks Icelandic in Icelandic', async () => {
    setCurrentLanguage('is');
    await renderGate('not_member');
    expect(screen.getByText(translate('plan.gate.b3_android', 'is'))).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: translate('plan.gate.cta_choose', 'is') })).toBeOnTheScreen();
  });
});
