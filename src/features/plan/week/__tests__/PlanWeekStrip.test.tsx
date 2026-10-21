/**
 * The week strip on screen (iOS PlanWeekStrip): seven cells with 64 dp
 * targets, each one element whose TalkBack name carries the status word and
 * whose state says which is selected; chevrons only where the week allows;
 * the paused dimming; the progress line; the drawn marks hidden from
 * TalkBack.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { decodeWeekView, type WeekView } from '../../../../health';
import { setCurrentLanguage, translate } from '../../../../i18n';
import { shortDay } from '../../../../i18n/format';
import PlanWeekStrip from '../PlanWeekStrip';
import StatusMark from '../StatusMark';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

function week(overrides: Record<string, unknown> = {}): WeekView {
  return decodeWeekView(
    {
      weekStartsOn: '2026-09-14',
      planned: 3,
      done: 1,
      canGoBack: true,
      canGoForward: false,
      days: [
        { date: '2026-09-14', weekday: 1, inProgram: true, title: 'Full body', status: 'done' },
        { date: '2026-09-15', weekday: 2, inProgram: false, status: 'rest' },
        { date: '2026-09-16', weekday: 3, inProgram: true, title: 'Easy swim', status: 'missed' },
        { date: '2026-09-17', weekday: 4, inProgram: true, title: 'Yoga class' },
        { date: '2026-09-18', weekday: 5, inProgram: false, status: 'rest' },
        { date: '2026-09-19', weekday: 6, inProgram: true, title: 'Hike', status: 'skipped' },
        { date: '2026-09-20', weekday: 7, inProgram: false, status: 'rest' },
      ],
      ...overrides,
    },
    'week',
  );
}

async function renderStrip(props: Partial<Parameters<typeof PlanWeekStrip>[0]> = {}) {
  const selected: string[] = [];
  const moves: number[] = [];
  await render(
    <PlanWeekStrip
      week={week()}
      selectedDate="2026-09-17"
      todayDate="2026-09-17"
      isPaused={false}
      onSelect={(date) => selected.push(date)}
      onMoveWeek={(delta) => moves.push(delta)}
      {...props}
    />,
  );
  return { selected, moves };
}

describe('the week strip', () => {
  it('names every day with its date, its session and its status as a word', async () => {
    await renderStrip();
    expect(shortDay('2026-09-14', 'en')).toMatch(/^Mon 14 Sep/);
    expect(screen.getByRole('button', { name: `${shortDay('2026-09-14', 'en')}, Full body, done` })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `${shortDay('2026-09-15', 'en')}, Rest day` })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `${shortDay('2026-09-16', 'en')}, Easy swim, missed` })).toBeOnTheScreen();
    // No status from the server, inside the programme: planned.
    expect(screen.getByRole('button', { name: `${shortDay('2026-09-17', 'en')}, Yoga class, planned` })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: `${shortDay('2026-09-19', 'en')}, Hike, skipped` })).toBeOnTheScreen();
  });

  it('says which day is selected, and selects the day tapped', async () => {
    const { selected } = await renderStrip();
    expect(screen.getByTestId('plan.week.day.2026-09-17')).toBeSelected();
    expect(screen.getByTestId('plan.week.day.2026-09-14')).not.toBeSelected();
    await fireEvent.press(screen.getByTestId('plan.week.day.2026-09-14'));
    expect(selected).toEqual(['2026-09-14']);
  });

  it('gives every day a 64 dp tall target', async () => {
    await renderStrip();
    const style = StyleSheet.flatten(screen.getByTestId('plan.week.day.2026-09-15').props.style);
    expect(style.height).toBe(64);
  });

  it('moves a week only where the week allows it', async () => {
    const { moves } = await renderStrip();
    const back = screen.getByRole('button', { name: en('a11y.prev_week') });
    const forward = screen.getByRole('button', { name: en('a11y.next_week') });
    expect(back).toBeEnabled();
    expect(forward).toBeDisabled();
    await fireEvent.press(back);
    await fireEvent.press(forward);
    expect(moves).toEqual([-1]);
  });

  it('keeps one swipe across re-renders, answering with the week and the handler of the moment', async () => {
    const first: number[] = [];
    const latest: number[] = [];
    const props = { selectedDate: '2026-09-17', todayDate: '2026-09-17', isPaused: false, onSelect: () => undefined };
    await render(<PlanWeekStrip {...props} week={week()} onMoveWeek={(delta) => first.push(delta)} />);
    const swipe = getByGestureTestId('plan.week.swipe');
    // The page re-renders mid-drag (the read lands): a new handler, a week
    // that now allows going forward. A rebuilt gesture would lose the drag.
    await screen.rerender(<PlanWeekStrip {...props} week={week({ canGoForward: true })} onMoveWeek={(delta) => latest.push(delta)} />);
    expect(getByGestureTestId('plan.week.swipe')).toBe(swipe);
    await act(async () => {
      fireGestureHandler(swipe, [
        { state: State.BEGAN, translationX: 0, translationY: 0 },
        { state: State.ACTIVE, translationX: -40, translationY: 2 },
        { state: State.END, translationX: -80, translationY: 4 },
      ]);
    });
    expect(first).toEqual([]);
    expect(latest).toEqual([1]);
  });

  it('dims a paused plan and says how the week is going', async () => {
    await renderStrip({ isPaused: true });
    expect(StyleSheet.flatten(screen.getByTestId('plan.week.row').props.style).opacity).toBe(0.5);
    expect(screen.getByText(en('plan.week.progress', { done: 1, planned: 3 }))).toBeOnTheScreen();
  });

  it('draws each status as a shape, hidden from TalkBack', async () => {
    await renderStrip();
    expect(screen.getByTestId('plan.week.day.2026-09-14.mark.done', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('plan.week.day.2026-09-16.mark.missed', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('plan.week.day.2026-09-19.mark.skipped', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('plan.week.day.2026-09-14.mark.done')).toBeNull();
  });

  it('reads in Icelandic in Icelandic', async () => {
    setCurrentLanguage('is');
    await renderStrip();
    expect(screen.getByText(translate('plan.week.progress', 'is', { done: 1, planned: 3 }))).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: translate('a11y.prev_week', 'is') })).toBeOnTheScreen();
    const label = screen.getByTestId('plan.week.day.2026-09-14').props.accessibilityLabel as string;
    expect(label.endsWith(`, ${translate('a11y.status.done', 'is')}`)).toBe(true);
  });
});

describe('the status mark', () => {
  it('draws something for each status but unknown', async () => {
    for (const status of ['done', 'skipped', 'missed', 'rest', 'planned'] as const) {
      await render(<StatusMark status={status} testID={`mark.${status}`} />);
      expect(screen.getByTestId(`mark.${status}`, { includeHiddenElements: true }).children.length).toBeGreaterThan(0);
      await screen.unmount();
    }
    await render(<StatusMark status="unknown" testID="mark.unknown" />);
    expect(screen.getByTestId('mark.unknown', { includeHiddenElements: true }).children).toHaveLength(0);
  });
});
