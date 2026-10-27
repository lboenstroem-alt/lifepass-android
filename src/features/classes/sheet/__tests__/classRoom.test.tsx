/**
 * The class room on the class sheet (API 0.44.0): a labelled row under the
 * time, "Room: Salur 4" in English and "Salur: 4" in Icelandic. The row's
 * room shows while the day's timetable is read; the timetable's (computed
 * live, so it follows a class the club moved) once it answers. A class with no
 * room shows no row, and TalkBack hears the room with the header.
 */
import { act, render, screen } from '@testing-library/react-native';
import { Reply, type StubReply } from '@test/server';

import { stubApiClientPerTest } from '../../../../api/testing';
import { bottomSheetMock } from '../../../../components/ui/testing/bottomSheetMock';
import { restoreTestFontScale, setTestFontScale } from '../../../../hooks/testing';
import { setCurrentLanguage, VenueTimeFormat } from '../../../../i18n';
import { freshPaymentsPerTest, signIn } from '../../../../payments/__tests__/paymentsHarness';
import ClassSheetHost from '../ClassSheetHost';
import { openClassSheet } from '../index';
import { resetClassSheetRequestsForTests } from '../requests';
import { ablerOccurrence, classesReply, fakePages, flush, FREE_PREVIEW, klass, respond, sheetSessionOptions, START } from './sheetHarness';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

stubApiClientPerTest();
freshPaymentsPerTest();

beforeEach(() => {
  signIn();
  setTestFontScale(1);
  bottomSheetMock.reset();
  resetClassSheetRequestsForTests();
});
afterEach(() => restoreTestFontScale());

/** The day's timetable answers when the test says so. */
function slowTimetable(room: string | null | undefined) {
  let answer!: (reply: StubReply) => void;
  const reply = new Promise<StubReply>((resolve) => {
    answer = resolve;
  });
  respond((request) => {
    if (request.path.endsWith('/classes')) return reply;
    if (request.path.endsWith('/booking-preview')) return Reply.ok(FREE_PREVIEW);
    return Reply.problem(404, 'not_found');
  });
  return () => answer(classesReply([klass(4242, START, room === undefined ? {} : { room })]));
}

async function open(room: string | null) {
  await render(<ClassSheetHost pages={fakePages()} sessionOptions={sheetSessionOptions().options} />);
  await act(async () => {
    openClassSheet({ ...ablerOccurrence(), room }, {});
  });
}

it('shows the row’s room at once, then the timetable’s once it answers (a moved class)', async () => {
  setCurrentLanguage('en');
  const answer = slowTimetable('Salur 4');
  await open('Salur 3');
  expect(screen.getByTestId('classsheet.room')).toHaveTextContent('Room: Salur 3', { exact: true });
  await act(async () => {
    answer();
    await flush();
  });
  expect(await screen.findByText('Room: Salur 4')).toBeOnTheScreen();
  expect(screen.queryByText('Room: Salur 3')).toBeNull();
  const when = `${VenueTimeFormat.dayTime(START, 'en')}–11:00`;
  expect(screen.getByTestId('classsheet.header').props.accessibilityLabel).toMatch(
    new RegExp(`^Yoga Flow at Hress, ${when}, Room: Salur 4, `),
  );
});

it('in Icelandic the row drops the repeated word: "Salur: 2 Heitur", never "Salur: Salur 2 Heitur"', async () => {
  setCurrentLanguage('is');
  const answer = slowTimetable('Salur 2 Heitur');
  await open('Salur 2 Heitur');
  await act(async () => {
    answer();
    await flush();
  });
  expect(screen.getByTestId('classsheet.room')).toHaveTextContent('Salur: 2 Heitur', { exact: true });
  expect(screen.queryByText(/Salur: Salur/)).toBeNull();
});

it('a class the timetable now has no room for shows none, and one with none never did', async () => {
  setCurrentLanguage('en');
  const answer = slowTimetable(null);
  await open(null);
  expect(screen.queryByTestId('classsheet.room')).toBeNull();
  await act(async () => {
    answer();
    await flush();
  });
  expect(screen.queryByTestId('classsheet.room')).toBeNull();
  expect(screen.getByTestId('classsheet.header').props.accessibilityLabel).not.toMatch(/Room/);
});
