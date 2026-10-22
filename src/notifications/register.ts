/**
 * Notifications at startup (iOS sets its notification delegate before launch
 * finishes): the foreground handler that shows nothing while the app is
 * open, and the four channels, named in the app's language and renamed when
 * it changes. Nothing here asks for permission.
 *
 * The ACCOUNT language is also kept under `health.reminders.lastLanguage`
 * (iOS `HealthReminderService.sync` writes it there), whenever the store
 * knows it and it changes: a background job runs where the app store has not
 * loaded the account, and writes its notification in that language
 * (`notificationLanguage()`), not whatever the phone starts in. Only the
 * account's: a headless run starts signed out in the phone's language, and
 * writing that would undo the very thing the key is for.
 *
 * Loaded with the session hooks, which the app store's launch loads first
 * thing: src/app/registrations.ts (F3's) lists this file as a SHARED_LAYERS
 * entry, `notifications: () => require('../notifications/register')` (F3
 * contract request; F7 does not edit that file).
 */
import { normaliseLang, type Lang } from '../i18n';
import { useAppStore, type AppStoreState } from '../stores/appStore';

import { ensureChannels, rememberNotificationLanguage, startNotifications } from '.';

/** The signed-in account's language when the store knows it (the profile's, else the cached one); never the phone's. */
export function accountLanguage(state: Pick<AppStoreState, 'isAuthenticated' | 'profile' | 'cachedAccountLanguage'>): Lang | null {
  if (!state.isAuthenticated) return null;
  const locale = state.profile?.locale;
  if (locale !== null && locale !== undefined) return normaliseLang(locale);
  return state.cachedAccountLanguage ?? null;
}

void startNotifications();

let languageSeen = useAppStore.getState().language;
let rememberedLanguage: Lang | null = null;

function rememberAccountLanguage(state: AppStoreState): void {
  const language = accountLanguage(state);
  if (language === null || language === rememberedLanguage) return;
  rememberedLanguage = language;
  void rememberNotificationLanguage(language);
}

rememberAccountLanguage(useAppStore.getState());
useAppStore.subscribe((state) => {
  rememberAccountLanguage(state);
  if (state.language === languageSeen) return;
  languageSeen = state.language;
  void ensureChannels(state.language);
});

// NOTIF-1 (shared-file edit, F7 sign-off at merge): the engagement nudges
// and the health reminders, loaded AFTER this layer's own startup above and
// in a try, so nothing in their import tree can cost the handler, the
// channels or the account language. Intended home: their own SHARED_LAYERS
// entry in src/app/registrations.ts (F3 contract request), and then these
// lines go (./reminderStartup.ts).
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded last, in its own try (see above)
  require('./reminderStartup');
} catch {
  // ./reminderStartup.ts reports a failing install itself; failing to load at all costs only the reminders.
}
