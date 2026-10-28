/**
 * The check-in feature's register file (loaded once at startup by
 * src/app/registrations.ts): it registers the walk-in flow's hooks
 * (CHECKIN-2's sign-out cleaner and walk_in payment presenter) before any
 * Scan screen has mounted, and it reaches them through ./walkin/register,
 * never the ./walkin barrel with the walk-in's screens, so a UI module that
 * fails to load cannot cost the walk-in its sign-out cleaner.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- each case loads the file afresh over its own walk-in module */

afterEach(() => {
  jest.dontMock('../walkin/register');
  jest.dontMock('../walkin/WalkInFlowHost');
  jest.resetModules();
});

it("calls the walk-in package's registerWalkInHooks() once, as it loads", () => {
  const registerWalkInHooks = jest.fn();
  jest.isolateModules(() => {
    jest.doMock('../walkin/register', () => ({ registerWalkInHooks }));
    require('../register');
  });
  expect(registerWalkInHooks).toHaveBeenCalledTimes(1);
});

it("does not load the walk-in's screens at startup", () => {
  const hostLoaded = jest.fn();
  jest.isolateModules(() => {
    jest.doMock('../walkin/register', () => ({ registerWalkInHooks: jest.fn() }));
    jest.doMock('../walkin/WalkInFlowHost', () => {
      hostLoaded();
      return { __esModule: true, default: () => null };
    });
    expect(() => require('../register')).not.toThrow();
  });
  expect(hostLoaded).not.toHaveBeenCalled();
});
