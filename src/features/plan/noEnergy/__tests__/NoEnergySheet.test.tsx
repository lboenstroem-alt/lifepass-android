/**
 * "No energy today?" on screen (iOS NoEnergySheet): the two choices the
 * server allows, a move refused while the sheet is open turning into the
 * skip offer with its line, the reasons and Skip, the missed row's straight
 * path to the reasons, offline, and what each answer does to the sheet. The
 * skip reason never reaches analytics.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { expectRequestValid } from '@test/contract';
import { api, Reply } from '@test/server';
import { useState } from 'react';

import { TransportError } from '../../../../api';
import { stubApiClientPerTest } from '../../../../api/testing';
import { UiKitProvider } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { decodeSessionView, useHealthStore, type SessionView } from '../../../../health';
import { resetHealthStoreForTests } from '../../../../health/store';
import { translate } from '../../../../i18n';
import { todayServerDay } from '../../../../i18n/format';
import { setAnalyticsObserver } from '../../../../lib/analytics';
import { recordAnalytics, settle } from '../../__tests__/planFixtures';
import NoEnergySheet from '../../sheets/NoEnergySheet';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);
const ID = '6e5d4c3b-2a19-4f08-9e7d-6c5b4a392817';
const PATH = `/health/sessions/${ID}`;
const TODAY = todayServerDay();

const planned = (json: Record<string, unknown> = {}): SessionView =>
  decodeSessionView(
    { id: ID, scheduledFor: TODAY, kind: 'strength', title: 'Legs', status: 'planned', canMove: true, canSkip: true, ...json },
    'session',
  );

const ANSWER = { session: { id: ID, scheduledFor: TODAY, kind: 'strength', status: 'skipped', skipReason: 'tired' }, changed: [] };

const handlers = { onResult: jest.fn(), onChangedElsewhere: jest.fn(), onClose: jest.fn() };

function Harness({
  session = planned(),
  tomorrowTitle = null,
  startsInSkipMode = false,
}: {
  session?: SessionView;
  tomorrowTitle?: string | null;
  startsInSkipMode?: boolean;
}) {
  const [visible, setVisible] = useState(true);
  return (
    <UiKitProvider>
      <NoEnergySheet
        visible={visible}
        onClose={() => {
          handlers.onClose();
          setVisible(false);
        }}
        session={session}
        tomorrowTitle={tomorrowTitle}
        startsInSkipMode={startsInSkipMode}
        onResult={handlers.onResult}
        onChangedElsewhere={handlers.onChangedElsewhere}
      />
    </UiKitProvider>
  );
}

async function press(name: string) {
  await fireEvent.press(screen.getByRole('button', { name }));
  await act(async () => settle());
}

const header = (key: string) => screen.queryByRole('header', { name: en(key) });

beforeEach(() => {
  bottomSheetMock.reset();
  resetHealthStoreForTests();
  setAnalyticsObserver(null);
  Object.values(handlers).forEach((handler) => handler.mockReset());
});

afterEach(async () => {
  setAnalyticsObserver(null);
  await settle();
});

describe('choose', () => {
  it('offers the move and the skip the server allows', async () => {
    await render(<Harness />);
    expect(header('noenergy.title')).toBeOnTheScreen();
    expect(screen.getByText(en('noenergy.body'))).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('noenergy.move') })).toBeOnTheScreen();
    expect(screen.getByText(en('noenergy.move_sub'))).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('noenergy.skip') })).toBeOnTheScreen();
    expect(screen.queryByTestId('noenergy.blocked')).toBeNull();
  });

  it('tomorrow holding a session makes the move a swap', async () => {
    await render(<Harness tomorrowTitle="Upper body" />);
    expect(screen.getByRole('button', { name: en('noenergy.swap', { title: 'Upper body' }) })).toBeOnTheScreen();
    expect(screen.getByText(en('noenergy.swap_sub'))).toBeOnTheScreen();
  });

  it("a move the server holds back says why, and Skip it is what's left", async () => {
    await render(<Harness session={planned({ canMove: false, moveBlockedReason: 'past_week' })} />);
    expect(screen.queryByRole('button', { name: en('noenergy.move') })).toBeNull();
    expect(screen.getByText(en('noenergy.move_past_week'))).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('noenergy.skip') })).toBeOnTheScreen();
  });

  it('no skip when the server says canSkip is false', async () => {
    await render(<Harness session={planned({ canSkip: false })} />);
    expect(screen.queryByRole('button', { name: en('noenergy.skip') })).toBeNull();
  });
});

describe('move', () => {
  it('posts the move, hands the answer over and closes', async () => {
    const events = recordAnalytics();
    api.on('POST', PATH, Reply.ok(ANSWER));
    await render(<Harness />);
    await press(en('noenergy.move'));
    const sent = api.sent(PATH, 'POST');
    expectRequestValid(sent);
    expect(sent.body).toEqual({ action: 'move' });
    expect(sent.headers['idempotency-key']).toEqual(expect.any(String));
    expect(handlers.onResult).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ id: ID }) }));
    expect(header('noenergy.title')).toBeNull();
    expect(events).toEqual([{ event: 'workout_moved', params: { kind: 'move' } }]);
  });

  it('a swap is reported as one', async () => {
    const events = recordAnalytics();
    api.on('POST', PATH, Reply.ok(ANSWER));
    await render(<Harness tomorrowTitle="Upper body" />);
    await press(en('noenergy.swap', { title: 'Upper body' }));
    expect(events).toEqual([{ event: 'workout_moved', params: { kind: 'swap' } }]);
  });

  it.each([
    ['session_move_limit', 'limit', 'noenergy.move_limit'],
    ['session_move_past_week', 'past_week', 'noenergy.move_past_week'],
  ])('a %s refusal keeps the sheet open on the skip, with its line', async (slug, reason, lineKey) => {
    const events = recordAnalytics();
    api.on('POST', PATH, Reply.problem(409, slug));
    await render(<Harness />);
    await press(en('noenergy.move'));
    expect(header('noenergy.title')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('noenergy.move') })).toBeNull();
    expect(screen.getByText(en(lineKey))).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('noenergy.skip') })).toBeOnTheScreen();
    expect(handlers.onResult).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(events).toEqual([{ event: 'workout_move_refused', params: { reason } }]);
  });

  it('session_action_not_allowed closes the sheet: the plan changed elsewhere', async () => {
    api.on('POST', PATH, Reply.problem(409, 'session_action_not_allowed', { reason: 'not_today' }));
    await render(<Harness />);
    await press(en('noenergy.move'));
    expect(handlers.onChangedElsewhere).toHaveBeenCalledTimes(1);
    expect(header('noenergy.title')).toBeNull();
  });

  it('offline or a server error keeps the sheet with a line', async () => {
    api.on('POST', PATH, Reply.fail());
    await render(<Harness />);
    await press(en('noenergy.move'));
    expect(screen.getByTestId('noenergy.error')).toHaveTextContent(en('health.offline.action_hint'));

    api.on('POST', PATH, Reply.problem(500, 'internal_error'));
    await press(en('noenergy.move'));
    expect(screen.getByTestId('noenergy.error')).toHaveTextContent(en('common.error_body'));
    expect(header('noenergy.title')).toBeOnTheScreen();
  });
});

describe('skip', () => {
  it('asks why, waits for a reason, and never tells analytics the reason', async () => {
    const events = recordAnalytics();
    api.on('POST', PATH, Reply.ok(ANSWER));
    await render(<Harness />);
    await press(en('noenergy.skip'));
    expect(header('noenergy.skip_title')).toBeOnTheScreen();
    for (const reason of ['time', 'tired', 'sore', 'other']) {
      expect(screen.getByRole('button', { name: en(`noenergy.reason.${reason}`) })).toBeOnTheScreen();
    }
    expect(screen.getByRole('button', { name: en('noenergy.skip_confirm') })).toBeDisabled();

    await press(en('noenergy.reason.tired'));
    expect(screen.getByRole('button', { name: en('noenergy.reason.tired') })).toBeSelected();
    await press(en('noenergy.skip_confirm'));

    const sent = api.sent(PATH, 'POST');
    expectRequestValid(sent);
    expect(sent.body).toEqual({ action: 'skip', skipReason: 'tired' });
    expect(handlers.onResult).toHaveBeenCalledTimes(1);
    expect(header('noenergy.skip_title')).toBeNull();
    expect(events).toEqual([{ event: 'workout_skipped', params: {} }]);
  });

  it('Back returns to the two choices', async () => {
    await render(<Harness />);
    await press(en('noenergy.skip'));
    await press(en('common.back'));
    expect(header('noenergy.title')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: en('noenergy.move') })).toBeOnTheScreen();
  });

  it('a missed row starts on the reasons, with no Back and no move', async () => {
    api.on('POST', PATH, Reply.ok(ANSWER));
    await render(<Harness startsInSkipMode session={planned({ status: 'missed', canMove: false, moveBlockedReason: 'limit' })} />);
    expect(header('noenergy.skip_title')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: en('common.back') })).toBeNull();
    expect(screen.queryByText(en('noenergy.move_limit'))).toBeNull();
    await press(en('noenergy.reason.time'));
    await press(en('noenergy.skip_confirm'));
    expect(api.sent(PATH, 'POST').body).toEqual({ action: 'skip', skipReason: 'time' });
  });
});

describe('offline', () => {
  it('every choice is off and the sheet says it needs a connection', async () => {
    useHealthStore.setState({ lastError: new TransportError('offline') });
    await render(<Harness />);
    expect(screen.getByTestId('noenergy.offline')).toHaveTextContent(en('health.offline.action_hint'));
    expect(screen.getByRole('button', { name: en('noenergy.move') })).toBeDisabled();
    expect(screen.getByRole('button', { name: en('noenergy.skip') })).toBeDisabled();
  });

  it('a missed row offline cannot confirm the skip', async () => {
    useHealthStore.setState({ lastError: new TransportError('offline') });
    await render(<Harness startsInSkipMode />);
    await press(en('noenergy.reason.sore'));
    expect(screen.getByRole('button', { name: en('noenergy.skip_confirm') })).toBeDisabled();
  });
});
