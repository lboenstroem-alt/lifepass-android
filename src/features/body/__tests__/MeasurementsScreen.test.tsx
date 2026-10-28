/**
 * The weight history on screen (iOS `MeasurementsView`): the rows and their
 * lines, the 30-row pages, the empty and error states, and the delete, by
 * TalkBack's action or the swipe's button, with its question (and the
 * connected-app note), the profile read after it, a row already gone removed
 * silently (404), and any other failure reloading page one; a next page
 * asked for twice in one breath, or overtaken by that reload, never sticks
 * or doubles the list.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { api, Reply, type StubReply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { resetHealthStoreForTests, useHealthStore } from '../../../health/store';
import { setCurrentLanguage, translate } from '../../../i18n';
import * as analytics from '../../../lib/analytics';
import { resetAppStoreForTests } from '../../../stores/appStore';
import MeasurementsScreen from '../MeasurementsScreen';
import { measurementsPage, profileJson, renderPushed, settle, signIn, weighIn } from './harness';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

stubApiClientPerTest();

// A page with a navigator, sheets and the network: room for a busy machine.
jest.setTimeout(30_000);

const en = (key: string, params?: Record<string, string>) => translate(key, 'en', params);

/**
 * Under Jest's Reanimated mock the swipe's gesture callbacks are not
 * workletised, and the gesture handler says so on every render; on a phone
 * the Babel plugin does it. That one message is not about this screen.
 */
const WORKLET_NOTICE = 'Some of the callbacks in the gesture are worklets';
/** Taken once, before any test spies on it: a spy that called the previous spy would call itself. */
const consoleError = console.error;

afterEach(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes(WORKLET_NOTICE)) return;
    consoleError(...args);
  });
  resetAppStoreForTests();
  resetHealthStoreForTests();
  signIn();
  api.on('GET', '/profile', Reply.ok(profileJson()));
});

async function show() {
  await renderPushed('Measurements', MeasurementsScreen, { below: 'BodyAndGoals' });
  await settle();
}

/** A reply the test hands over when it chooses. */
function heldReply() {
  let release: (reply: StubReply) => void = () => undefined;
  const reply = new Promise<StubReply>((resolve) => {
    release = resolve;
  });
  return { reply, release: (answer: StubReply) => release(answer) };
}

const loadMoreRow = () => screen.getByTestId('measurements.loadMore');

