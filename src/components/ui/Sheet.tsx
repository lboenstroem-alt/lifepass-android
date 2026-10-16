// A bottom sheet: the Android stand-in for SwiftUI's `.sheet` with
// `.presentationDetents` and `.interactiveDismissDisabled` (plan 5.6).
//
//   <Sheet visible={open} onClose={() => setOpen(false)} busy={saving}
//          footer={<PrimaryButton title={t('common.done')} onPress={save} />}>
//     ...
//   </Sheet>
//
// CONTROLLED. `visible` says whether the sheet should be up; `onClose` is the
// member asking to close it (pan down, a tap on the backdrop, hardware back),
// and the parent answers by setting `visible` to false. A parent can also
// close it on its own (after a save) by setting `visible` to false; the sheet
// then slides away and its content unmounts once it has left.
//
// SIZE. With no `snapPoints` the sheet fits its content, up to the screen
// below the status bar, and scrolls past that. `fullHeight` opens it at full
// height only, which iOS does at the accessibility text sizes for the class
// and own-visit sheets (pass `useA11ySize().isAccessibilitySize`).
//
// BUSY LOCK. While `busy` (a request in flight) or when not `dismissible`,
// the member cannot close it: pan-down, the backdrop and hardware back are all
// refused, and back is consumed so it never reaches the screen underneath.
// iOS `interactiveDismissDisabled(isSaving)`.
//
// FOOTER. `footer` is pinned to the bottom edge above the navigation bar,
// whatever the sheet's height, so a Confirm button and the money line above it
// stay in view while the content scrolls (iOS keeps "the money line directly
// above Confirm").
//
// The app shell mounts one `UiKitProvider` (BottomSheetModalProvider inside
// the NavigationContainer), which hosts every sheet.
import {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, hairline, radius } from '../../theme';
import { hiddenFromAccessibility } from './a11y';
import { createHostStore, type HostStore } from './hostStore';
import { InSheetContext } from './SheetTextInput';

