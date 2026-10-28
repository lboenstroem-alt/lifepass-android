/**
 * Plan's class session opens the feed pre-filtered (iOS PlanView
 * `.classes(session)`): the session's category and day are applied before the
 * first load (no wasted unfiltered fetch), the Venues / Classes switch is
 * hidden, a non-featured category reads "No classes match these filters",
 * and the sheet closes.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { api } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import type { RootModalProps } from '../../../navigation/types';
import ClassesDiscoveryModalScreen from '../ClassesDiscoveryModalScreen';
import { isoDay } from '../feed/days';
import { day, page } from './feedFixtures';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../components/ui/testing/bottomSheetMock').bottomSheetModule,
);

stubApiClientPerTest();

function props(params: { initialCategory?: string; initialDate?: string } | undefined) {
  const goBack = jest.fn();
  const value = {
    navigation: { goBack },
    route: { key: 'ClassesDiscoveryModal-1', name: 'ClassesDiscoveryModal', params },
  } as unknown as RootModalProps<'ClassesDiscoveryModal'>;
  return { goBack, value };
}

it("opens on the session's category and day, without the mode switch, and closes", async () => {
  const sessionDay = isoDay(day(2));
  api.on('GET', '/classes', page([]));
  const { goBack, value } = props({ initialCategory: 'aerial-silks', initialDate: sessionDay });
  await render(<ClassesDiscoveryModalScreen {...value} />);

  await waitFor(() => expect(api.requests.length).toBeGreaterThanOrEqual(1));
  expect(api.requests[0]!.query).toEqual({ limit: '100', category: 'aerial-silks', start: sessionDay, end: sessionDay });
  expect(screen.queryByTestId('classes.mode.venues')).toBeNull();

  // A catalogue slug that is not a featured chip: the hint says "these filters".
  await waitFor(() => expect(screen.getByText(/No classes match these filters/)).toBeTruthy());

  await fireEvent.press(screen.getByTestId('classes.modal.close'));
  expect(goBack).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('classes.modal.close').props.accessibilityLabel).toBe('Close');
});

it('with no session filters it opens on the default window', async () => {
  api.on('GET', '/classes', page([]));
  const { value } = props(undefined);
  await render(<ClassesDiscoveryModalScreen {...value} />);
  await waitFor(() => expect(api.requests).toHaveLength(1));
  expect(api.requests[0]!.query).toEqual({ limit: '100' });
});
