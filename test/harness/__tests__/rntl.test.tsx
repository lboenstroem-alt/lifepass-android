/**
 * React Native Testing Library runs on the Android preset: render, query by
 * role and label (what TalkBack reads), press, and the library mocks that
 * screens lean on (safe-area insets, bottom sheets, gesture handler).
 *
 * RNTL 14 is asynchronous: `await render(...)` and `await fireEvent.press(...)`.
 */
import { BottomSheetModal, BottomSheetModalProvider, BottomSheetView } from '@gorhom/bottom-sheet';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setCurrentLanguage, t } from '../../../src/i18n';

function Counter({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: false }}
        onPress={() => setCount((c) => c + 1)}
      >
        <Text>{label}</Text>
      </Pressable>
      <Text testID="count">{String(count)}</Text>
    </View>
  );
}

it('renders on Android and reacts to a press', async () => {
  expect(Platform.OS).toBe('android');
  await render(<Counter label={t('common.done')} />);
  const button = screen.getByRole('button', { name: t('common.done') });
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(screen.getByTestId('count')).toHaveTextContent('2');
});

it('renders Icelandic copy from the generated tables', async () => {
  setCurrentLanguage('is');
  try {
    await render(<Counter label={t('common.done')} />);
    expect(screen.getByRole('button', { name: t('common.done') })).toBeOnTheScreen();
    expect(t('common.done')).not.toBe('common.done');
  } finally {
    setCurrentLanguage('en');
  }
});

it('renders bottom-sheet content inline (library mock) inside the gesture root', async () => {
  await render(
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>
        <BottomSheetModal snapPoints={['50%']}>
          <BottomSheetView>
            <Text>{t('common.done')}</Text>
          </BottomSheetView>
        </BottomSheetModal>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>,
  );
  expect(screen.getByText(t('common.done'))).toBeOnTheScreen();
});
