/**
 * Android's back, locked where iOS locks dismissal: a busy screen stays put
 * on hardware back, a screen's own back handler takes the press only while it
 * is the focused screen, and a sheet's back is its close, never a confirm.
 */
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { DeviceEventEmitter, Pressable, Text } from 'react-native';

import { modalRequestClose, sheetBackPolicy, useBusyGuard, useHardwareBack } from '../guards';

type Routes = { Start: undefined; Booking: undefined; Runner: undefined; Next: undefined };
const Stack = createNativeStackNavigator<Routes>();

/** The member presses the system back button (or makes the back gesture). */
async function pressBack(): Promise<void> {
  await act(async () => {
    DeviceEventEmitter.emit('hardwareBackPress');
  });
}

function Start() {
  const navigation = useNavigation<{ navigate(name: keyof Routes): void }>();
  return (
    <>
      <Text>Start screen</Text>
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Booking')}>
        <Text>Open booking</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Runner')}>
        <Text>Open runner</Text>
      </Pressable>
    </>
  );
}

function Booking() {
  const [busy, setBusy] = useState(true);
  useBusyGuard(busy);
  return (
    <>
      <Text>{busy ? 'Booking in flight' : 'Booking done'}</Text>
      <Pressable accessibilityRole="button" onPress={() => setBusy(false)}>
        <Text>Finish</Text>
      </Pressable>
    </>
  );
}

const leaveDialog = jest.fn(() => true);

function Runner() {
  const navigation = useNavigation<{ navigate(name: keyof Routes): void }>();
  const [guarded, setGuarded] = useState(true);
  useHardwareBack(leaveDialog, guarded);
  return (
    <>
      <Text>Runner screen</Text>
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Next')}>
        <Text>Push next</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => setGuarded(false)}>
        <Text>Unguard</Text>
      </Pressable>
    </>
  );
}

function Next() {
  return <Text>Next screen</Text>;
}

function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Start" component={Start} />
        <Stack.Screen name="Booking" component={Booking} />
        <Stack.Screen name="Runner" component={Runner} />
        <Stack.Screen name="Next" component={Next} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

beforeEach(() => leaveDialog.mockClear());

describe('useBusyGuard', () => {
  it('hardware back while busy keeps the screen; once done, back leaves', async () => {
    await render(<App />);
    await fireEvent.press(screen.getByRole('button', { name: 'Open booking' }));
    expect(screen.getByText('Booking in flight')).toBeOnTheScreen();

    await pressBack();
    await pressBack();
    expect(screen.getByText('Booking in flight')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Finish' }));
    await pressBack();
    expect(screen.queryByText('Booking done')).toBeNull();
    expect(screen.getByText('Start screen')).toBeOnTheScreen();
  });
});

describe('useHardwareBack', () => {
  it("takes the press on its own screen (the runner's Leave dialog), and back does nothing else", async () => {
    await render(<App />);
    await fireEvent.press(screen.getByRole('button', { name: 'Open runner' }));
    await pressBack();
    expect(leaveDialog).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Runner screen')).toBeOnTheScreen();
  });

  it('is not asked while another screen is on top of it', async () => {
    await render(<App />);
    await fireEvent.press(screen.getByRole('button', { name: 'Open runner' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Push next' }));
    await pressBack();
    expect(leaveDialog).not.toHaveBeenCalled();
    expect(screen.getByText('Runner screen')).toBeOnTheScreen();
  });

  it('when disabled, back goes back', async () => {
    await render(<App />);
    await fireEvent.press(screen.getByRole('button', { name: 'Open runner' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Unguard' }));
    await pressBack();
    expect(leaveDialog).not.toHaveBeenCalled();
    expect(screen.getByText('Start screen')).toBeOnTheScreen();
  });
});

describe('sheets', () => {
  it('back closes a sheet like its own cancel, unless it is busy or only its buttons may close it', () => {
    expect(sheetBackPolicy({ busy: false })).toBe('close');
    expect(sheetBackPolicy({ busy: true })).toBe('ignore');
    expect(sheetBackPolicy({ busy: false, dismissible: false })).toBe('ignore');
  });

  it("a Modal's onRequestClose follows the same rule", () => {
    const close = jest.fn();
    modalRequestClose({ busy: true }, close)();
    modalRequestClose({ busy: false, dismissible: false }, close)();
    expect(close).not.toHaveBeenCalled();
    modalRequestClose({ busy: false }, close)();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
