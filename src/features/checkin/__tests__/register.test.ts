/**
 * The check-in feature's register file (loaded once at startup by
 * src/app/registrations.ts): it registers the walk-in flow's hooks
 * (CHECKIN-2's sign-out cleaner and walk_in payment presenter) before any
 * Scan screen has mounted, and loads cleanly on the slot's stub, which has
 * none to register.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- each case loads the file afresh over its own walk-in module */

afterEach(() => {
  jest.dontMock('../walkin');
  jest.resetModules();
});

it("calls the walk-in package's registerWalkInHooks() once, as it loads", () => {
  const registerWalkInHooks = jest.fn();
  jest.isolateModules(() => {
    jest.doMock('../walkin', () => ({ registerWalkInHooks }));
    require('../register');
  });
  expect(registerWalkInHooks).toHaveBeenCalledTimes(1);
});

it('loads on the slot stub, which has no hooks to register', () => {
  jest.isolateModules(() => {
    jest.doMock('../walkin', () => ({ useWalkInFlow: () => ({ isIdle: true, startWalkIn: async () => undefined }) }));
    expect(() => require('../register')).not.toThrow();
  });
});
