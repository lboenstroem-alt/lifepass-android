/**
 * A stand-in for PLAN-2's SessionPreviewSheet in PLAN-4's tests (PLAN-2 is on
 * its own branch): it shows the session it was given, offers Start only when
 * told it can, and keeps PLAN-2's promise that Start runs once the sheet has
 * gone (it "slides away" as soon as `visible` turns false).
 *
 *   jest.mock('../sessionPreview', () => {
 *     const actual = jest.requireActual('../sessionPreview');
 *     const fake = jest.requireActual('./fakePreviewSheet');
 *     return { ...actual, useSessionPreview: (id?: string) => actual.useSessionPreview(id, fake.installedSheet()) };
 *   });
 */
import { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { PreviewSheetProps } from '../sessionPreview';

let installed = true;

/** Whether the preview is "merged": false draws the rows as they are until PLAN-2 lands. */
export function setPreviewInstalled(value: boolean): void {
  installed = value;
}

export function installedSheet() {
  return installed ? FakePreviewSheet : null;
}

export function FakePreviewSheet({ visible, onClose, onClosed, session, canStart = false, onStart, testID = 'plan.preview' }: PreviewSheetProps) {
  const afterClose = useRef<(() => void) | null>(null);
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (wasVisible.current && !visible) {
      const next = afterClose.current;
      afterClose.current = null;
      next?.();
      onClosed?.();
    }
    wasVisible.current = visible;
  }, [visible, onClosed]);
  if (!visible) return null;
  return (
    <View testID={testID}>
      <Text>{`preview:${session.id}`}</Text>
      {canStart ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="preview start"
          onPress={() => {
            afterClose.current = onStart ?? null;
            onClose();
          }}
        />
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="preview close" onPress={onClose} />
    </View>
  );
}
