/**
 * Stand-ins for PLAN-3's No energy and Log a workout sheets, built to the
 * slot contract (src/features/plan/sheets): controlled by `visible`, and they
 * NEVER close themselves, so a test sees what the Today card does as host.
 *
 * Each one draws how it was seeded (its mount number and, for No energy, the
 * mode it read from `startsInSkipMode` once, in `useState`, as a real sheet
 * would) and three taps: the server answered, the plan changed elsewhere,
 * and the member swiped it down.
 *
 *   jest.mock('../../sheets/NoEnergySheet', () => require('./fakePlan3Sheets').noEnergyModule);
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { LogWorkoutSheetProps } from '../../sheets/LogWorkoutSheet';
import type { NoEnergySheetProps } from '../../sheets/NoEnergySheet';

export const fakeSheets: {
  /** Mounts so far, across both sheets. */
  mounts: number;
  /** What "answered" hands to `onResult` (a decoded session action answer). */
  result: unknown;
  /** The props each sheet last rendered with, for a test that answers late. */
  noEnergy: NoEnergySheetProps | null;
  logWorkout: LogWorkoutSheetProps | null;
} = { mounts: 0, result: null, noEnergy: null, logWorkout: null };

export function resetFakeSheets(): void {
  fakeSheets.mounts = 0;
  fakeSheets.result = null;
  fakeSheets.noEnergy = null;
  fakeSheets.logWorkout = null;
}

function FakeTaps({ name, onResult, onChangedElsewhere, onClose }: { name: string } & Pick<NoEnergySheetProps, 'onResult' | 'onChangedElsewhere' | 'onClose'>) {
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${name}: answered`} onPress={() => onResult(fakeSheets.result)} />
      <Pressable accessibilityRole="button" accessibilityLabel={`${name}: changed elsewhere`} onPress={onChangedElsewhere} />
      <Pressable accessibilityRole="button" accessibilityLabel={`${name}: swipe down`} onPress={onClose} />
    </>
  );
}

function FakeNoEnergySheet(props: NoEnergySheetProps) {
  const [mount] = useState(() => (fakeSheets.mounts += 1));
  const [skipMode] = useState(props.startsInSkipMode === true);
  fakeSheets.noEnergy = props;
  if (!props.visible) return null;
  return (
    <View testID="fake.noEnergy">
      <Text>{`mount ${mount}`}</Text>
      <Text>{skipMode ? 'skip mode' : 'move mode'}</Text>
      <Text>{`session ${props.session.id}`}</Text>
      <FakeTaps name="no energy" {...props} />
    </View>
  );
}

function FakeLogWorkoutSheet(props: LogWorkoutSheetProps) {
  const [mount] = useState(() => (fakeSheets.mounts += 1));
  fakeSheets.logWorkout = props;
  if (!props.visible) return null;
  return (
    <View testID="fake.logWorkout">
      <Text>{`mount ${mount}`}</Text>
      <FakeTaps name="log workout" {...props} />
    </View>
  );
}

export const noEnergyModule = { __esModule: true, default: FakeNoEnergySheet };
export const logWorkoutModule = { __esModule: true, default: FakeLogWorkoutSheet };
