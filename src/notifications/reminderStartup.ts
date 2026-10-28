/**
 * NOTIF-1 at startup: the engagement nudges (./engagement.ts) and the health
 * reminders (./healthReminders.ts) wired, once, to launch, the foreground,
 * the purchase state, the Today read, the reminder choices and a sign-out.
 *
 * ITS OWN FILE, LOADED ON ITS OWN. Their import trees (the health store, the
 * API, Body and goals, the dev fixtures) are much larger than the
 * notification layer's, and nothing in them may cost that layer its own
 * startup: the foreground handler that shows nothing while the app is open,
 * the channels and the account language (./register.ts, F7's). Each install
 * here is required in its own try as well, so one that throws while it loads
 * loses only itself, and is reported (`service_error`, op
 * `register_notifications.<name>`) as src/app/registrations.ts reports a
 * register file. iOS calls each service by name from `ContentView`, so a
 * failing one never stops the notification delegate set up in `AppDelegate`.
 *
 * WHERE IT IS LOADED. For now at the END of ./register.ts, after F7's own
 * lines and in a try (a shared-file edit for F7 to sign off at merge). Its
 * intended home is a SHARED_LAYERS entry of its own in
 * src/app/registrations.ts (F3 contract request):
 * `notificationNudges: () => require('../notifications/reminderStartup')`,
 * after which the lines in ./register.ts go. Loading it twice installs
 * nothing twice: each install runs once.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- each install is loaded in its own try (see above) */
import type * as Engagement from './engagement';
import type * as HealthReminders from './healthReminders';
import { errorDescription, track } from '../lib/analytics';

type Install = () => void;

/** What is installed, by name, in this order. */
export const REMINDER_INSTALLS: Readonly<Record<string, Install>> = {
  engagement: () => {
    const { installEngagementNudges } = require('./engagement') as typeof Engagement;
    installEngagementNudges();
  },
  'health-reminders': () => {
    const { installHealthReminders } = require('./healthReminders') as typeof HealthReminders;
    installHealthReminders();
  },
};

/** Runs each install in its own try: one that throws loses its own wiring only. */
export function installReminders(installs: Readonly<Record<string, Install>> = REMINDER_INSTALLS): void {
  for (const [name, install] of Object.entries(installs)) {
    try {
      install();
    } catch (error) {
      if (__DEV__ && process.env.NODE_ENV !== 'test') {
        console.error(`[notifications] the "${name}" startup failed to load`, error);
      }
      try {
        track('service_error', { op: `register_notifications.${name}`, error: errorDescription(error) });
      } catch {
        // The report must never be what stops the next install.
      }
    }
  }
}

installReminders();
