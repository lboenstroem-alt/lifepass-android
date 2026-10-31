// The booking flow's bottom row: Back and the step's primary button (Next,
// or Confirm), PINNED below the step's scrolling content on every step, so
// it can never be pushed off the bottom of the screen, whatever the phone's
// height, its font size or the language (iOS 3.x moved BookingFlowView's
// Back/Confirm row into a `.safeAreaInset(edge: .bottom)` for the same
// reason: a member on a small phone at a large text size could not reach
// Confirm). The tab bar is not drawn over the flow (CustomTabBar's
// BAR_HIDDEN_ON_ROUTES), so the row only clears the system bar
// (`bottomInset`).
//
// LARGE TEXT. At the accessibility sizes (font scale 1.5 and up, see
// src/hooks/useA11ySize.ts) two buttons side by side leave each label about
// a third of a small phone's width, so "Staðfesta bókun" would break mid
// word. The row then stacks: the primary button first, full width, and Back
// below it, as LifePass stacks a dialog's buttons with the cancel one last.
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useA11ySize } from '../../../hooks/useA11ySize';
import SecondaryButton from './SecondaryButton';

export interface BookingStepFooterProps {
  /** Back, when the step has one (the date step has none). */
  readonly back?: {
    readonly title: string;
    readonly onPress: () => void;
    readonly disabled?: boolean;
    readonly testID?: string;
  } | null;
  /** The step's primary button (a PrimaryButton), or null when it is hidden (a gate refusal hides Confirm). */
  readonly primary: ReactNode;
  /** The system bar's inset below the row. */
  readonly bottomInset?: number;
  readonly testID?: string;
}

export default function BookingStepFooter({ back, primary, bottomInset = 0, testID }: BookingStepFooterProps) {
  const { isAccessibilitySize } = useA11ySize();
  const stacked = isAccessibilitySize;
  const backButton = back ? (
    <SecondaryButton
      title={back.title}
      onPress={back.onPress}
      disabled={back.disabled}
      testID={back.testID}
      style={stacked ? undefined : styles.flex}
    />
  ) : null;
  return (
    <View style={[styles.footer, { paddingBottom: 16 + bottomInset }]} testID={testID}>
      {stacked ? (
        <View style={styles.column} testID={testID ? `${testID}.stacked` : undefined}>
          {primary}
          {backButton}
        </View>
      ) : (
        <View style={styles.row} testID={testID ? `${testID}.row` : undefined}>
          {backButton}
          {primary ? <View style={styles.flex}>{primary}</View> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  column: {
    gap: 10,
  },
  flex: {
    flex: 1,
  },
});
