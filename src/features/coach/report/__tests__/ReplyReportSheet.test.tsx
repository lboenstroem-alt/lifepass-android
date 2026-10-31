/**
 * The "Report this reply" sheet (Android COACH-7), through the real client
 * against the stub server: what it shows, what it sends, one
 * Idempotency-Key per presentation reused on a retry, each failure's words,
 * a session that has ended (which only closes it), a 401 that keeps the
 * session (words, and the key kept), and hardware Back.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { BackHandler } from 'react-native';
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { resetUiKit, ToastHost } from '../../../../components/ui';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { lookup, setCurrentLanguage } from '../../../../i18n';
import { COACH_REPORTS_PATH } from '../api';
import ReplyReportSheet from '../ReplyReportSheet';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@gorhom/bottom-sheet', () => require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule);
// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ where Jest's resolver cannot see it; Metro resolves it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
/* eslint-enable @typescript-eslint/no-require-imports */

stubApiClientPerTest();

const REPLY = 'Skip the warm-up, it only wastes time.';
const en = (key: string) => lookup(key, 'en');
const is = (key: string) => lookup(key, 'is');
const CREATED = Reply.ok({ id: 'f1e2d3c4-b5a6-4789-8abc-def012345678', createdAt: '2026-10-28T12:00:00.000Z' }, 201);

/** The sheet as the Coach holds it: up until it asks to close, then gone. */
function Harness({ onClosed, reply = REPLY }: { onClosed?: () => void; reply?: string }) {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  return (
    <>
      {mounted ? (
        <ReplyReportSheet
          visible={visible}
          reply={reply}
          onClose={() => setVisible(false)}
          onClosed={() => {
            setMounted(false);
            onClosed?.();
          }}
        />
      ) : null}
      <ToastHost />
    </>
  );
}

const sent = () => api.sentAll(COACH_REPORTS_PATH, 'POST');
const keys = () => sent().map((request) => request.headers['idempotency-key']);
const sendButton = (lang: 'en' | 'is' = 'en') => screen.getByRole('button', { name: lookup('coach.report.send', lang) });

