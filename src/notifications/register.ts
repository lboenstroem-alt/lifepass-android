/**
 * Notifications at startup (iOS sets its notification delegate before launch
 * finishes): the foreground handler that shows nothing while the app is
 * open, and the four channels, named in the app's language and renamed when
 * it changes. Nothing here asks for permission.
 *
 * Loaded with every feature's register file (src/app/registrations.ts), which
 * the app store's launch loads first thing.
 */
import { useAppStore } from '../stores/appStore';

import { ensureChannels, startNotifications } from '.';

void startNotifications();

let languageSeen = useAppStore.getState().language;
useAppStore.subscribe((state) => {
  if (state.language === languageSeen) return;
  languageSeen = state.language;
  void ensureChannels(state.language);
});