async function rowDeleteAction(id: string) {
  await fireEvent(screen.getByTestId(`measurements.row.${id}`), 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
}

describe('the list', () => {
  it('each weigh-in: the weight, then the date and where it came from', async () => {
    api.on(
      'GET',
      '/health/measurements',
      Reply.ok(
        measurementsPage([
          weighIn('m-1', 72.5, 'weekly_prompt', '2026-09-17T08:00:00Z'),
          weighIn('m-2', 73, 'program_intake', '2026-09-10T08:00:00Z'),
          weighIn('m-3', 73.4, 'wearable', '2026-09-03T08:00:00Z'),
          weighIn('m-4', 73.8, 'self_reported', '2026-08-27T08:00:00Z'),
        ]),
      ),
    );
    await show();
    expect(screen.getByText('Weight history'.toUpperCase())).toBeTruthy();
    expect(screen.getByTestId('measurements.row.m-1').props.accessibilityLabel).toBe('72.5 kg, 17 September · Weekly check-in');
    expect(screen.getByTestId('measurements.row.m-2').props.accessibilityLabel).toBe('73 kg, 10 September · Plan setup');
    // A wearable's weigh-in is "Connected app": nothing here names Apple Health.
    expect(screen.getByTestId('measurements.row.m-3').props.accessibilityLabel).toBe('73.4 kg, 3 September · Connected app');
    expect(screen.getByTestId('measurements.row.m-4').props.accessibilityLabel).toBe('73.8 kg, 27 August · You');
    expect(screen.getByTestId('measurements.row.m-1').props.accessibilityActions).toEqual([{ name: 'delete', label: 'Delete' }]);
    expect(screen.queryByTestId('measurements.loadMore')).toBeNull();
  });

  it('in Icelandic', async () => {
    setCurrentLanguage('is');
    signIn({ locale: 'is' });
    api.on('GET', '/health/measurements', Reply.ok(measurementsPage([weighIn('m-1', 72.5, 'weekly_prompt')])));
    await show();
    expect(screen.getByTestId('measurements.row.m-1').props.accessibilityLabel).toBe('72,5 kg, 17. september · Vikuyfirferð');
  });

  it('30 at a time: "Show older entries" reads the next page with the cursor and appends it', async () => {
    api.once('GET', '/health/measurements', Reply.ok(measurementsPage([weighIn('m-1', 72.5)], 'cursor-2')));
    await show();
    expect(api.sent('/health/measurements').query).toEqual({ limit: '30' });

    api.once('GET', '/health/measurements', Reply.ok(measurementsPage([weighIn('m-31', 75)])));
    await fireEvent.press(screen.getByRole('button', { name: en('bodygoals.history.load_more') }));
    await settle();
    expect(api.sent('/health/measurements').query).toEqual({ limit: '30', cursor: 'cursor-2' });
    expect(screen.getByTestId('measurements.row.m-1')).toBeTruthy();
    expect(screen.getByTestId('measurements.row.m-31')).toBeTruthy();
    expect(screen.queryByTestId('measurements.loadMore')).toBeNull();
  });

  it('empty: "No weight entries yet."', async () => {
    api.on('GET', '/health/measurements', Reply.ok(measurementsPage([])));
    await show();
    expect(screen.getByText(en('bodygoals.history.empty'))).toBeTruthy();
  });

  it('a failed read: the error and Try again, never "no entries"', async () => {
    api.once('GET', '/health/measurements', Reply.problem(500, 'internal_error'));
    await show();
    expect(screen.getByText(en('common.error_body'))).toBeTruthy();
    expect(screen.queryByText(en('bodygoals.history.empty'))).toBeNull();

    api.on('GET', '/health/measurements', Reply.ok(measurementsPage([weighIn('m-1', 72.5)])));
    await fireEvent.press(screen.getByRole('button', { name: en('health.retry') }));
    await settle();
    expect(screen.getByTestId('measurements.row.m-1')).toBeTruthy();
    expect(screen.queryByText(en('common.error_body'))).toBeNull();
  });

  it('a refusal on the read goes through the health store (consent gone for a lapsed member: a profile read, never a sheet)', async () => {
    signIn({ access: 'past_due' });
    api.once('GET', '/health/measurements', Reply.problem(409, 'health_consent_required'));
    await show();
    expect(api.sentAll('/profile').length).toBeGreaterThan(0);
  });
});

describe('deleting a weigh-in', () => {
  beforeEach(() => {
    api.on('GET', '/health/measurements', Reply.ok(measurementsPage([weighIn('m-1', 72.5), weighIn('m-2', 73, 'wearable')])));
  });

  it("TalkBack's action asks first; Delete removes the row, reports it and re-reads the profile", async () => {
    const track = jest.spyOn(analytics, 'track');
    api.on('DELETE', '/health/measurements/:id', Reply.ok({ ok: true }));
    await show();

    await rowDeleteAction('m-1');
    expect(screen.getByText(en('bodygoals.delete_row_title'))).toBeTruthy();
    // Only a connected app's weigh-in carries the note.
    expect(screen.queryByText(en('bodygoals.android.delete_wearable_note'))).toBeNull();
    const profileReads = api.sentAll('/profile').length;

    await fireEvent.press(screen.getByTestId('measurements.delete.confirm'));
    await settle();
    expect(api.sent('/health/measurements/m-1', 'DELETE')).toBeTruthy();
    expect(screen.queryByTestId('measurements.row.m-1')).toBeNull();
    expect(screen.getByTestId('measurements.row.m-2')).toBeTruthy();
    expect(track).toHaveBeenCalledWith('measurement_deleted');
    await waitFor(() => expect(api.sentAll('/profile').length).toBe(profileReads + 1));
    await settle();
  });

  it('Cancel deletes nothing', async () => {
    await show();
    await rowDeleteAction('m-1');
    await fireEvent.press(screen.getByTestId('measurements.delete.cancel'));
    await settle();
    expect(api.sentAll('/health/measurements/m-1', 'DELETE')).toHaveLength(0);
    expect(screen.getByTestId('measurements.row.m-1')).toBeTruthy();
  });

  it("a connected app's weigh-in says it will not be added again", async () => {
    await show();
    await rowDeleteAction('m-2');
    expect(screen.getByText(en('bodygoals.android.delete_wearable_note'))).toBeTruthy();
  });

  it("the swipe's Delete button asks the same question", async () => {
    await show();
    await fireEvent.press(screen.getByTestId('measurements.row.m-1.swipeDelete'));
    expect(screen.getByText(en('bodygoals.delete_row_title'))).toBeTruthy();
  });

  it('404 health_measurement_not_found: the row is already gone, which is what was asked; it goes, silently', async () => {
    api.on('DELETE', '/health/measurements/:id', Reply.problem(404, 'health_measurement_not_found'));
    await show();
    const pageReads = api.sentAll('/health/measurements').length;
    await rowDeleteAction('m-1');
    await fireEvent.press(screen.getByTestId('measurements.delete.confirm'));
    await settle();
    expect(screen.queryByTestId('measurements.row.m-1')).toBeNull();
    expect(api.sentAll('/health/measurements')).toHaveLength(pageReads);
    expect(screen.queryByText(en('common.error_body'))).toBeNull();
    // No "changed on another device" notice for it either.
    expect(useHealthStore.getState().toastKey).toBeNull();
  });

  it('any other failure reloads the first page', async () => {
    api.on('DELETE', '/health/measurements/:id', Reply.problem(500, 'internal_error'));
    await show();
    const pageReads = api.sentAll('/health/measurements').length;
    await rowDeleteAction('m-1');
    await fireEvent.press(screen.getByTestId('measurements.delete.confirm'));
    await settle();
    expect(api.sentAll('/health/measurements')).toHaveLength(pageReads + 1);
    expect(screen.getByTestId('measurements.row.m-1')).toBeTruthy();
  });
});

describe('older pages, raced', () => {
  it('a double tap on "Show older entries" reads the next page once and appends it once', async () => {
    api.once('GET', '/health/measurements', Reply.ok(measurementsPage([weighIn('m-1', 72.5)], 'cursor-2')));
    await show();
    const held = heldReply();
    api.once('GET', '/health/measurements', () => held.reply);
    // Both taps land before the re-render that disables the row: two clicks
    // in one turn (a test's press re-renders between taps, a phone may not).
    const row = loadMoreRow();
    await act(async () => {
      row.props.onClick({ nativeEvent: {} });
      row.props.onClick({ nativeEvent: {} });
    });
    held.release(Reply.ok(measurementsPage([weighIn('m-31', 75)])));
    await settle();
    expect(api.sentAll('/health/measurements').filter((r) => r.query.cursor === 'cursor-2')).toHaveLength(1);
    expect(screen.getAllByTestId('measurements.row.m-31')).toHaveLength(1);
  });

  it('a next page overtaken by a reload (a failed delete) never leaves the row spinning, and lands nowhere', async () => {
    let held = heldReply();
    api.on('GET', '/health/measurements', (request) =>
      request.query.cursor ? held.reply : Reply.ok(measurementsPage([weighIn('m-1', 72.5), weighIn('m-2', 73)], 'cursor-2')),
    );
    api.on('DELETE', '/health/measurements/:id', Reply.problem(500, 'internal_error'));
    await show();

    await fireEvent.press(loadMoreRow());
    await settle();
    expect(loadMoreRow().props.accessibilityState).toMatchObject({ busy: true, disabled: true });

    // The delete fails while that page is still on its way: page one again.
    await rowDeleteAction('m-1');
    await fireEvent.press(screen.getByTestId('measurements.delete.confirm'));
    await settle();
    expect(loadMoreRow().props.accessibilityState).toMatchObject({ busy: false, disabled: false });

    // The stale page answers: it is not appended to the fresh first page, and
    // a stale failure would say nothing either.
    held.release(Reply.ok(measurementsPage([weighIn('m-31', 75)])));
    await settle();
    expect(screen.queryByTestId('measurements.row.m-31')).toBeNull();
    expect(loadMoreRow().props.accessibilityState).toMatchObject({ busy: false, disabled: false });

    // And the row works again.
    held = heldReply();
    await fireEvent.press(loadMoreRow());
    held.release(Reply.ok(measurementsPage([weighIn('m-32', 76)])));
    await settle();
    expect(screen.getByTestId('measurements.row.m-32')).toBeTruthy();
    expect(screen.queryByTestId('measurements.loadMore')).toBeNull();
  });

  it('a next page that fails after a reload took over shows no error over the fresh list', async () => {
    const held = heldReply();
    api.on('GET', '/health/measurements', (request) =>
      request.query.cursor ? held.reply : Reply.ok(measurementsPage([weighIn('m-1', 72.5), weighIn('m-2', 73)], 'cursor-2')),
    );
    api.on('DELETE', '/health/measurements/:id', Reply.problem(500, 'internal_error'));
    await show();
    await fireEvent.press(loadMoreRow());
    await rowDeleteAction('m-1');
    await fireEvent.press(screen.getByTestId('measurements.delete.confirm'));
    await settle();
    held.release(Reply.problem(500, 'internal_error'));
    await settle();
    expect(screen.queryByText(en('common.error_body'))).toBeNull();
    expect(screen.getByTestId('measurements.row.m-1')).toBeTruthy();
  });
});
