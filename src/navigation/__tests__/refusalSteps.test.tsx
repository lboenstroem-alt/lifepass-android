/**
 * Where a refusal's next step goes (iOS RefusalStepPresenter, 2.5.5): the
 * destination table, which steps can be offered at all, and the re-check
 * when the member comes back from the plans page or the deletion sheet.
 */
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { REFUSAL_CTAS, type RefusalCta } from '../../api/refusals';
import { navigationRef } from '../navigationRef';
import {
  presentsRefusalStep,
  refusalDestination,
  refusalLink,
  takeRefusalStep,
  useRefusalStep,
  type RefusalStepDeps,
} from '../refusalSteps';

// The Kenni sheet's first-build modal draws icons, whose font loader needs expo-asset.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

// ACCT-4's deletion sheet, as the hook reaches it: opens (true) and closes on demand.
const mockOpenDeletion = jest.fn((_options: { onClose: () => void }) => false);
jest.mock('../../features/account/deletion', () => ({
  openAccountDeletion: (options: { onClose: () => void }) => mockOpenDeletion(options),
}));

describe('the destination table', () => {
  it('matches iOS RefusalStepPresenter.destination', () => {
    const table = Object.fromEntries(REFUSAL_CTAS.map((cta) => [cta, refusalDestination(cta, 'laugar')]));
    expect(table).toEqual({
      seePlans: { kind: 'plans' },
      manageMembership: { kind: 'account' },
      resumeMembership: { kind: 'account' },
      cancelDeletion: { kind: 'deletion' },
      addNationality: null,
      verifyIdentity: { kind: 'identity' },
      chooseAnotherTime: null,
      myBookings: { kind: 'bookings' },
      refreshBookings: { kind: 'bookings' },
      openScanner: null,
      bookATime: { kind: 'venue', slug: 'laugar' },
      editGuests: null,
      contactSupport: null,
      tryAgain: null,
    });
  });

  it('"Book a time" goes nowhere when the screen does not know the venue', () => {
    expect(refusalDestination('bookATime', null)).toBeNull();
    expect(presentsRefusalStep('bookATime', null)).toBe(false);
    expect(presentsRefusalStep('bookATime', 'laugar')).toBe(true);
  });

  it('offers only steps something can take: the screens keep their own', () => {
    const offered = REFUSAL_CTAS.filter((cta) => presentsRefusalStep(cta, null));
    expect(offered).toEqual([
      'seePlans',
      'manageMembership',
      'resumeMembership',
      'cancelDeletion',
      'addNationality',
      'verifyIdentity',
      'myBookings',
      'refreshBookings',
      'contactSupport',
    ]);
  });

  it('the web profile and the support address', () => {
    expect(refusalLink('addNationality')).toBe('https://www.lifepass.is/profile');
    expect(refusalLink('contactSupport')).toBe('mailto:support@lifepass.is');
    expect(refusalLink('seePlans')).toBeNull();
  });
});

