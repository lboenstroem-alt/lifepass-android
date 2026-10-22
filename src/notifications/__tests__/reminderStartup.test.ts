/**
 * The engagement nudges and the health reminders are wired at startup, with
 * the rest of the notification layer (src/notifications/register.ts, loaded
 * with every session hook), and only once.
 */
const mockInstalls = { engagement: 0, health: 0 };

jest.mock('../engagement', () => ({
  installEngagementNudges: () => {
    mockInstalls.engagement += 1;
  },
}));
jest.mock('../healthReminders', () => ({
  installHealthReminders: () => {
    mockInstalls.health += 1;
  },
}));

it('loading the notification layer installs both, once', () => {
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../register');
  });
  expect(mockInstalls).toEqual({ engagement: 1, health: 1 });
});
