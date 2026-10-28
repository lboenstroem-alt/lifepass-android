/**
 * The open-sheet request behind `openClassSheet`: one sheet at a time, a
 * newer request replaces an idle one (its opener hears `onDismiss`), a sheet
 * with a booking in flight is never taken away, every opener hears exactly
 * one `onDismiss`, and a sign-out forgets the request without calling it.
 */
import { runSignOutCleaners } from '../../../../app/signOut';
import { openClassSheet } from '../open';
import {
  currentClassSheetRequest,
  finishClassSheet,
  presentClassSheet,
  resetClassSheetRequestsForTests,
  setClassSheetBusy,
} from '../requests';
import { ablerOccurrence } from './sheetHarness';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

beforeEach(() => resetClassSheetRequestsForTests());

it('opens one sheet; a second request replaces an idle one and the first opener hears it has gone', () => {
  const first = { onBooked: jest.fn(), onDismiss: jest.fn() };
  const second = { onBooked: jest.fn(), onDismiss: jest.fn() };
  openClassSheet(ablerOccurrence({ eventId: 1 }), first);
  const opened = currentClassSheetRequest();
  expect(opened?.occurrence.id).toBe('occ-1');

  openClassSheet(ablerOccurrence({ eventId: 2 }), second);
  expect(currentClassSheetRequest()?.occurrence.id).toBe('occ-2');
  expect(currentClassSheetRequest()?.id).not.toBe(opened?.id);
  expect(first.onDismiss).toHaveBeenCalledTimes(1);
  expect(first.onBooked).not.toHaveBeenCalled();
  expect(second.onDismiss).not.toHaveBeenCalled();
});

it('a sheet with a booking in flight is not taken away: the new request is dropped, its opener told at once', () => {
  const first = { onDismiss: jest.fn() };
  const second = { onDismiss: jest.fn() };
  openClassSheet(ablerOccurrence({ eventId: 1 }), first);
  const id = currentClassSheetRequest()!.id;
  setClassSheetBusy(id, true);

  openClassSheet(ablerOccurrence({ eventId: 2 }), second);
  expect(currentClassSheetRequest()?.id).toBe(id);
  expect(second.onDismiss).toHaveBeenCalledTimes(1);
  expect(first.onDismiss).not.toHaveBeenCalled();
  expect(presentClassSheet(ablerOccurrence({ eventId: 3 }), {})).toBe(false);

  // Done: replaceable again.
  setClassSheetBusy(id, false);
  expect(presentClassSheet(ablerOccurrence({ eventId: 3 }), {})).toBe(true);
  expect(first.onDismiss).toHaveBeenCalledTimes(1);
});

it('only the open sheet reports busy or ends', () => {
  const first = { onDismiss: jest.fn() };
  openClassSheet(ablerOccurrence({ eventId: 1 }), first);
  const stale = currentClassSheetRequest()!.id;
  openClassSheet(ablerOccurrence({ eventId: 2 }), {});
  setClassSheetBusy(stale, true);
  expect(presentClassSheet(ablerOccurrence({ eventId: 3 }), {})).toBe(true);
  finishClassSheet(stale, 'closed');
  expect(currentClassSheetRequest()?.occurrence.id).toBe('occ-3');
  expect(first.onDismiss).toHaveBeenCalledTimes(1);
});

it('a closed sheet is told once; back from the full schedule it hears onBooked first, then onDismiss', () => {
  const closed = { onBooked: jest.fn(), onDismiss: jest.fn() };
  openClassSheet(ablerOccurrence(), closed);
  const id = currentClassSheetRequest()!.id;
  finishClassSheet(id, 'closed');
  finishClassSheet(id, 'closed');
  expect(closed.onDismiss).toHaveBeenCalledTimes(1);
  expect(closed.onBooked).not.toHaveBeenCalled();
  expect(currentClassSheetRequest()).toBeNull();

  const away = { onBooked: jest.fn(), onDismiss: jest.fn() };
  openClassSheet(ablerOccurrence(), away);
  finishClassSheet(currentClassSheetRequest()!.id, 'otherTimes');
  expect(away.onBooked).toHaveBeenCalledTimes(1);
  expect(away.onDismiss).toHaveBeenCalledTimes(1);
  expect(away.onBooked.mock.invocationCallOrder[0]).toBeLessThan(away.onDismiss.mock.invocationCallOrder[0]!);
});

it("an opener's failing callback never breaks the next sheet", () => {
  openClassSheet(ablerOccurrence({ eventId: 1 }), {
    onDismiss: () => {
      throw new Error('opener gone');
    },
  });
  expect(() => openClassSheet(ablerOccurrence({ eventId: 2 }), {})).not.toThrow();
  expect(currentClassSheetRequest()?.occurrence.id).toBe('occ-2');
});

it('sign-out forgets the open sheet without calling its opener', async () => {
  const opener = { onBooked: jest.fn(), onDismiss: jest.fn() };
  openClassSheet(ablerOccurrence(), opener);
  await runSignOutCleaners({ memberId: 'member-a' });
  expect(currentClassSheetRequest()).toBeNull();
  expect(opener.onDismiss).not.toHaveBeenCalled();
  expect(opener.onBooked).not.toHaveBeenCalled();
});
