/**
 * The drafts list (iOS DraftsListView), pushed from Plan's food card: every
 * estimate waiting, photo and description, newest first, each with its day
 * and time and opening the meal editor; "Nothing logged yet" when none is.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Text } from 'react-native';

import { decodeHealthDay, useHealthStore } from '../../../../health';
import { resetHealthStoreForTests } from '../../../../health/store';
import { translate } from '../../../../i18n';
import { localTime } from '../../../../i18n/format';
import DraftsScreen from '../DraftsScreen';
import { draftRowLine } from '../draftRows';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const en = (key: string, params?: Record<string, string | number>) => translate(key, 'en', params);

const Stack = createNativeStackNavigator();

function StandIn({ route }: { route: { name: string; params?: object } }) {
  return <Text>{`route:${route.name}:${JSON.stringify(route.params ?? {})}`}</Text>;
}

function Home({ navigation }: { navigation: { navigate: (name: string) => void } }) {
  return <Text onPress={() => navigation.navigate('Drafts')}>open drafts</Text>;
}

async function renderDrafts() {
  await render(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={Home as never} />
        <Stack.Screen name="Drafts" component={DraftsScreen as never} />
        <Stack.Screen name="MealEditor" component={StandIn as never} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await fireEvent.press(screen.getByText('open drafts'));
}

function setToday(extra: Record<string, unknown>) {
  useHealthStore.setState({
    today: decodeHealthDay({ date: '2026-10-16', today: '2026-10-16', ...extra }),
  });
}

const PHOTO = { id: 'photo-1', logDate: '2026-10-15', loggedAt: '2026-10-15T08:05:00Z', slot: 'breakfast', itemCount: 3 };
const TEXT = { id: 'text-1', logDate: '2026-10-16', loggedAt: '2026-10-16T12:40:00Z', slot: 'lunch', itemCount: 2 };

beforeEach(() => {
  resetHealthStoreForTests();
});

it('lists photo and description estimates, newest first, with their day and time, and opens the editor', async () => {
  setToday({ pendingDrafts: [PHOTO], pendingTextDrafts: [TEXT] });
  await renderDrafts();
  expect(screen.getByText(en('plan.nutrition.drafts_all').toUpperCase())).toBeOnTheScreen();
  const rows = screen.getAllByRole('button').filter((button) => button.props.testID?.startsWith('drafts.row.'));
  expect(rows.map((row) => row.props.testID)).toEqual(['drafts.row.text-1', 'drafts.row.photo-1']);
  expect(
    within(rows[0]!).getByText(en('diary.draft_row_text_dated', { date: 'Fri 16 Oct', time: localTime(new Date(TEXT.loggedAt)) })),
  ).toBeOnTheScreen();
  expect(
    within(rows[1]!).getByText(en('diary.draft_row_dated', { date: 'Thu 15 Oct', time: localTime(new Date(PHOTO.loggedAt)) })),
  ).toBeOnTheScreen();

  await fireEvent.press(rows[1]!);
  expect(screen.getByText(`route:MealEditor:${JSON.stringify({ mode: 'stored', mealId: 'photo-1' })}`)).toBeOnTheScreen();
});

it('nothing waiting: "Nothing logged yet"', async () => {
  setToday({ pendingDrafts: [] });
  await renderDrafts();
  expect(screen.getByText(en('plan.nutrition.none_yet'))).toBeOnTheScreen();
});

it('follows the Today read: a draft confirmed elsewhere leaves the list', async () => {
  setToday({ pendingDrafts: [PHOTO], pendingTextDrafts: [TEXT] });
  await renderDrafts();
  await act(async () => setToday({ pendingDrafts: [PHOTO] }));
  expect(screen.queryByTestId('drafts.row.text-1')).toBeNull();
  expect(screen.getByTestId('drafts.row.photo-1')).toBeOnTheScreen();
});

it('Back returns to where it was opened from', async () => {
  setToday({ pendingDrafts: [PHOTO] });
  await renderDrafts();
  await fireEvent.press(screen.getByRole('button', { name: en('common.back') }));
  expect(screen.getByText('open drafts')).toBeOnTheScreen();
});

describe('a row\'s words', () => {
  it('in Icelandic', () => {
    const line = draftRowLine({ source: 'text', logDate: '2026-10-16', loggedAt: null }, 'is');
    expect(translate(line.key, 'is', line.params)).toBe('Mat út frá lýsingu, fös., 16. okt. kl. ');
  });

  it('without a day or a time the row still reads', () => {
    const line = draftRowLine({ source: null, logDate: null, loggedAt: null }, 'en');
    expect(line).toEqual({ key: 'diary.draft_row_dated', params: { date: '', time: '' } });
  });
});
