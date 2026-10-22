/**
 * Account's Body and goals row (BODY-1's slot, iOS AccountView): a minor's
 * row says why and opens nothing; otherwise it opens Body and goals with
 * "Tracking on" or what tracking is for, worded without Apple Health.
 */
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { decodeProfile } from '../../../../api/profile';
import { setCurrentLanguage, translate } from '../../../../i18n';
import { resetAppStoreForTests, useAppStore } from '../../../../stores/appStore';
import { settle } from '../../billing/__tests__/screenHarness';
import BodyGoalsRow from '../BodyGoalsRow';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';

function member(access: string, consent: boolean, locale: 'en' | 'is' = 'en') {
  const profile = decodeProfile({
    id: MEMBER,
    locale,
    kennitalaVerified: true,
    marketingConsent: false,
    health: {
      access,
      consent: consent ? { version: '2026-09-v1', consentedAt: '2026-09-01T09:00:00Z', ageSource: 'kennitala' } : null,
      features: [],
    },
  });
  useAppStore.setState({ isAuthenticated: true, userId: MEMBER, profile });
}

const Stack = createNativeStackNavigator();

function BodyAndGoalsStandIn() {
  return <Text testID="route.BodyAndGoals">Body and goals route</Text>;
}

/** The row on an Account stand-in, with Body and goals beside it, so a tap shows where it went. */
async function show() {
  await render(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Screen name="Account" component={BodyGoalsRow} />
        <Stack.Screen name="BodyAndGoals" component={BodyAndGoalsStandIn} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await settle();
}

beforeEach(() => {
  resetAppStoreForTests();
});

it('with consent: "Tracking on", and it opens Body and goals', async () => {
  member('entitled', true);
  await show();
  const row = screen.getByTestId('account.row.bodyGoals');
  expect(row.props.accessibilityLabel).toBe('Body and goals, Tracking on');
  await fireEvent.press(row);
  await settle();
  expect(screen.getByTestId('route.BodyAndGoals')).toBeTruthy();
});

it('without consent: what tracking is for, never naming Apple Health', async () => {
  member('not_member', false);
  await show();
  const label = screen.getByTestId('account.row.bodyGoals').props.accessibilityLabel as string;
  expect(label).toBe('Body and goals, Workout plan and food log');
  expect(label).not.toMatch(/Apple Health/);
});

it('in Icelandic', async () => {
  setCurrentLanguage('is');
  member('entitled', false, 'is');
  await show();
  expect(screen.getByTestId('account.row.bodyGoals').props.accessibilityLabel).toBe(
    `${translate('bodygoals.row', 'is')}, Æfingaáætlun og matardagbók`,
  );
});

it('a minor: the reason, dimmed, no chevron, and it opens nothing', async () => {
  member('minor', false);
  await show();
  const row = screen.getByTestId('account.row.bodyGoals');
  expect(row.props.accessibilityLabel).toBe('Body and goals, For members aged 18 and over');
  expect(row.props.accessibilityRole).toBe('text');
  expect(row).toHaveStyle({ opacity: 0.55 });
  expect(screen.queryByTestId('account.row.chevron')).toBeNull();
  expect(row.props.onPress).toBeUndefined();
});
