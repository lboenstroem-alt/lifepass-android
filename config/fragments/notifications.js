// expo-notifications (owner: F7, src/notifications).
//
// LOCAL notifications only, as on iOS (owner ruling 4: no push, no token ever
// leaves the phone), so there is no FCM project and no google-services.json.
// Channels (health, rest_timer, bookings, engagement) are created at runtime
// (src/notifications/channels.ts) with names in the account language: a
// channel's importance is fixed once created, its name is not.
//
// No exact alarms (owner decision D10): the plugin adds POST_NOTIFICATIONS and
// RECEIVE_BOOT_COMPLETED (scheduled notifications survive a reboot) and
// nothing else; a rest-over notification may be delayed by Doze.
//
// The small icon must be a white glyph on transparency: Android draws only its
// alpha, so the full-colour app icon showed as a white square. The colour
// tints it, and is the iOS AccentColor (#4785C2).
const { withPlugin } = require('./_plugins');

const NOTIFICATION_ICON = './assets/notification-icon.png';
const BRAND_ACCENT = '#4785C2';

module.exports = function notifications(config) {
  return withPlugin(config, [
    'expo-notifications',
    {
      icon: NOTIFICATION_ICON,
      color: BRAND_ACCENT,
      sounds: [],
      enableBackgroundRemoteNotifications: false,
    },
  ]);
};

module.exports.NOTIFICATION_ICON = NOTIFICATION_ICON;
module.exports.BRAND_ACCENT = BRAND_ACCENT;