export type SheetProps = {
  visible: boolean;
  /** The member asked to close (pan down, backdrop, back). Set `visible` to false. */
  onClose: () => void;
  children: ReactNode;
  /** Pinned to the bottom edge, above the navigation bar. */
  footer?: ReactNode;
  /** Fixed heights (numbers) or percentages ('50%'); omitted, the sheet fits its content. */
  snapPoints?: (string | number)[];
  /** Open at full height only (iOS at accessibility text sizes). */
  fullHeight?: boolean;
  /** A request is in flight: refuse every way of closing it by hand. */
  busy?: boolean;
  /** false: the member can never close it by hand (iOS `interactiveDismissDisabled(true)`). */
  dismissible?: boolean;
  /** Wrap the content in the sheet's scroll view (default) or a plain view. */
  scrollable?: boolean;
  /** Called once the sheet has fully left the screen. */
  onClosed?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * If the library never reports the end of the slide-out (it has been known to
 * drop `onDismiss` when a screen unmounts mid-animation), the content still
 * unmounts after this long. The slide itself takes about 250 ms.
 */
export const SHEET_CLOSE_FALLBACK_MS = 800;

/**
 * The test runner's stand-in for the library renders a sheet's children
 * inline and has no footer slot; there the footer is drawn after the content
 * so screens' tests can still reach their Confirm button. On a phone the
 * library always has it.
 */
const FOOTER_SLOT_AVAILABLE = BottomSheetFooter != null;

const FULL_HEIGHT = ['100%'];

export default function Sheet({
  visible,
  onClose,
  children,
  footer,
  snapPoints,
  fullHeight = false,
  busy = false,
  dismissible = true,
  scrollable = true,
  onClosed,
  contentStyle,
  testID,
}: SheetProps) {
  const ref = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [footerHeight, setFooterHeight] = useState(0);
  const locked = busy || !dismissible;

  // Callbacks and the lock are read from refs inside long-lived handlers, so
  // a new arrow function from the parent never re-subscribes anything.
  const onCloseRef = useRef(onClose);
  const onClosedRef = useRef(onClosed);
  const lockedRef = useRef(locked);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    onClosedRef.current = onClosed;
    lockedRef.current = locked;
  });

  /** True while the parent, not the member, is taking the sheet down. */
  const closingByParent = useRef(false);

  const finish = useCallback(() => {
    closingByParent.current = false;
    setMounted(false);
    onClosedRef.current?.();
  }, []);

  // Shown: mount, then present once mounted.
  useEffect(() => {
    if (visible) {
      closingByParent.current = false;
      setMounted(true);
    }
  }, [visible]);
  useEffect(() => {
    if (visible && mounted) ref.current?.present();
  }, [visible, mounted]);

  // Hidden by the parent: slide away, unmount when the library says it has
  // left (or after the fallback).
  useEffect(() => {
    if (visible || !mounted) return;
    closingByParent.current = true;
    ref.current?.dismiss();
    const fallback = setTimeout(finish, SHEET_CLOSE_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [visible, mounted, finish]);

  // The library calls this once the sheet is gone, whoever closed it.
  const handleDismiss = useCallback(() => {
    if (closingByParent.current) {
      finish();
      return;
    }
    // The member closed it (pan down or the backdrop): it is already off
    // screen, so unmount now and tell the parent.
    finish();
    onCloseRef.current();
  }, [finish]);

  // Hardware back closes the topmost sheet, or does nothing while locked;
  // either way it is consumed (RN asks the newest listener first, so a sheet
  // over a sheet closes the top one).
  useEffect(() => {
    if (!visible || !mounted) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!lockedRef.current) onCloseRef.current();
      return true;
    });
    return () => subscription.remove();
  }, [visible, mounted]);

  // The footer lives in the library's footer slot, which mounts it as its own
  // component; a stable component that reads the latest footer from a store
  // keeps its state (and a focused field) across the parent's re-renders.
  const footerStore = useMemo(() => createHostStore<ReactNode>(null), []);
  useLayoutEffect(() => {
    footerStore.set(() => footer ?? null);
  }, [footer, footerStore]);

  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props}>
        <InSheetContext.Provider value>
          <SheetFooter store={footerStore} bottomInset={insets.bottom} onHeight={setFooterHeight} />
        </InSheetContext.Provider>
      </BottomSheetFooter>
    ),
    [footerStore, insets.bottom],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.35}
        pressBehavior={locked ? 'none' : 'close'}
        // TalkBack closes a sheet with the back gesture; the backdrop's own
        // English label ("Bottom Sheet backdrop") is never read.
        accessible={false}
      />
    ),
    [locked],
  );

  if (!mounted) return null;

  const hasFooter = footer != null && footer !== false;
  const usesFooterSlot = hasFooter && FOOTER_SLOT_AVAILABLE;
  const points = fullHeight ? FULL_HEIGHT : snapPoints;
  const bottomPadding = usesFooterSlot ? footerHeight + 8 : hasFooter ? 0 : insets.bottom + 24;
  // The provider travels with the content into the sheet host, so fields
  // inside know to use the sheet's own input (SheetTextInput).
  const body = (
    <InSheetContext.Provider value>
      {children}
      {hasFooter && !usesFooterSlot ? <View style={styles.inlineFooter}>{footer}</View> : null}
    </InSheetContext.Provider>
  );
  const padded = [styles.content, { paddingBottom: bottomPadding }, contentStyle];

  return (
    <BottomSheetModal
      ref={ref}
      onDismiss={handleDismiss}
      snapPoints={points}
      enableDynamicSizing={!points}
      enablePanDownToClose={!locked}
      topInset={insets.top}
      stackBehavior="push"
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backdropComponent={renderBackdrop}
      footerComponent={usesFooterSlot ? renderFooter : undefined}
      handleComponent={SheetHandle}
      backgroundStyle={styles.background}
      // The container is not one element to TalkBack (its default English
      // label "Bottom Sheet" would be read); its content is.
      accessible={false}
    >
      {scrollable ? (
        <BottomSheetScrollView testID={testID} contentContainerStyle={padded} keyboardShouldPersistTaps="handled">
          {body}
        </BottomSheetScrollView>
      ) : (
        <BottomSheetView testID={testID} style={padded}>
          {body}
        </BottomSheetView>
      )}
    </BottomSheetModal>
  );
}

/** The drag indicator: a small pill, decoration to TalkBack. */
function SheetHandle() {
  return (
    <View style={styles.handle} {...hiddenFromAccessibility}>
      <View style={styles.indicator} />
    </View>
  );
}

function SheetFooter({
  store,
  bottomInset,
  onHeight,
}: {
  store: HostStore<ReactNode>;
  bottomInset: number;
  onHeight: (height: number) => void;
}) {
  const footer = store.use();
  return (
    <View style={[styles.footer, { paddingBottom: bottomInset + 16 }]} onLayout={(event) => onHeight(event.nativeEvent.layout.height)}>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    backgroundColor: colors.ink,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  handle: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  indicator: { width: 36, height: 5, borderRadius: 3, backgroundColor: colors.line2 },
  content: { paddingHorizontal: 24, paddingTop: 16 },
  inlineFooter: { paddingTop: 16 },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: colors.ink,
    borderTopWidth: hairline,
    borderTopColor: colors.line,
    gap: 10,
  },
});
