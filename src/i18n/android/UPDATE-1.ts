// Android-only copy for UPDATE-1: the update prompt (src/features/appUpdate).
//
// The app asks the server at launch which version it should be on. Below the
// owner's minimum it is blocked behind an Update button; when Google Play has
// a newer version it says so once per new version. The words are the ones the
// server contract recommends for both apps (monorepo docs/05_MOBILE_API.md,
// "App version check"), so iOS and Android say the same thing; only the line
// shown when Google Play cannot be opened is Android's own. The rules for a
// pack are in ./pack.ts.
import { definePack } from './pack';

export default definePack({
  en: {
    // The soft prompt (a dialog): once per new version.
    'appupdate.available.title': 'A new version is available',
    'appupdate.available.body': 'Update LifePass to get the latest fixes and improvements.',
    'appupdate.update': 'Update',
    'appupdate.not_now': 'Not now',
    // The block: this version is below the owner's minimum.
    'appupdate.required.title': 'Please update LifePass',
    'appupdate.required.body': 'This version of LifePass is no longer supported. Update the app to keep booking and checking in.',
    'appupdate.store_failed': "Google Play didn't open. Open Google Play yourself and search for LifePass.",
  },
  is: {
    'appupdate.available.title': 'Ný útgáfa er komin',
    'appupdate.available.body': 'Uppfærðu LifePass til að fá nýjustu lagfæringar og endurbætur.',
    'appupdate.update': 'Uppfæra',
    'appupdate.not_now': 'Ekki núna',
    'appupdate.required.title': 'Vinsamlegast uppfærðu LifePass',
    'appupdate.required.body':
      'Þessi útgáfa af LifePass er ekki lengur studd. Uppfærðu appið til að halda áfram að bóka og innrita þig.',
    'appupdate.store_failed': 'Ekki tókst að opna Google Play. Opnaðu Google Play og leitaðu að LifePass.',
  },
});
