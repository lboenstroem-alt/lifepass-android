/**
 * The sheet's busy lock (plan F5: "The Sheet refuses dismissal while busy,
 * swipe and back"), hardware back, the controlled open/close cycle and its
 * presentations, the pinned footer, the screen's context inside the sheet,
 * and TalkBack focus.
 *
 * Run on the kit's stand-in for the library (../testing/bottomSheetMock):
 * it records the props the sheet hands the library, has the footer slot,
 * renders into the provider's host when there is one (as on a phone), and
 * plays the library's part where a test asks (`onDismiss` once the slide-out
 * ends, `onChange` once it has settled).
 */
import { NavigationContainer, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { AccessibilityInfo, BackHandler, Pressable, StyleSheet, Text, type View } from 'react-native';
import { createContext, createRef, useContext, useState, type ReactElement } from 'react';

import Sheet, { SHEET_CLOSE_FALLBACK_MS } from '../Sheet';
import { useInSheet } from '../SheetTextInput';
import { bottomSheetMock } from '../testing/bottomSheetMock';
import UiKitProvider from '../UiKitProvider';

jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../testing/bottomSheetMock').bottomSheetModule,
);
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

type Backdrop = ReactElement<{ pressBehavior?: string; accessible?: boolean }>;

const lastModal = () => bottomSheetMock.latest()!;
const backdrop = () => lastModal().backdropComponent!({}) as Backdrop;

/** The hardware-back listeners the sheet registered, newest last. */
function backListeners(): (() => boolean | null | undefined)[] {
  return (BackHandler.addEventListener as jest.Mock).mock.calls
    .filter(([event]) => event === 'hardwareBackPress')
    .map(([, handler]) => handler);
}

beforeEach(() => {
  bottomSheetMock.reset();
  // Most tests here play the library's part: the slide-out ends when they say.
  bottomSheetMock.settleDismiss = false;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});
afterEach(() => jest.restoreAllMocks());

function renderSheet(props: Partial<React.ComponentProps<typeof Sheet>> = {}) {
  const onClose = jest.fn();
  const element = (
    <Sheet visible onClose={onClose} footer={<Text>Confirm</Text>} {...props}>
      <Text>Sheet body</Text>
    </Sheet>
  );
  return { onClose, element };
}

it('renders nothing while hidden', async () => {
  const { element } = renderSheet({ visible: false });
  await render(element);
  expect(screen.queryByText('Sheet body')).toBeNull();
});

it('shows its content and its footer while visible', async () => {
  const { element } = renderSheet();
  await render(element);
  expect(screen.getByText('Sheet body')).toBeOnTheScreen();
  expect(screen.getByText('Confirm')).toBeOnTheScreen();
});

