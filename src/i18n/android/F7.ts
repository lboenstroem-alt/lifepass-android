// Android-only copy for F7: Health and notifications platform.
//
// Owned by F7 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// - notif.channel.*: Android files every notification under a channel the
//   member can silence on its own in system settings, and names it there.
//   iOS has no channels, so these names are Android's own.
// - permission.rationale.*: Android's system dialogs carry no purpose
//   string, so the app says why before it asks. The English is the iOS
//   purpose string word for word (InfoPlist, PERMISSION_PROMPTS.md); the
//   Icelandic is the draft kept there for camera, photos and location, and
//   written for the microphone and speech, which iOS never drafted.
import { definePack } from './pack';

export default definePack({
  en: {
    'notif.channel.health': 'Plan and health',
    'notif.channel.health.description': 'Workout days, the weekly check-in and your monthly feedback.',
    'notif.channel.rest_timer': 'Rest timer',
    'notif.channel.rest_timer.description': 'Tells you when a rest between sets is over.',
    'notif.channel.bookings': 'Bookings',
    'notif.channel.bookings.description': 'Reminders before a class you booked.',
    'notif.channel.engagement': 'Tips and reminders',
    'notif.channel.engagement.description': 'Now and then, a reminder about your membership and your visits.',

    'permission.rationale.title': 'Why LifePass asks',
    'permission.rationale.camera':
      'LifePass uses the camera to scan check-in codes, and the meal photos and barcodes you choose to log.',
    'permission.rationale.photos': 'LifePass opens a photo only when you pick one, such as a meal to log or a receipt.',
    'permission.rationale.location':
      'LifePass uses your location to show nearby venues on the map, and to suggest places near you when you ask the Coach. The Coach receives only your approximate area.',
    'permission.rationale.microphone': 'LifePass uses your microphone so you can talk to the Coach instead of typing.',
    'permission.rationale.speech': 'LifePass transcribes your speech so you can ask the Coach by voice.',
  },
  is: {
    'notif.channel.health': 'Áætlun og heilsa',
    'notif.channel.health.description': 'Æfingadagar, vikulega yfirferðin og mánaðarleg endurgjöf.',
    'notif.channel.rest_timer': 'Hvíldartími',
    'notif.channel.rest_timer.description': 'Lætur þig vita þegar hvíldinni milli setta er lokið.',
    'notif.channel.bookings': 'Bókanir',
    'notif.channel.bookings.description': 'Áminningar áður en tími sem þú bókaðir hefst.',
    'notif.channel.engagement': 'Ábendingar og áminningar',
    'notif.channel.engagement.description': 'Áminning öðru hverju um áskriftina og heimsóknirnar þínar.',

    'permission.rationale.title': 'Af hverju LifePass spyr',
    'permission.rationale.camera':
      'LifePass notar myndavélina til að skanna innritunarkóða og myndir af máltíðum og strikamerki sem þú velur að skrá.',
    'permission.rationale.photos': 'LifePass opnar aðeins mynd sem þú velur, til dæmis máltíð til að skrá eða kvittun.',
    'permission.rationale.location':
      'LifePass notar staðsetninguna þína til að sýna staði í nágrenninu á kortinu og til að stinga upp á stöðum nálægt þér þegar þú spyrð Ráðgjafann. Ráðgjafinn fær aðeins áætlaða staðsetningu.',
    'permission.rationale.microphone': 'LifePass notar hljóðnemann svo þú getir talað við Ráðgjafann í stað þess að skrifa.',
    'permission.rationale.speech': 'LifePass breytir tali þínu í texta svo þú getir spurt Ráðgjafann með röddinni.',
  },
});
