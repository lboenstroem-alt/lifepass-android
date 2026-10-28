/* eslint lifepass/no-literal-copy: "error" */
// The first build's Account screen moved to src/features/account/AccountScreen.tsx
// (ACCT-1). This path stays only because F4's navigation tests still name it
// in `jest.mock(...)` (a mock of a missing module fails the suite); QA-1
// deletes it with those lines. App code imports the new path.
export { default } from '../../features/account/AccountScreen';
