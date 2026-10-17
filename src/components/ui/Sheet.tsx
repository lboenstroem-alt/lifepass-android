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
// EACH OPENING IS ITS OWN PRESENTATION. Setting `visible` back to true while
// the last close is still sliding mounts a fresh sheet instead of asking the
// closing one to come back (the library ignores a present() during its forced
// close, then reports the dismissal, which used to unmount the sheet just
// asked for and tell the parent the member had closed it). A report from an
// earlier presentation, one that arrives after the fallback has already
// finished the close, and anything after the Sheet itself has unmounted are
// ignored: `onClosed` fires once per presentation and `onClose` only ever
// means the member closed the one on screen. iOS `.sheet(isPresented:)`
// re-presents reliably after a quick dismiss and present.
//
// WHILE IT SLIDES AWAY (closed by the parent) nothing in it can be pressed:
// the content and the footer stop taking touches the moment `visible` turns
// false, so a second tap on a Confirm that closed the sheet can never run its
// action twice. UIKit disables a sheet during its dismissal; the library
// does not.
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
// above Confirm"). Buttons that must never scroll out of reach at large text
// belong here.
//
// SCREEN CONTEXT. The library draws the sheet in the provider's portal host,
// above every screen, so only what sits above UiKitProvider reaches its
// content by itself (an iOS sheet inherits the presenting view's
// environment). The Sheet carries the screen's navigation and route across,
// into the content and the footer alike: `useNavigation()`, `useRoute()`,
// `useIsFocused()` and `useFocusEffect` work inside a sheet, and `navigate`
// goes through the screen's own stack (from the root it would not reach the
// shared routes, which live in the tab stacks). ANY OTHER screen-level
// context (a tab bar height, a provider a screen mounts for its own subtree)
// does not arrive: pass what the content needs as props.
//
// MODAL TO TALKBACK. An iOS sheet is modal to VoiceOver; this one renders
// into the provider's portal in the same window as the screens, so it makes
// itself modal: while any sheet is up, UiKitProvider hides the screens (and
// the tab bar) from TalkBack, which also clears focus from the button that
// opened it. Once the sheet has settled, TalkBack focus moves into it: to
// `initialFocusRef` (pass the sheet's title, as VoiceOver starts at the top)
// or else to the sheet's scroll view (a non-scrollable sheet: its content
// view), from which TalkBack takes the first element. `returnFocusRef` gets
// focus back once the sheet has gone.
//
// KEYBOARD. The library lifts the sheet over the keyboard itself (its default
// Android input mode). Its "adjustResize" mode instead waits for the OS to
// shrink the window, which never happens with edge to edge on, so a field or
// the pinned footer would end up under the keyboard.
//
// The app shell mounts one `UiKitProvider` (BottomSheetModalProvider inside
// the NavigationContainer), which hosts every sheet.
//
// TESTS. The library's own Jest mock has no footer slot and never reports a
// dismissal; use the kit's stand-in (./testing/bottomSheetMock.tsx), which
// has both and renders into the provider's host like the library.
import {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
  type BottomSheetFooterProps,
  type BottomSheetScrollViewMethods,
} from '@gorhom/bottom-sheet';
import { NavigationContext, NavigationRouteContext } from '@react-navigation/native';
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ContextType,
  type ReactNode,
  type RefObject,
} from 'react';
import { AccessibilityInfo, BackHandler, findNodeHandle, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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
  /** Style for the content's box (padding included), inside the scroll view. */
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * Where TalkBack focus goes once the sheet is up (pass its title). Default:
   * the scroll view, or the content view of a sheet that does not scroll.
   */
  initialFocusRef?: RefObject<unknown>;
  /** Where TalkBack focus goes back to once the sheet has gone (the button that opened it). */
  returnFocusRef?: RefObject<unknown>;
  testID?: string;
};

/**
 * If the library never reports the end of the slide-out (it has been known to
 * drop `onDismiss` when a screen unmounts mid-animation), the content still
 * unmounts after this long. The slide itself takes about 250 ms.
 */
export const SHEET_CLOSE_FALLBACK_MS = 800;

const FULL_HEIGHT = ['100%'];

// ─── Sheets open, for the provider's TalkBack lock ──────────────────

const openSheets = createHostStore<number>(0);

/** True while any Sheet is up: UiKitProvider hides the screens from TalkBack. */
export function useSheetOpen(): boolean {
  return openSheets.use() > 0;
}

/** The screen's contexts that a sheet carries into the portal host. */
type ScreenContext = {
  navigation: ContextType<typeof NavigationContext>;
  route: ContextType<typeof NavigationRouteContext>;
};

