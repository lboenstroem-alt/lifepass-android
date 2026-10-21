/**
 * The feature's barrel holds leaf modules only: the class sheet (sheet/**),
 * the booking flow and the Coach import from it, so it must never load the
 * feed screen, which opens the sheet (a require cycle at startup through the
 * tabs shell's `ClassSheetHost`).
 */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('../ClassesDiscovery', () => {
  throw new Error('the barrel loaded the feed screen');
});
jest.mock('../sheet', () => {
  throw new Error('the barrel loaded the class sheet');
});
jest.mock('../../../stores/locationStore', () => {
  throw new Error('the barrel loaded the location store');
});

it('loads without the feed screen, the class sheet or the location store', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const barrel = require('../index') as typeof import('../index');
  expect(typeof barrel.toOccurrence).toBe('function');
  expect(typeof barrel.DayCalendar).toBe('function');
});
