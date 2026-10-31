/**
 * @deprecated The first build's booking screen moved to
 * src/features/booking/BookingFlowScreen.tsx (BOOK-1). Nothing in the app
 * imports this path any more; it remains only because three navigation and
 * app-shell test files (F3, F4) still `jest.mock` it, and jest refuses to mock
 * a module that does not exist. QA-1 deletes it once those mocks are gone.
 */
export { default } from '../../features/booking/BookingFlowScreen';