describe('taking a step', () => {
  function deps(overrides: Partial<RefusalStepDeps> = {}) {
    const navigate = jest.fn();
    const openUrl = jest.fn();
    const openKenni = jest.fn();
    const openDeletion = jest.fn(() => false);
    return {
      navigate,
      openUrl,
      openKenni,
      openDeletion,
      deps: { navigation: { navigate } as never, openUrl, openKenni, openDeletion, ...overrides } as RefusalStepDeps,
    };
  }

  it("the screen's own handling comes first", () => {
    const { deps: d, navigate } = deps();
    const local = jest.fn((cta: RefusalCta) => cta === 'seePlans');
    expect(takeRefusalStep('seePlans', d, { local })).toBe('local');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens the screens iOS opens', () => {
    const { deps: d, navigate } = deps();
    expect(takeRefusalStep('seePlans', d)).toBe('plans');
    expect(takeRefusalStep('resumeMembership', d)).toBe('account');
    expect(takeRefusalStep('refreshBookings', d)).toBe('bookings');
    expect(takeRefusalStep('bookATime', d, { venueSlug: 'laugar' })).toBe('venue');
    expect(navigate.mock.calls).toEqual([
      ['Plans'],
      ['Account'],
      ['Profile', { initialTab: 'bookings' }],
      ['VenueDetail', { slug: 'laugar' }],
    ]);
  });

  it('cancel deletion opens the deletion sheet, or Account until there is one', () => {
    const first = deps();
    expect(takeRefusalStep('cancelDeletion', first.deps)).toBe('deletion');
    expect(first.navigate).toHaveBeenCalledWith('Account');

    const openDeletion = jest.fn((_options: { onClose: () => void }) => true);
    const second = deps({ openDeletion });
    const onClosed = jest.fn();
    expect(takeRefusalStep('cancelDeletion', second.deps, { onClosed })).toBe('deletionSheet');
    expect(second.navigate).not.toHaveBeenCalled();
    // Closing the sheet is the return (iOS onSheetDismiss).
    openDeletion.mock.calls[0][0].onClose();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('verify identity opens the Kenni sheet in the app, with the sign-up body', () => {
    const { deps: d, openKenni } = deps();
    const onClosed = jest.fn();
    expect(takeRefusalStep('verifyIdentity', d, { onClosed })).toBe('identity');
    expect(openKenni).toHaveBeenCalledWith(expect.objectContaining({ bodyKey: 'kenni.onboarding_body' }));
    openKenni.mock.calls[0][0].onClose();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('nationality and support leave the app', () => {
    const { deps: d, openUrl } = deps();
    expect(takeRefusalStep('addNationality', d)).toBe('link');
    expect(takeRefusalStep('contactSupport', d)).toBe('link');
    expect(openUrl.mock.calls).toEqual([['https://www.lifepass.is/profile'], ['mailto:support@lifepass.is']]);
  });

  it('a sheet closes itself before a page or a modal opens, not before a sheet or a link', () => {
    const order: string[] = [];
    const navigate = jest.fn((name: string) => order.push(`open ${name}`));
    const beforeOpen = () => order.push('sheet closes');
    const d = {
      navigation: { navigate } as never,
      openUrl: () => order.push('link'),
      openKenni: () => order.push('kenni sheet'),
      openDeletion: () => {
        order.push('deletion sheet');
        return true;
      },
    } as RefusalStepDeps;
    for (const cta of ['seePlans', 'manageMembership', 'myBookings', 'verifyIdentity', 'cancelDeletion', 'contactSupport'] as const) {
      takeRefusalStep(cta, d, { beforeOpen });
    }
    takeRefusalStep('bookATime', d, { beforeOpen, venueSlug: 'laugar' });
    expect(order).toEqual([
      'sheet closes',
      'open Plans',
      'sheet closes',
      'open Account',
      'sheet closes',
      'open Profile',
      'kenni sheet',
      'deletion sheet',
      'link',
      'sheet closes',
      'open VenueDetail',
    ]);
  });

  it('a page goes where the screen can push it, or over the modal the screen is on', () => {
    // A screen in a tab: its stack has the shared routes.
    const inTab = jest.fn();
    const tabScreen = {
      navigate: inTab,
      getState: () => ({ routeNames: ['HomeMain', 'Profile', 'Account'] }),
      getParent: () => undefined,
    };
    takeRefusalStep('manageMembership', { navigation: tabScreen as never });
    expect(inTab).toHaveBeenCalledWith('Account');

    // A root modal (no shared routes above it), with the app not on screen:
    // nothing is pushed where it would do nothing.
    const inModal = jest.fn();
    const modalScreen = {
      navigate: inModal,
      getState: () => ({ routeNames: ['Main', 'Plans', 'SharedSheet'] }),
      getParent: () => undefined,
    };
    takeRefusalStep('manageMembership', { navigation: modalScreen as never });
    expect(inModal).not.toHaveBeenCalled();
  });

  it('a step nothing can take does nothing', () => {
    const { deps: d, navigate } = deps();
    expect(takeRefusalStep('chooseAnotherTime', d)).toBe('none');
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('useRefusalStep', () => {
  const Stack = createNativeStackNavigator();
  const recheck = jest.fn();

  function Booking() {
    const { offers, take } = useRefusalStep({ onReturn: recheck });
    const navigation = useNavigation<{ navigate(name: 'Plans'): void }>();
    return (
      <>
        <Pressable accessibilityRole="button" onPress={() => take('cancelDeletion')}>
          <Text>Cancel deletion</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Plans')}>
          <Text>Open another page</Text>
        </Pressable>
        <Text>{offers('seePlans') ? 'View plans offered' : 'no step'}</Text>
        <Text>{offers('chooseAnotherTime') ? 'another time offered' : 'another time not offered'}</Text>
        <Text>
          {offers('chooseAnotherTime', (cta) => cta === 'chooseAnotherTime') ? 'screen takes it' : 'screen does not'}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => take('seePlans')}>
          <Text>View plans</Text>
        </Pressable>
      </>
    );
  }

  function Plans() {
    return <Text>Plans screen</Text>;
  }

  it('offers what can be taken, and re-checks once the member is back from the plans page', async () => {
    await render(
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Booking" component={Booking} />
          <Stack.Screen name="Plans" component={Plans} />
        </Stack.Navigator>
      </NavigationContainer>,
    );
    expect(screen.getByText('View plans offered')).toBeOnTheScreen();
    expect(screen.getByText('another time not offered')).toBeOnTheScreen();
    expect(screen.getByText('screen takes it')).toBeOnTheScreen();
    expect(recheck).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'View plans' }));
    expect(screen.getByText('Plans screen')).toBeOnTheScreen();
    expect(recheck).not.toHaveBeenCalled();

    await act(async () => navigationRef.goBack());
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it('re-checks once when the deletion sheet closes, and not at a later focus', async () => {
    recheck.mockClear();
    mockOpenDeletion.mockImplementation(() => true);
    await render(
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Booking" component={Booking} />
          <Stack.Screen name="Plans" component={Plans} />
        </Stack.Navigator>
      </NavigationContainer>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel deletion' }));
    expect(mockOpenDeletion).toHaveBeenCalledTimes(1);
    expect(recheck).not.toHaveBeenCalled();

    await act(async () => mockOpenDeletion.mock.calls[0][0].onClose());
    expect(recheck).toHaveBeenCalledTimes(1);

    // A page pushed and popped later is not a return from the sheet.
    await fireEvent.press(screen.getByRole('button', { name: 'Open another page' }));
    await act(async () => navigationRef.goBack());
    expect(screen.getByText('View plans offered')).toBeOnTheScreen();
    expect(recheck).toHaveBeenCalledTimes(1);
  });
});
