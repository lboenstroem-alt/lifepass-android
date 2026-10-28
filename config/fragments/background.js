// Background work: expo-background-task on WorkManager (owner: F0; jobs are
// registered at runtime through F7's `src/background/registry.ts`, used by
// NOTIF-2 for the monthly feedback refresh). No observer wakes exist on
// Android, so nothing else is configured here.
const { withPlugin } = require('./_plugins');

module.exports = function background(config) {
  return withPlugin(config, 'expo-background-task');
};