async function settle() {
  await act(async () => {
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function choose(reason: string, lang: 'en' | 'is' = 'en') {
  await act(async () => fireEvent.press(screen.getByRole('radio', { name: lookup(`coach.report.reason.${reason}`, lang) })));
}

async function pressSend(lang: 'en' | 'is' = 'en') {
  await act(async () => fireEvent.press(sendButton(lang)));
  await settle();
}

beforeEach(() => {
  bottomSheetMock.reset();
  // The toast host is app-wide: no toast from an earlier test.
  resetUiKit();
});

describe('the sheet', () => {
  it('is titled "Report this reply", lists the four reasons in order, and has the optional note', async () => {
    await render(<Harness />);
    expect(screen.getByRole('header', { name: en('coach.report.title') })).toBeOnTheScreen();
    expect(en('coach.report.title')).toBe('Report this reply');
    expect(screen.getAllByRole('radio').map((row) => row.props.accessibilityLabel)).toEqual([
      'Offensive or hateful',
      'Harmful or unsafe advice',
      'Wrong or misleading',
      'Something else',
    ]);
    for (const row of screen.getAllByRole('radio')) expect(row).not.toBeChecked();
    const note = screen.getByLabelText('Anything to add? (optional)');
    expect(note.props.maxLength).toBe(500);
    expect(screen.getByText(en('coach.report.privacy'))).toBeOnTheScreen();
  });

  it('keeps Send off until a reason is chosen, and the choice is checked', async () => {
    await render(<Harness />);
    expect(sendButton()).toBeDisabled();
    await pressSend();
    expect(sent()).toHaveLength(0);
    await choose('harmful');
    expect(screen.getByRole('radio', { name: 'Harmful or unsafe advice' })).toBeChecked();
    expect(sendButton()).toBeEnabled();
  });

  it('sends the reply, the reason, the note and the locale with one key, thanks the member and closes', async () => {
    api.on('POST', COACH_REPORTS_PATH, CREATED);
    const onClosed = jest.fn();
    await render(<Harness onClosed={onClosed} reply={`  ${REPLY}\n`} />);
    await choose('offensive');
    await act(async () => fireEvent.changeText(screen.getByLabelText(en('coach.report.note')), '  It was rude.  '));
    await pressSend();

    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.body).toEqual({ reply: REPLY, reason: 'offensive', note: 'It was rude.', locale: 'en' });
    expect(sent()[0]!.headers.authorization).toBe('Bearer test-token');
    expect(keys()[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText("Thanks. We'll look at it.")).toBeOnTheScreen();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('header', { name: en('coach.report.title') })).toBeNull();
  });

  it('a blank note is not sent at all', async () => {
    api.on('POST', COACH_REPORTS_PATH, CREATED);
    await render(<Harness />);
    await choose('other');
    await act(async () => fireEvent.changeText(screen.getByLabelText(en('coach.report.note')), '   '));
    await pressSend();
    expect(sent()[0]!.body).toEqual({ reply: REPLY, reason: 'other', locale: 'en' });
  });

  it('is in Icelandic for an Icelandic reader, and asks for an Icelandic review', async () => {
    setCurrentLanguage('is');
    api.on('POST', COACH_REPORTS_PATH, CREATED);
    await render(<Harness />);
    expect(screen.getByRole('header', { name: is('coach.report.title') })).toBeOnTheScreen();
    expect(screen.getByLabelText(is('coach.report.note'))).toBeOnTheScreen();
    await choose('inaccurate', 'is');
    await pressSend('is');
    expect((sent()[0]!.body as { locale: string }).locale).toBe('is');
    expect(screen.getByText(is('coach.report.sent'))).toBeOnTheScreen();
  });
});

describe('a failure', () => {
  it('offline: the usual retry words on the sheet, the choices kept, and Send again reuses the key', async () => {
    // The later route wins: the first request fails, the next one is stored.
    api.on('POST', COACH_REPORTS_PATH, CREATED);
    api.once('POST', COACH_REPORTS_PATH, Reply.fail());
    const onClosed = jest.fn();
    await render(<Harness onClosed={onClosed} />);
    await choose('harmful');
    await pressSend();

    expect(screen.getByTestId('coach.report.error')).toHaveTextContent(en('error.network'));
    expect(screen.getByRole('radio', { name: 'Harmful or unsafe advice' })).toBeChecked();
    expect(onClosed).not.toHaveBeenCalled();

    await pressSend();
    expect(keys()).toHaveLength(2);
    expect(keys()[1]).toBe(keys()[0]);
    expect(sent()[1]!.body).toEqual(sent()[0]!.body);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('5xx: our failure in the usual words, and the retry carries the same key', async () => {
    api.on('POST', COACH_REPORTS_PATH, CREATED);
    api.once('POST', COACH_REPORTS_PATH, Reply.problem(503, 'service_unavailable'));
    await render(<Harness />);
    await choose('other');
    await pressSend();
    expect(screen.getByTestId('coach.report.error')).toHaveTextContent(en('error.server'));
    await pressSend();
    expect(keys()[1]).toBe(keys()[0]);
    expect(screen.getByText(en('coach.report.sent'))).toBeOnTheScreen();
  });

  it('429: says the member has sent many reports; a later Send is a new attempt with a new key', async () => {
    api.on('POST', COACH_REPORTS_PATH, Reply.problem(429, 'rate-limited'));
    const onClosed = jest.fn();
    await render(<Harness onClosed={onClosed} />);
    await choose('offensive');
    await pressSend();
    expect(screen.getByTestId('coach.report.error')).toHaveTextContent(
      "You've sent a lot of reports. Please try again later.",
    );
    expect(screen.queryByText(/Server detail/)).toBeNull();
    expect(onClosed).not.toHaveBeenCalled();
    await pressSend();
    expect(keys()).toHaveLength(2);
    expect(keys()[1]).not.toBe(keys()[0]);
  });

  it('401: the session has ended (the app goes to sign-in), so the sheet just closes, with no toast or words', async () => {
    api.on('POST', COACH_REPORTS_PATH, Reply.problem(401, 'unauthorized'));
    const onClosed = jest.fn();
    await render(<Harness onClosed={onClosed} />);
    await choose('offensive');
    await pressSend();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(en('coach.report.sent'))).toBeNull();
    expect(screen.queryByText(en('error.sign_in'))).toBeNull();
  });
});

describe('a 401 whose refresh only failed for a while (the auth server unreachable, a 5xx, a 429)', () => {
  // The client keeps the session and throws the 401 as it came.
  const flaky = stubApiClientPerTest({
    refreshedToken: async () => {
      throw new Error('auth server unreachable');
    },
  });

  it('keeps the member signed in: the sheet stays up in words, and Send again reuses the key', async () => {
    api.on('POST', COACH_REPORTS_PATH, Reply.problem(401, 'authentication_required'));
    const onClosed = jest.fn();
    await render(<Harness onClosed={onClosed} />);
    await choose('harmful');
    await pressSend();
    expect(flaky.revoked).toBe(0);
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.getByTestId('coach.report.error')).toHaveTextContent(en('error.sign_in'));
    expect(screen.queryByText(/Server detail/)).toBeNull();
    expect(screen.getByRole('radio', { name: en('coach.report.reason.harmful') })).toBeChecked();

    // The token is good again: the same key goes out, and the report is stored.
    api.on('POST', COACH_REPORTS_PATH, CREATED);
    await pressSend();
    expect(keys()).toHaveLength(2);
    expect(keys()[1]).toBe(keys()[0]);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.getByText(en('coach.report.sent'))).toBeOnTheScreen();
  });
});

describe('closing', () => {
  it('hardware Back closes it, and is refused (but consumed) while the report is on its way', async () => {
    let answer: () => void = () => undefined;
    api.on('POST', COACH_REPORTS_PATH, () => new Promise((resolve) => (answer = () => resolve(CREATED))));
    const addListener = jest.spyOn(BackHandler, 'addEventListener');
    const onClosed = jest.fn();
    try {
      await render(<Harness onClosed={onClosed} />);
      await choose('other');
      await act(async () => fireEvent.press(sendButton()));
      await settle();
      expect(sent()).toHaveLength(1);
      const back = addListener.mock.calls.filter(([event]) => event === 'hardwareBackPress').at(-1)![1];
      let consumed: boolean | null | undefined;
      await act(async () => {
        consumed = back();
      });
      expect(consumed).toBe(true);
      expect(onClosed).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: en('common.cancel') })).toBeDisabled();
      await act(async () => answer());
      await settle();
      expect(onClosed).toHaveBeenCalledTimes(1);
    } finally {
      addListener.mockRestore();
    }
  });

  it('hardware Back, or Cancel, closes it without sending anything', async () => {
    const addListener = jest.spyOn(BackHandler, 'addEventListener');
    const onClosed = jest.fn();
    try {
      await render(<Harness onClosed={onClosed} />);
      await choose('offensive');
      const back = addListener.mock.calls.filter(([event]) => event === 'hardwareBackPress').at(-1)![1];
      await act(async () => {
        back();
      });
      await settle();
      expect(onClosed).toHaveBeenCalledTimes(1);
      expect(sent()).toHaveLength(0);
    } finally {
      addListener.mockRestore();
    }

    const closedAgain = jest.fn();
    await render(<Harness onClosed={closedAgain} />);
    await act(async () => fireEvent.press(screen.getByRole('button', { name: en('common.cancel') })));
    await settle();
    expect(closedAgain).toHaveBeenCalledTimes(1);
    expect(sent()).toHaveLength(0);
  });

  it('each presentation has its own key and starts with nothing chosen', async () => {
    api.on('POST', COACH_REPORTS_PATH, CREATED);
    const first = await render(<Harness />);
    await choose('offensive');
    await pressSend();
    await first.unmount();
    await render(<Harness />);
    for (const row of screen.getAllByRole('radio')) expect(row).not.toBeChecked();
    await choose('offensive');
    await pressSend();
    expect(keys()).toHaveLength(2);
    expect(keys()[1]).not.toBe(keys()[0]);
  });
});