describe('busy lock', () => {
  it('idle: pan down and the backdrop close it, and hardware back asks to close', async () => {
    const { element, onClose } = renderSheet();
    await render(element);
    expect(lastModal().enablePanDownToClose).toBe(true);
    expect(backdrop().props.pressBehavior).toBe('close');
    const back = backListeners().at(-1)!;
    let consumed: boolean | null | undefined;
    await act(async () => {
      consumed = back();
    });
    expect(consumed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('busy: refuses the swipe, the backdrop and hardware back (which it still consumes)', async () => {
    const { element, onClose } = renderSheet({ busy: true });
    await render(element);
    expect(lastModal().enablePanDownToClose).toBe(false);
    expect(backdrop().props.pressBehavior).toBe('none');
    const back = backListeners().at(-1)!;
    let consumed: boolean | null | undefined;
    await act(async () => {
      consumed = back();
    });
    expect(consumed).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a sheet that may never be dismissed by hand is locked the same way', async () => {
    const { element, onClose } = renderSheet({ dismissible: false });
    await render(element);
    expect(lastModal().enablePanDownToClose).toBe(false);
    await act(async () => {
      backListeners().at(-1)!();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('unlocks when the request finishes', async () => {
    const { element, onClose } = renderSheet({ busy: true });
    const view = await render(element);
    await view.rerender(
      <Sheet visible onClose={onClose} busy={false}>
        <Text>Sheet body</Text>
      </Sheet>,
    );
    expect(lastModal().enablePanDownToClose).toBe(true);
    await act(async () => {
      backListeners().at(-1)!();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('closing', () => {
  it('closed by the parent: slides away, then unmounts and reports it', async () => {
    const onClosed = jest.fn();
    const onClose = jest.fn();
    const view = await render(
      <Sheet visible onClose={onClose} onClosed={onClosed}>
        <Text>Sheet body</Text>
      </Sheet>,
    );
    await view.rerender(
      <Sheet visible={false} onClose={onClose} onClosed={onClosed}>
        <Text>Sheet body</Text>
      </Sheet>,
    );
    // Still drawn while it slides out.
    expect(screen.getByText('Sheet body')).toBeOnTheScreen();
    await act(async () => lastModal().onDismiss!());
    expect(screen.queryByText('Sheet body')).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
    // The parent closed it, so it is not told the member asked to.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('unmounts after the fallback when the library never reports the end of the slide', async () => {
    jest.useFakeTimers();
    try {
      const onClose = jest.fn();
      const view = await render(
        <Sheet visible onClose={onClose}>
          <Text>Sheet body</Text>
        </Sheet>,
      );
      await view.rerender(
        <Sheet visible={false} onClose={onClose}>
          <Text>Sheet body</Text>
        </Sheet>,
      );
      await act(async () => {
        jest.advanceTimersByTime(SHEET_CLOSE_FALLBACK_MS);
      });
      expect(screen.queryByText('Sheet body')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('closed by the member (pan down or backdrop): unmounts and tells the parent', async () => {
    const { element, onClose } = renderSheet();
    await render(element);
    await act(async () => lastModal().onDismiss!());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Sheet body')).toBeNull();
  });

  it('stops listening to back once closed', async () => {
    const remove = jest.fn();
    (BackHandler.addEventListener as jest.Mock).mockImplementation(() => ({ remove }));
    const { element } = renderSheet();
    await render(element);
    await act(async () => lastModal().onDismiss!());
    expect(remove).toHaveBeenCalled();
  });
});

describe('size', () => {
  it('fits its content by default', async () => {
    const { element } = renderSheet();
    await render(element);
    expect(lastModal().enableDynamicSizing).toBe(true);
    expect(lastModal().snapPoints).toBeUndefined();
  });

  it('opens at full height only at accessibility text sizes (fullHeight)', async () => {
    const { element } = renderSheet({ fullHeight: true });
    await render(element);
    expect(lastModal().snapPoints).toEqual(['100%']);
    expect(lastModal().enableDynamicSizing).toBe(false);
  });

  it('takes fixed snap points', async () => {
    const { element } = renderSheet({ snapPoints: [280, '50%'] });
    await render(element);
    expect(lastModal().snapPoints).toEqual([280, '50%']);
    expect(lastModal().enableDynamicSizing).toBe(false);
  });
});

it("never lets TalkBack read the library's English labels", async () => {
  const { element } = renderSheet();
  await render(element);
  expect(lastModal().accessible).toBe(false);
  expect(backdrop().props.accessible).toBe(false);
});

describe('fields inside a sheet', () => {
  function Where({ label }: { label: string }) {
    return <Text>{`${label}: ${useInSheet() ? 'in sheet' : 'on page'}`}</Text>;
  }

  it('know they are in a sheet, in the body and the footer alike, so they use its keyboard-aware input', async () => {
    await render(
      <>
        <Where label="page" />
        <Sheet visible onClose={jest.fn()} footer={<Where label="footer" />}>
          <Where label="body" />
        </Sheet>
      </>,
    );
    expect(screen.getByText('page: on page')).toBeOnTheScreen();
    expect(screen.getByText('body: in sheet')).toBeOnTheScreen();
    expect(screen.getByText('footer: in sheet')).toBeOnTheScreen();
  });
});

describe('keyboard', () => {
  // With edge to edge on, the OS never shrinks the window for the keyboard,
  // so the library's "adjustResize" mode would leave fields under it.
  it('lets the library lift the sheet over the keyboard itself', async () => {
    const { element } = renderSheet();
    await render(element);
    expect(lastModal().android_keyboardInputMode).toBeUndefined();
    expect(lastModal().keyboardBehavior).toBe('interactive');
  });
});

describe('pinned footer', () => {
  it('draws the footer in the slot, in the sheet, and pads the content by its measured height', async () => {
    const { element } = renderSheet({ testID: 'sheet' });
    await render(element);
    expect(lastModal().footerComponent).toBeDefined();
    const footer = screen.getByTestId('sheet.footer');
    expect(screen.getByText('Confirm')).toBeOnTheScreen();
    const padding = () =>
      (StyleSheet.flatten(screen.getByTestId('sheet.content').props.style) as { paddingBottom: number }).paddingBottom;
    expect(padding()).toBe(8);
    await fireEvent(footer, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 120 } } });
    expect(padding()).toBe(128);
  });

  it('a sheet without a footer has no slot and pads for the navigation bar instead', async () => {
    await render(
      <Sheet visible onClose={jest.fn()} testID="sheet">
        <Text>Sheet body</Text>
      </Sheet>,
    );
    expect(lastModal().footerComponent).toBeUndefined();
    expect(screen.queryByTestId('sheet.footer')).toBeNull();
  });
});

describe('TalkBack focus', () => {
  const setFocus = AccessibilityInfo.setAccessibilityFocus as jest.Mock;

  /** The test renderer has no native views; give the target a tag. */
  function tagFor(target: { current: unknown }, tag: number) {
    // The module itself (an `import * as` namespace is a copy of it).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reactNative: typeof ReactNative = require('react-native');
    jest
      .spyOn(reactNative, 'findNodeHandle')
      .mockImplementation(((instance: unknown) => (instance != null && instance === target.current ? tag : null)) as typeof ReactNative.findNodeHandle);
  }

  it('moves into the sheet, to its title, once the sheet has settled, and only once', async () => {
    const title = createRef<Text>();
    tagFor(title, 41);
    await render(
      <Sheet visible onClose={jest.fn()} initialFocusRef={title}>
        <Text ref={title}>Book this class?</Text>
      </Sheet>,
    );
    expect(setFocus).not.toHaveBeenCalled();
    await act(async () => lastModal().onChange!(0));
    expect(setFocus).toHaveBeenCalledWith(41);
    await act(async () => lastModal().onChange!(1));
    expect(setFocus).toHaveBeenCalledTimes(1);
  });

  it('goes back to the opener once the sheet has gone', async () => {
    jest.useFakeTimers();
    try {
      const opener = createRef<View>();
      tagFor(opener, 7);
      const onClose = jest.fn();
      const view = await render(
        <>
          <ReactNative.View ref={opener} />
          <Sheet visible onClose={onClose} returnFocusRef={opener}>
            <Text>Sheet body</Text>
          </Sheet>
        </>,
      );
      await act(async () => lastModal().onDismiss!());
      await act(async () => {
        jest.runOnlyPendingTimers();
      });
      expect(setFocus).toHaveBeenCalledWith(7);
      view.unmount();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('TalkBack focus in a sheet that does not scroll', () => {
  const setFocus = AccessibilityInfo.setAccessibilityFocus as jest.Mock;

  it('with no target named, moves to its content view', async () => {
    const handled: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reactNative: typeof ReactNative = require('react-native');
    jest.spyOn(reactNative, 'findNodeHandle').mockImplementation(((instance: unknown) => {
      handled.push(instance);
      return instance == null ? null : 12;
    }) as typeof ReactNative.findNodeHandle);
    await render(
      <Sheet visible onClose={jest.fn()} scrollable={false} testID="sheet">
        <Text>Sheet body</Text>
      </Sheet>,
    );
    await act(async () => lastModal().onChange!(0));
    expect(setFocus).toHaveBeenCalledWith(12);
    expect(handled).toHaveLength(1);
    expect(handled[0]).toBeTruthy();
  });
});

describe('while it slides away (closed by the parent)', () => {
  function sheet(visible: boolean, onBody: () => void, onFooter: () => void) {
    return (
      <Sheet
        visible={visible}
        onClose={jest.fn()}
        footer={
          <Pressable accessibilityRole="button" onPress={onFooter}>
            <Text>Done</Text>
          </Pressable>
        }
      >
        <Pressable accessibilityRole="button" onPress={onBody}>
          <Text>See venue</Text>
        </Pressable>
      </Sheet>
    );
  }

  it('takes no more touches, in the content or the footer, so nothing in it runs twice', async () => {
    const onBody = jest.fn();
    const onFooter = jest.fn();
    const view = await render(sheet(true, onBody, onFooter));
    await fireEvent.press(screen.getByRole('button', { name: 'See venue' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(onBody).toHaveBeenCalledTimes(1);
    expect(onFooter).toHaveBeenCalledTimes(1);

    await view.rerender(sheet(false, onBody, onFooter));
    // Still drawn while it slides out, but no longer pressable.
    expect(screen.getByRole('button', { name: 'See venue' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'See venue' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(onBody).toHaveBeenCalledTimes(1);
    expect(onFooter).toHaveBeenCalledTimes(1);
  });
});

describe('each opening is its own presentation', () => {
  function sheet(visible: boolean, onClose: () => void, onClosed: () => void) {
    return (
      <Sheet visible={visible} onClose={onClose} onClosed={onClosed}>
        <Text>Sheet body</Text>
      </Sheet>
    );
  }

  it('closed and at once reopened: a fresh sheet comes up, and the late report of the first close changes nothing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BottomSheetModal } = require('@gorhom/bottom-sheet');
    const present = jest.spyOn(BottomSheetModal.prototype, 'present');
    const onClose = jest.fn();
    const onClosed = jest.fn();
    const view = await render(sheet(true, onClose, onClosed));
    expect(present).toHaveBeenCalledTimes(1);
    const first = present.mock.contexts[0];

    await view.rerender(sheet(false, onClose, onClosed));
    const reportFirstClose = lastModal().onDismiss!;
    await view.rerender(sheet(true, onClose, onClosed));
    // A new modal is presented; the closing one is never asked to come back.
    expect(present).toHaveBeenCalledTimes(2);
    expect(present.mock.contexts[1]).not.toBe(first);

    await act(async () => reportFirstClose());
    expect(screen.getByText('Sheet body')).toBeOnTheScreen();
    expect(onClose).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();

    // The new presentation still closes as any other.
    await view.rerender(sheet(false, onClose, onClosed));
    await act(async () => lastModal().onDismiss!());
    expect(screen.queryByText('Sheet body')).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the fallback finished the close, then the library reports it: closed once, and the parent is not told the member closed it', async () => {
    jest.useFakeTimers();
    try {
      const onClose = jest.fn();
      const onClosed = jest.fn();
      const view = await render(sheet(true, onClose, onClosed));
      await view.rerender(sheet(false, onClose, onClosed));
      const report = lastModal().onDismiss!;
      await act(async () => {
        jest.advanceTimersByTime(SHEET_CLOSE_FALLBACK_MS);
      });
      expect(screen.queryByText('Sheet body')).toBeNull();
      expect(onClosed).toHaveBeenCalledTimes(1);
      await act(async () => report());
      expect(onClosed).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('its screen unmounted while it was up: a later report from the library tells nobody', async () => {
    const onClose = jest.fn();
    const onClosed = jest.fn();
    const view = await render(sheet(true, onClose, onClosed));
    const report = lastModal().onDismiss!;
    await act(async () => view.unmount());
    await act(async () => report());
    expect(onClose).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('a member close (pan down) is reported once, however often the library repeats it', async () => {
    const onClose = jest.fn();
    const onClosed = jest.fn();
    await render(sheet(true, onClose, onClosed));
    const report = lastModal().onDismiss!;
    await act(async () => report());
    await act(async () => report());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});

describe("the screen's context inside the sheet", () => {
  // On a phone the library draws the sheet in UiKitProvider's host, above
  // every screen; the stand-in does the same inside the provider. So a
  // context the Sheet does not carry across is missing here as it is there.
  const ScreenOnly = createContext('missing');

  type Params = { Venue: undefined; Detail: undefined };
  const Stack = createNativeStackNavigator<Params>();

  function SheetContent() {
    const route = useRoute();
    const focused = useIsFocused();
    const navigation = useNavigation<NativeStackScreenProps<Params, 'Venue'>['navigation']>();
    const screenOnly = useContext(ScreenOnly);
    return (
      <>
        <Text>{`route: ${route.name}`}</Text>
        <Text>{`focused: ${focused}`}</Text>
        <Text>{`screen-only context: ${screenOnly}`}</Text>
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Detail')}>
          <Text>See details</Text>
        </Pressable>
      </>
    );
  }

  function FooterContent() {
    return <Text>{`footer route: ${useRoute().name}, ${useIsFocused() ? 'focused' : 'blurred'}`}</Text>;
  }

  function VenueScreen() {
    const [open, setOpen] = useState(true);
    return (
      <ScreenOnly.Provider value="present">
        <Text>Venue screen</Text>
        <Sheet visible={open} onClose={() => setOpen(false)} footer={<FooterContent />}>
          <SheetContent />
        </Sheet>
      </ScreenOnly.Provider>
    );
  }

  function DetailScreen() {
    return <Text>Detail screen</Text>;
  }

  async function renderApp() {
    await render(
      <NavigationContainer>
        <UiKitProvider>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Venue" component={VenueScreen} />
            <Stack.Screen name="Detail" component={DetailScreen} />
          </Stack.Navigator>
        </UiKitProvider>
      </NavigationContainer>,
    );
  }

  it('is drawn outside the screen that opened it, as on a phone', async () => {
    await renderApp();
    expect(await screen.findByText('screen-only context: missing')).toBeOnTheScreen();
  });

  it("reads that screen's route and focus, in the content and the footer, and navigates through its stack", async () => {
    await renderApp();
    expect(await screen.findByText('route: Venue')).toBeOnTheScreen();
    expect(screen.getByText('focused: true')).toBeOnTheScreen();
    expect(screen.getByText('footer route: Venue, focused')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'See details' }));
    // The sheet is still up over the stack, so the screens are hidden from TalkBack.
    expect(await screen.findByText('Detail screen', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText('focused: false')).toBeOnTheScreen();
    expect(screen.getByText('footer route: Venue, blurred')).toBeOnTheScreen();
  });
});