const NO_SCREEN: ScreenContext = { navigation: undefined, route: undefined };

/** Re-provides, inside the portal host, what the content had where it was declared. */
function CarryScreenContext({ screen, children }: { screen: ScreenContext; children: ReactNode }) {
  return (
    <NavigationRouteContext.Provider value={screen.route}>
      <NavigationContext.Provider value={screen.navigation}>
        {/* Fields inside know to use the sheet's own input (SheetTextInput). */}
        <InSheetContext.Provider value>{children}</InSheetContext.Provider>
      </NavigationContext.Provider>
    </NavigationRouteContext.Provider>
  );
}

/** What the footer slot draws: the footer, whether it takes touches, and the screen's contexts. */
type FooterState = { node: ReactNode; interactive: boolean; screen: ScreenContext };

/** Moves TalkBack focus to a view (a no-op without a screen reader). */
function focusForAccessibility(target: unknown): void {
  if (!target) return;
  try {
    const tag = findNodeHandle(target as Parameters<typeof findNodeHandle>[0]);
    if (typeof tag === 'number') AccessibilityInfo.setAccessibilityFocus(tag);
  } catch {
    // The view has gone (or never had a native view): nothing to focus.
  }
}

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
  initialFocusRef,
  returnFocusRef,
  testID,
}: SheetProps) {
  const ref = useRef<BottomSheetModal>(null);
  // At run time the library hands back the native scroll view (findNodeHandle reads it).
  const scrollRef = useRef<BottomSheetScrollViewMethods>(null);
  const contentRef = useRef<View>(null);
  const insets = useSafeAreaInsets();
  const navigation = useContext(NavigationContext);
  const route = useContext(NavigationRouteContext);
  const screen = useMemo<ScreenContext>(() => ({ navigation, route }), [navigation, route]);
  const [mounted, setMounted] = useState(visible);
  /** Which presentation is on screen: each opening is a new one (see the header). */
  const [generation, setGeneration] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const locked = busy || !dismissible;

  // Callbacks and the lock are read from refs inside long-lived handlers, so
  // a new arrow function from the parent never re-subscribes anything.
  const onCloseRef = useRef(onClose);
  const onClosedRef = useRef(onClosed);
  const lockedRef = useRef(locked);
  const visibleRef = useRef(visible);
  const initialFocusRefRef = useRef(initialFocusRef);
  const returnFocusRefRef = useRef(returnFocusRef);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    onClosedRef.current = onClosed;
    lockedRef.current = locked;
    visibleRef.current = visible;
    initialFocusRefRef.current = initialFocusRef;
    returnFocusRefRef.current = returnFocusRef;
  });

  /** The presentation the library's reports must belong to (state lags a render behind). */
  const currentGeneration = useRef(0);
  /** The last presentation whose close has been finished. */
  const finishedGeneration = useRef(-1);
  /** TalkBack focus has moved into this presentation already. */
  const focusedIn = useRef(false);
  /** False once the Sheet itself has unmounted: the library may still call back. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Opened: a new presentation. Counted in the layout phase, in the same
  // commit that makes `visible` true, so a dismissal the library reports for
  // the previous one can never be taken for this one.
  const wasVisible = useRef(visible);
  useLayoutEffect(() => {
    if (visible && !wasVisible.current) {
      currentGeneration.current += 1;
      focusedIn.current = false;
      setGeneration(currentGeneration.current);
      setMounted(true);
    }
    wasVisible.current = visible;
  }, [visible]);

  /** Ends a presentation's close, once: unmounts the content and reports it. */
  const finish = useCallback((closing: number): boolean => {
    if (!alive.current || closing !== currentGeneration.current || finishedGeneration.current === closing) {
      return false;
    }
    finishedGeneration.current = closing;
    focusedIn.current = false;
    setMounted(false);
    onClosedRef.current?.();
    return true;
  }, []);

  // Gone: focus goes back to `returnFocusRef`, a turn later, once the
  // provider has made the screens underneath reachable again.
  const wasMounted = useRef(false);
  useEffect(() => {
    if (mounted) {
      wasMounted.current = true;
      return;
    }
    if (!wasMounted.current) return;
    wasMounted.current = false;
    const target = returnFocusRefRef.current?.current;
    if (!target) return;
    const timer = setTimeout(() => focusForAccessibility(target), 0);
    return () => clearTimeout(timer);
  }, [mounted]);

  // While up, the sheet counts as open, so the provider hides the screens
  // underneath from TalkBack (the sheet is modal, as on iOS).
  const presented = visible && mounted;
  useEffect(() => {
    if (!presented) return;
    openSheets.set((count) => count + 1);
    return () => openSheets.set((count) => Math.max(0, count - 1));
  }, [presented]);

  // Once the library says this presentation has settled on screen, focus
  // moves in: to `initialFocusRef`, else the scroll view or the content view.
  const handleChange = useCallback(
    (index: number) => {
      if (index < 0 || !alive.current || generation !== currentGeneration.current || focusedIn.current) return;
      focusedIn.current = true;
      const fallback = scrollable ? scrollRef.current : contentRef.current;
      focusForAccessibility(initialFocusRefRef.current?.current ?? fallback);
    },
    [generation, scrollable],
  );

  // Shown: present the current presentation once it is mounted.
  useEffect(() => {
    if (visible && mounted && generation === currentGeneration.current) ref.current?.present();
  }, [visible, mounted, generation]);

  // Hidden by the parent: slide away, unmount when the library says it has
  // left (or after the fallback).
  useEffect(() => {
    if (visible || !mounted) return;
    const closing = currentGeneration.current;
    ref.current?.dismiss();
    const fallback = setTimeout(() => finish(closing), SHEET_CLOSE_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [visible, mounted, finish]);

  // The library calls this once the sheet is gone, whoever closed it. Bound
  // to its own presentation (the modal is keyed by it), so a late report from
  // an earlier one, or one after the fallback finished this one, does nothing.
  const handleDismiss = useCallback(() => {
    // Still meant to be up: the member closed it (pan down or the backdrop).
    const byMember = visibleRef.current;
    if (!finish(generation)) return;
    if (byMember) onCloseRef.current();
  }, [finish, generation]);

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
  const [footerStore] = useState(() =>
    createHostStore<FooterState>({ node: null, interactive: true, screen: NO_SCREEN }),
  );
  useLayoutEffect(() => {
    footerStore.set({ node: footer ?? null, interactive: visible, screen });
  }, [footer, visible, screen, footerStore]);

  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props}>
        <SheetFooter
          store={footerStore}
          bottomInset={insets.bottom}
          onHeight={setFooterHeight}
          testID={`${testID ?? 'sheet'}.footer`}
        />
      </BottomSheetFooter>
    ),
    [footerStore, insets.bottom, testID],
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
  const points = fullHeight ? FULL_HEIGHT : snapPoints;
  const bottomPadding = hasFooter ? footerHeight + 8 : insets.bottom + 24;
  const content = (
    <CarryScreenContext screen={screen}>
      <View
        ref={contentRef}
        // Closed by the parent: it is sliding away and takes no more touches.
        pointerEvents={visible ? 'auto' : 'none'}
        style={[styles.content, { paddingBottom: bottomPadding }, contentStyle]}
        testID={testID ? `${testID}.content` : undefined}
      >
        {children}
      </View>
    </CarryScreenContext>
  );

  return (
    <BottomSheetModal
      // A new presentation is a new modal, never the closing one brought back.
      key={generation}
      ref={ref}
      onDismiss={handleDismiss}
      onChange={handleChange}
      snapPoints={points}
      enableDynamicSizing={!points}
      enablePanDownToClose={!locked}
      topInset={insets.top}
      stackBehavior="push"
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      backdropComponent={renderBackdrop}
      footerComponent={hasFooter ? renderFooter : undefined}
      handleComponent={SheetHandle}
      backgroundStyle={styles.background}
      // The container is not one element to TalkBack (its default English
      // label "Bottom Sheet" would be read); its content is.
      accessible={false}
    >
      {scrollable ? (
        <BottomSheetScrollView ref={scrollRef} testID={testID} keyboardShouldPersistTaps="handled">
          {content}
        </BottomSheetScrollView>
      ) : (
        <BottomSheetView testID={testID}>{content}</BottomSheetView>
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
  testID,
}: {
  store: HostStore<FooterState>;
  bottomInset: number;
  onHeight: (height: number) => void;
  testID: string;
}) {
  const { node, interactive, screen } = store.use();
  return (
    <CarryScreenContext screen={screen}>
      <View
        testID={testID}
        // Closed by the parent: it is sliding away and takes no more touches.
        pointerEvents={interactive ? 'auto' : 'none'}
        style={[styles.footer, { paddingBottom: bottomInset + 16 }]}
        onLayout={(event) => onHeight(event.nativeEvent.layout.height)}
      >
        {node}
      </View>
    </CarryScreenContext>
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
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: colors.ink,
    borderTopWidth: hairline,
    borderTopColor: colors.line,
    gap: 10,
  },
});
