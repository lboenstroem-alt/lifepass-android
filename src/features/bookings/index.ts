/**
 * The booking reminders' public surface (BOOK-1): the booking flow and the
 * class sheet schedule them when a booking lands; My bookings (LIB-1) removes
 * them when a booking is cancelled.
 */
export {
  cancelCheckInReminder,
  checkInReminderIdentifiers,
  checkInReminderPlan,
  REMINDER_MIN_LEAD_MS,
  scheduleCheckInReminder,
  type CheckInReminderRequest,
} from './classReminders';
