/**
 * The engagement nudges and the health reminders are wired at startup
 * (./reminderStartup.ts, loaded last by the notification layer's
 * src/notifications/register.ts), only once, and each on its own: one that
 * throws while it loads costs neither the other nor the notification
 * layer's own startup.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- each case loads the modules afresh */
import type { notificationsState } from '@test/mocks/expoNotifications';

const mockInstalls = { engagement: 0, health: 0 };
const mockFail = { engagement: false, health: false };
const mockTrack = jest.fn();

jest.mock('../engagement', () => {
  if (mockFail.engagement) throw new Error('engagement failed to load');
  return {
    installEngagementNudges: () => {
      mockInstalls.engagement += 1;
    },
  };
});
jest.mock('../healthReminders', () => {
  if (mockFail.health) throw new Error('health reminders failed to load');
  return {
    installHealthReminders: () => {
      mockInstalls.health += 1;
    },
  };
});
jest.mock('../../lib/analytics', () => ({
  ...jest.requireActual<object>('../../lib/analytics'),
  track: (...args: unknown[]) => mockTrack(...args),
}));

beforeEach(() => {
  mockInstalls.engagement = 0;
  mockInstalls.health = 0;
  mockFail.engagement = false;
  mockFail.health = false;
  mockTrack.mockClear();
});

it('loading the notification layer installs both, once', () => {
  jest.isolateModules(() => {
    require('../register');
  });
  expect(mockInstalls).toEqual({ engagement: 1, health: 1 });
});

it('loading the startup twice installs nothing twice', () => {
  jest.isolateModules(() => {
    require('../register');
    require('../reminderStartup');
  });
  expect(mockInstalls).toEqual({ engagement: 1, health: 1 });
});

it('one that throws while it loads loses only itself, and is reported', () => {
  mockFail.engagement = true;
  jest.isolateModules(() => {
    require('../reminderStartup');
  });
  expect(mockInstalls).toEqual({ engagement: 0, health: 1 });
  expect(mockTrack).toHaveBeenCalledWith('service_error', expect.objectContaining({ op: 'register_notifications.engagement' }));

  mockFail.engagement = false;
  mockFail.health = true;
  jest.isolateModules(() => {
    require('../reminderStartup');
  });
  expect(mockInstalls).toEqual({ engagement: 1, health: 1 });
  expect(mockTrack).toHaveBeenCalledWith('service_error', expect.objectContaining({ op: 'register_notifications.health-reminders' }));
});

it('a startup that cannot load at all costs the notification layer nothing: the foreground handler is still installed', () => {
  let handlerInstalled = false;
  jest.isolateModules(() => {
    jest.doMock('../reminderStartup', () => {
      throw new Error('reminder startup failed to load');
    });
    expect(() => require('../register')).not.toThrow();
    // The notifications fake this sandbox's register file talked to.
    const sandboxed = require('@test/mocks/expoNotifications') as { notificationsState: typeof notificationsState };
    handlerInstalled = sandboxed.notificationsState.handler() !== null;
  });
  jest.dontMock('../reminderStartup');
  expect(handlerInstalled).toBe(true);
  expect(mockInstalls).toEqual({ engagement: 0, health: 0 });
});
