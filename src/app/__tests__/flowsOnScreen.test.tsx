/**
 * What the visit rating and the Google Play ask never cover
 * (../flowsOnScreen.ts): a walk-in in hand, a check-in proof up, a class
 * sheet up, a payment being confirmed; and that they hear each of those end.
 */
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useProofOnScreen } from '../../features/checkin/proof/onScreen';
import { walkInStore } from '../../features/checkin/walkin/store';
import { presentClassSheet, resetClassSheetRequestsForTests } from '../../features/classes/sheet/requests';
import type { ClassOccurrence } from '../../features/classes/model/occurrence';
import {
  attachRecoveryProgressHost,
  endRecoveryProgress,
  resetRecoveryProgress,
  startRecoveryProgress,
} from '../../payments/recoveryProgress';
import { flowOnScreen, subscribeFlowsOnScreen } from '../flowsOnScreen';

function Proof() {
  useProofOnScreen();
  return <Text>proof</Text>;
}

beforeEach(() => {
  walkInStore.getState().reset();
  resetClassSheetRequestsForTests();
  resetRecoveryProgress();
});

afterEach(() => {
  walkInStore.getState().reset();
  resetClassSheetRequestsForTests();
  resetRecoveryProgress();
});

it('nothing on screen: nothing to wait for', () => {
  expect(flowOnScreen()).toBeNull();
});

it('a walk-in in hand (its proof included) is a check-in flow', () => {
  const heard = jest.fn();
  const stop = subscribeFlowsOnScreen(heard);
  walkInStore.setState({ isProcessing: true });
  expect(flowOnScreen()).toBe('checkin');
  walkInStore.setState({ isProcessing: false, showSuccess: true });
  expect(flowOnScreen()).toBe('checkin');
  walkInStore.setState({ showSuccess: false });
  expect(flowOnScreen()).toBeNull();
  expect(heard).toHaveBeenCalled();
  stop();
});

it('a proof on screen (Home re-offers one) holds everything back while it is up', async () => {
  const heard = jest.fn();
  const stop = subscribeFlowsOnScreen(heard);
  const view = await render(<Proof />);
  expect(flowOnScreen()).toBe('proof');
  await view.unmount();
  expect(flowOnScreen()).toBeNull();
  expect(heard).toHaveBeenCalledTimes(2);
  stop();
});

it('a class sheet is a booking flow', () => {
  const heard = jest.fn();
  const stop = subscribeFlowsOnScreen(heard);
  presentClassSheet({ id: 'class-1' } as unknown as ClassOccurrence, {});
  expect(flowOnScreen()).toBe('booking');
  expect(heard).toHaveBeenCalledTimes(1);
  resetClassSheetRequestsForTests();
  expect(flowOnScreen()).toBeNull();
  stop();
});

it('"Confirming your payment…" is a payment flow', () => {
  // A host is up (the app shell's), so no stand-in toast is shown.
  const detach = attachRecoveryProgressHost();
  try {
    startRecoveryProgress({ attemptId: 'attempt-1', rail: 'walk_in' });
    expect(flowOnScreen()).toBe('payment');
    endRecoveryProgress('attempt-1');
    expect(flowOnScreen()).toBeNull();
  } finally {
    detach();
  }
});

it('a stopped subscription hears nothing more', () => {
  const heard = jest.fn();
  subscribeFlowsOnScreen(heard)();
  walkInStore.setState({ isProcessing: true });
  expect(heard).not.toHaveBeenCalled();
});
