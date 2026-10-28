/**
 * Every test starts from a clean device, even when the previous test left a
 * screen mounted whose unmount does work (jest.setup.ts unmounts before it
 * resets), and even when it switched the language and never switched back.
 *
 * The tests in this file run in order on purpose: the second checks what the
 * first left behind.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import { currentLanguage, setCurrentLanguage } from '../../../src/i18n';
import { api } from '@test/server';
import { TEST_API_BASE } from '@test/server/testEnv';

/** Persists a draft and tells the server on unmount, as a screen might. */
function DraftScreen() {
  useEffect(
    () => () => {
      void AsyncStorage.setItem('draft.meal', '{"items":1}');
      void fetch(`${TEST_API_BASE}/profile`).catch(() => undefined);
    },
    [],
  );
  return <Text>draft</Text>;
}

describe('per-test isolation', () => {
  it('leaves a screen mounted that writes and fetches on unmount, in Icelandic', async () => {
    setCurrentLanguage('is');
    await render(<DraftScreen />);
    expect(screen.getByText('draft')).toBeOnTheScreen();
  });

  it('starts the next test clean: no draft, no request, English', async () => {
    expect(await AsyncStorage.getItem('draft.meal')).toBeNull();
    expect(api.requests).toEqual([]);
    expect(currentLanguage()).toBe('en');
  });
});
