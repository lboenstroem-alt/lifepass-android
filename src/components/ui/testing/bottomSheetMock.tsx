// A test stand-in for @gorhom/bottom-sheet that behaves like the library
// wherever the UI kit's Sheet depends on it. The library's own mock
// (`@gorhom/bottom-sheet/mock`) renders a sheet's content where it is
// declared, has no footer slot and never calls `onDismiss`, so a test run on
// it exercises a sheet the app never ships: the footer drawn inline, every
// close ending on the Sheet's fallback timer, and content that keeps every
// context of the screen that declared it. This one:
//
// - FOOTER SLOT: exports `BottomSheetFooter` and draws `footerComponent` (as
//   a component, the way the library mounts it) after the content, where the
//   library pins it.
// - DISMISS: `dismiss()` ends the slide-out at once and calls `onDismiss`, as
//   the library does once the sheet has left the screen. Set
//   `bottomSheetMock.settleDismiss = false` to hold a sheet mid-slide and
//   call `bottomSheetMock.latest()?.onDismiss?.()` yourself.
// - PORTAL: inside a `BottomSheetModalProvider` (UiKitProvider mounts one), a
//   sheet renders into the provider's host, after the app and OUTSIDE the
//   tree that declared it, as on a phone; a context the Sheet does not carry
//   across is missing in tests too. Without a provider it renders in place,
//   so a screen test needs no provider to reach a sheet's content.
// - RECORDS the props each modal rendered with (`bottomSheetMock.modals`).
//
// jest.setup.ts still maps every suite to the library's mock (a contract
// request to F0 asks it to map them here and call `bottomSheetMock.reset()`
// in a global beforeEach). Until that lands, a test file that renders a Sheet
// or ConfirmSheet MUST opt in itself, or the footer (Confirm, Cancel, the
// money line) is never rendered:
//
//   jest.mock('@gorhom/bottom-sheet', () =>
//     require('<relative path>/components/ui/testing/bottomSheetMock').bottomSheetModule,
//   );
//
// and call `bottomSheetMock.reset()` in `beforeEach`.
import {
  Component,
  createContext,
  createElement,
  Fragment,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { View } from 'react-native';

/* eslint-disable @typescript-eslint/no-require-imports */
const library = require('@gorhom/bottom-sheet/mock') as Record<string, unknown>;
/* eslint-enable @typescript-eslint/no-require-imports */

const NOOP = () => undefined;
const NOOP_VALUE = { value: 0, set: NOOP, get: () => 0 };

/** The props a modal rendered with, as the Sheet handed them to the library. */
export type RecordedModalProps = {
  children?: ReactNode | ((props: { data: unknown }) => ReactNode);
  onDismiss?: () => void;
  onChange?: (index: number) => void;
  footerComponent?: ComponentType<{ animatedFooterPosition: typeof NOOP_VALUE }>;
  backdropComponent?: (props: object) => ReactNode;
  enablePanDownToClose?: boolean;
  enableDynamicSizing?: boolean;
  snapPoints?: (string | number)[];
  accessible?: boolean;
  android_keyboardInputMode?: string;
  keyboardBehavior?: string;
  [prop: string]: unknown;
};

export const bottomSheetMock = {
  /** Every render of every modal, oldest first. */
  modals: [] as RecordedModalProps[],
  /** true: `dismiss()` calls `onDismiss` at once (the slide-out has ended). */
  settleDismiss: true,
  latest(): RecordedModalProps | undefined {
    return bottomSheetMock.modals[bottomSheetMock.modals.length - 1];
  },
  reset(): void {
    bottomSheetMock.modals.length = 0;
    bottomSheetMock.settleDismiss = true;
  },
};

type Host = { put(key: number, node: ReactNode): void; remove(key: number): void };

const HostContext = createContext<Host | null>(null);

/** The provider: the app, then every sheet presented into it. */
function BottomSheetModalProvider({ children }: { children?: ReactNode }) {
  const [nodes, setNodes] = useState<ReadonlyMap<number, ReactNode>>(new Map());
  const host = useMemo<Host>(
    () => ({
      put: (key, node) => setNodes((previous) => new Map(previous).set(key, node)),
      remove: (key) =>
        setNodes((previous) => {
          if (!previous.has(key)) return previous;
          const next = new Map(previous);
          next.delete(key);
          return next;
        }),
    }),
    [],
  );
  return (
    <HostContext.Provider value={host}>
      {children}
      {[...nodes].map(([key, node]) => (
        <Fragment key={key}>{node}</Fragment>
      ))}
    </HostContext.Provider>
  );
}

let nextHostKey = 1;

class BottomSheetModal extends Component<RecordedModalProps> {
  static contextType = HostContext;

  private readonly hostKey = nextHostKey++;
  private data: unknown = null;

  private host(): Host | null {
    return this.context as Host | null;
  }

  present(data?: unknown): void {
    this.data = data ?? null;
  }

  dismiss(): void {
    this.data = null;
    if (bottomSheetMock.settleDismiss) this.props.onDismiss?.();
  }

  close(): void {
    this.data = null;
  }

  forceClose(): void {
    this.data = null;
  }

  snapToIndex(): void {}
  snapToPosition(): void {}
  expand(): void {}
  collapse(): void {}

  componentDidMount(): void {
    this.host()?.put(this.hostKey, this.content());
  }

  componentDidUpdate(): void {
    this.host()?.put(this.hostKey, this.content());
  }

  componentWillUnmount(): void {
    this.host()?.remove(this.hostKey);
  }

  private content(): ReactNode {
    const { children, footerComponent } = this.props;
    const body = typeof children === 'function' ? children({ data: this.data }) : children;
    return (
      <>
        {body}
        {footerComponent ? createElement(footerComponent, { animatedFooterPosition: NOOP_VALUE }) : null}
      </>
    );
  }

  render(): ReactNode {
    bottomSheetMock.modals.push(this.props);
    // In a provider the content is drawn by the provider's host instead.
    return this.host() ? null : this.content();
  }
}

/** The footer slot: the library positions it; here it draws its children. */
function BottomSheetFooter({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

/** The module to hand `jest.mock('@gorhom/bottom-sheet', ...)`. */
export const bottomSheetModule = {
  ...library,
  __esModule: true,
  BottomSheetModalProvider,
  BottomSheetModal,
  BottomSheetFooter,
  // A real view, as the library's is, so its props (testID, style) reach the tree.
  BottomSheetView: View,
};
