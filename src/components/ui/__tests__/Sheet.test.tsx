/**
 * The sheet's busy lock (plan F5: "The Sheet refuses dismissal while busy,
 * swipe and back"), hardware back, and the controlled open/close cycle.
 *
 * The library's own test stand-in renders a sheet's children inline; this
 * file wraps it to record the props the sheet hands the library, and to play
 * the library's part (`onDismiss` once the slide-out ends).
 */
import { act, render, screen } from '@testing-library/react-native';
import { BackHandler, Text } from 'react-native';
import type { ReactElement } from 'react';

import Sheet, { SHEET_CLOSE_FALLBACK_MS } from '../Sheet';
import { useInSheet } from '../SheetTextInput';

type ModalProps = {
  enablePanDownToClose?: boolean;
  enableDynamicSizing?: boolean;
  snapPoints?: (string | number)[];
  onDismiss?: () => void;
  accessible?: boolean;
  backdropComponent?: (props: object) => ReactElement<{ pressBehavior?: string; accessible?: boolean }>;
};

const mockModals: ModalProps[] = [];

jest.mock('@gorhom/bottom-sheet', () => {
  const library = jest.requireActual('@gorhom/bottom-sheet/mock');
  class RecordingModal extends library.BottomSheetModal {
    render() {
      mockModals.push(this.props as ModalProps);
      return super.render();
    }
  }
  return { ...library, __esModule: true, BottomSheetModal: RecordingModal };
});

const lastModal = () => mockModals[mockModals.length - 1];

/** The hardware-back listeners the sheet registered, newest last. */
function backListeners(): (() => boolean | null | undefined)[] {
  return (BackHandler.addEventListener as jest.Mock).mock.calls
    .filter(([event]) => event === 'hardwareBackPress')
    .map(([, handler]) => handler);
}

beforeEach(() => {
  mockModals.length = 0;
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
    expect(lastModal().backdropComponent!({}).props.pressBehavior).toBe('close');
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
    expect(lastModal().backdropComponent!({}).props.pressBehavior).toBe('none');
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
  expect(lastModal().backdropComponent!({}).props.accessible).toBe(false);
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
