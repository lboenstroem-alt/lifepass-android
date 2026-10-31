/**
 * "Something the notification plan depends on changed": a switch, a report
 * marked seen, a note hidden, a fresh read (iOS `FeedbackStore.onChanged`,
 * which AppState turns into `FeedbackNotificationService.scheduleSync`).
 *
 * The monthly feedback's notifications are NOTIF-2's; it listens here
 * (`subscribeFeedbackChanges`) rather than the store calling into it, so the
 * store works, and is tested, without any notification code. Listeners are
 * told nothing but that something changed: never a line of a report.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Called after every change the notifications may depend on. Returns an unsubscribe. */
export function subscribeFeedbackChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tells every listener; one that throws does not stop the others. */
export function notifyFeedbackChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A listener's failure is its own.
    }
  }
}
