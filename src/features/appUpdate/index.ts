/**
 * The update prompt (UPDATE-1): the app root mounts the host once; the rest
 * is for tests and the store's own callers.
 *
 *   <AppUpdateHost />   // App.tsx, above the navigator
 */
export { default as AppUpdateHost } from './AppUpdateHost';
export {
  compareAppVersions,
  decideUpdatePrompt,
  formatAppVersion,
  parseAppVersion,
  type AppVersion,
  type UpdatePrompt,
} from './policy';
export {
  checkForUpdate,
  checkForUpdateIfStale,
  dismissUpdateAvailable,
  resetAppUpdateForTests,
  setAppUpdateDepsForTests,
  useAppUpdate,
} from './updateStore';
