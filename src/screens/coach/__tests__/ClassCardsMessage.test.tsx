/**
 * The chat's class cards as drawn (iOS CoachClassCardsView.swift, API
 * 0.36.0): the reply, then the pop-up list with each class's time, name,
 * venue and price line; Book only on a class that can be booked now, its
 * state otherwise; a close X and "Show classes (n)" to bring the list back.
 * What a card offers and says is tested as pure functions in
 * src/features/coach/chat/__tests__/classCards.test.ts.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StrictMode } from 'react';

import type { CoachPlanClass } from '../../../features/classes/sheet';
import { CARDS_EN, dataOf, SERVER_NOW } from '../../../features/coach/chat/__tests__/classCardFixtures';
import { decodeCoachChatReply } from '../../../features/coach/chat/coachApi';
import { translate, type Params } from '../../../i18n';
import ClassCardsMessage from '../ClassCardsMessage';

// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ where Jest's resolver cannot see it; Metro resolves it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const en = (key: string, params?: Params) => translate(key, 'en', params);

const REPLY = 'Here are classes in Akureyri today. Tap one to book.';
const classes = decodeCoachChatReply(dataOf(CARDS_EN)).classes;

async function draw(
  options: { hidden?: boolean; onSetHidden?: jest.Mock; onBook?: jest.Mock; now?: () => Date } = {},
) {
  const props = {
    intro: REPLY,
    classes,
    hidden: options.hidden ?? false,
    onSetHidden: options.onSetHidden ?? jest.fn(),
    onBook: options.onBook ?? jest.fn(async () => undefined),
    now: options.now ?? (() => SERVER_NOW),
  };
  await render(<ClassCardsMessage {...props} />);
  await act(async () => undefined);
  return props;
}

const bookLabel = (title: string, when: string) => `${en('coach.plan.class.book')}, ${title}, ${when}`;

it('draws the reply over the list: each class with its time, name, venue and price line', async () => {
  await draw();
  expect(screen.getByText(REPLY)).toBeOnTheScreen();
  expect(screen.getByText(en('coach.classes.title'))).toBeOnTheScreen();
  expect(screen.getByText('12:10–13:10')).toBeOnTheScreen();
  expect(screen.getByText('HOT FIT')).toBeOnTheScreen();
  expect(screen.getByText('Nordur Akureyri')).toBeOnTheScreen();
  expect(screen.getByText('Included in your plan · 18 left')).toBeOnTheScreen();
  expect(screen.getByText('From 4,500 ISK · 9 left')).toBeOnTheScreen();
  // A full class says Full on its label, not its spots.
  expect(screen.getByTestId('coach.classes.row.cls_be41a59600.meta')).toHaveTextContent('Included in your plan');
});

it('Book only for a class that can be booked now; Full and Opens later in its place otherwise', async () => {
  await draw();
  expect(screen.getByRole('button', { name: bookLabel('HOT FIT', '12:10–13:10') })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: bookLabel('Sauna ritual', '19:30–20:00') })).toBeOnTheScreen();
  expect(screen.queryByTestId('coach.classes.row.cls_be41a59600.book')).toBeNull();
  expect(screen.getByTestId('coach.classes.row.cls_be41a59600.state')).toHaveTextContent(en('classes.chip_full'));
  expect(screen.queryByTestId('coach.classes.row.cls_094a45a28b.book')).toBeNull();
  expect(screen.getByTestId('coach.classes.row.cls_094a45a28b.state')).toHaveTextContent(en('coach.classes.opens_later'));
});

it('a class that has started says Started, and the list turns to it within a minute of the start', async () => {
  jest.useFakeTimers({ now: new Date('2026-10-13T12:09:30Z') });
  try {
    let clock = new Date('2026-10-13T12:09:30Z');
    await draw({ now: () => clock });
    expect(screen.getByTestId('coach.classes.row.cls_292c2799eb.book')).toBeOnTheScreen();
    clock = new Date('2026-10-13T12:10:30Z');
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(screen.queryByTestId('coach.classes.row.cls_292c2799eb.book')).toBeNull();
    expect(screen.getByTestId('coach.classes.row.cls_292c2799eb.state')).toHaveTextContent(en('coach.classes.started'));
  } finally {
    jest.useRealTimers();
  }
});

it('Book hands that session over, spins meanwhile and ignores a second tap', async () => {
  let finish: () => void = () => undefined;
  const onBook = jest.fn((_session: CoachPlanClass) => new Promise<void>((resolve) => (finish = resolve)));
  await draw({ onBook });
  const book = screen.getByRole('button', { name: bookLabel('Sauna ritual', '19:30–20:00') });
  await fireEvent.press(book);
  expect(screen.getByTestId('coach.classes.row.cls_3d7ee04649.spinner')).toBeOnTheScreen();
  expect(book).toBeBusy();
  await fireEvent.press(book);
  expect(onBook).toHaveBeenCalledTimes(1);
  expect(onBook.mock.calls[0]![0]).toMatchObject({ id: 'cls_3d7ee04649', venueSlug: 'forest-lagoon', surchargeFromIsk: 4500 });
  await act(async () => finish());
  expect(screen.queryByTestId('coach.classes.row.cls_3d7ee04649.spinner')).toBeNull();
});

it('the spinner still clears after the effects ran twice (StrictMode, Fast Refresh)', async () => {
  let finish: () => void = () => undefined;
  const onBook = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
  await render(
    <StrictMode>
      <ClassCardsMessage intro={REPLY} classes={classes} hidden={false} onSetHidden={jest.fn()} onBook={onBook} now={() => SERVER_NOW} />
    </StrictMode>,
  );
  await act(async () => undefined);
  await fireEvent.press(screen.getByTestId('coach.classes.row.cls_292c2799eb.book'));
  expect(screen.getByTestId('coach.classes.row.cls_292c2799eb.spinner')).toBeOnTheScreen();
  await act(async () => finish());
  expect(screen.queryByTestId('coach.classes.row.cls_292c2799eb.spinner')).toBeNull();
});

it('the X closes the list', async () => {
  const onSetHidden = jest.fn();
  await draw({ onSetHidden });
  await fireEvent.press(screen.getByRole('button', { name: en('coach.classes.close') }));
  expect(onSetHidden).toHaveBeenLastCalledWith(true);
});

it('closed, "Show classes (n)" under the reply brings it back', async () => {
  const onSetHidden = jest.fn();
  await draw({ hidden: true, onSetHidden });
  expect(screen.queryByTestId('coach.classes')).toBeNull();
  expect(screen.getByText(REPLY)).toBeOnTheScreen();
  const show = screen.getByRole('button', { name: en('coach.classes.show', { count: '4' }) });
  await fireEvent.press(show);
  expect(onSetHidden).toHaveBeenLastCalledWith(false);
});
