/**
 * When the export file goes (./cleanup.ts): never the moment the share
 * answers (Android's chooser can answer before the chosen app has read the
 * file), but once a few minutes have passed AND LifePass is in front; the
 * backstops leave alone a file a share still holds; a new export or a
 * sign-out takes everything at once.
 */
import type { AppStateStatus } from 'react-native';

import {
  clearAllExports,
  clearLeftoverExports,
  EXPORT_SHARE_GRACE_MS,
  holdForShare,
  releaseAfterShare,
  releaseUnshared,
  resetExportCleanupForTests,
} from '../cleanup';

function fakePlatform(initial: AppStateStatus = 'active') {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  const clear = jest.fn(async () => undefined);
  const appState = {
    currentState: initial as AppStateStatus,
    addEventListener: (_type: 'change', listener: (state: AppStateStatus) => void) => {
      listeners.push(listener);
      return { remove: () => void listeners.splice(listeners.indexOf(listener), 1) };
    },
  };
  return {
    clear,
    appState,
    listeners,
    /** The app moves to `state` and tells its listeners. */
    become(state: AppStateStatus) {
      appState.currentState = state;
      [...listeners].forEach((listener) => listener(state));
    },
  };
}

let platform: ReturnType<typeof fakePlatform>;

beforeEach(() => {
  jest.useFakeTimers();
  platform = fakePlatform();
  resetExportCleanupForTests({ appState: platform.appState, clear: platform.clear });
});

afterEach(() => {
  resetExportCleanupForTests();
  jest.useRealTimers();
});

describe('after a share answers', () => {
  it('the file stays through the grace, then goes when LifePass is in front', () => {
    holdForShare();
    releaseAfterShare();
    expect(platform.clear).not.toHaveBeenCalled();
    jest.advanceTimersByTime(EXPORT_SHARE_GRACE_MS - 1);
    expect(platform.clear).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(platform.clear).toHaveBeenCalledTimes(1);
  });

  it('a grace that runs out while the member is in the other app waits for their return', () => {
    holdForShare();
    releaseAfterShare();
    platform.become('background');
    jest.advanceTimersByTime(EXPORT_SHARE_GRACE_MS * 3);
    expect(platform.clear).not.toHaveBeenCalled();
    platform.become('inactive');
    expect(platform.clear).not.toHaveBeenCalled();
    platform.become('active');
    expect(platform.clear).toHaveBeenCalledTimes(1);
    // Once: the wait has stopped listening.
    expect(platform.listeners).toHaveLength(0);
    platform.become('background');
    platform.become('active');
    expect(platform.clear).toHaveBeenCalledTimes(1);
  });

  it('a share that never opened (no target, or it failed): the file goes at once', async () => {
    holdForShare();
    await releaseUnshared();
    expect(platform.clear).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(EXPORT_SHARE_GRACE_MS);
    expect(platform.clear).toHaveBeenCalledTimes(1);
  });
});

describe('the backstops', () => {
  it('opening the page or starting the app leaves alone a file a share still holds', async () => {
    holdForShare();
    await clearLeftoverExports();
    expect(platform.clear).not.toHaveBeenCalled();

    releaseAfterShare();
    await clearLeftoverExports();
    expect(platform.clear).not.toHaveBeenCalled();

    jest.advanceTimersByTime(EXPORT_SHARE_GRACE_MS);
    expect(platform.clear).toHaveBeenCalledTimes(1);
    // Nothing held any more: a leftover goes.
    await clearLeftoverExports();
    expect(platform.clear).toHaveBeenCalledTimes(2);
  });

  it('a new export or a sign-out takes everything now, and the wait ends', async () => {
    holdForShare();
    releaseAfterShare();
    await clearAllExports();
    expect(platform.clear).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(EXPORT_SHARE_GRACE_MS);
    expect(platform.clear).toHaveBeenCalledTimes(1);
  });

  it("a second share's file is never deleted under its own share sheet by the first one's wait", () => {
    holdForShare();
    releaseAfterShare();
    jest.advanceTimersByTime(EXPORT_SHARE_GRACE_MS / 2);
    holdForShare();
    jest.advanceTimersByTime(EXPORT_SHARE_GRACE_MS);
    expect(platform.clear).not.toHaveBeenCalled();
    releaseAfterShare();
    jest.advanceTimersByTime(EXPORT_SHARE_GRACE_MS);
    expect(platform.clear).toHaveBeenCalledTimes(1);
  });
});
