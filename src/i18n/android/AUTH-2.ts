// Android-only copy for AUTH-2: Continue with Google and Apple (Supabase OAuth web flow).
//
// Owned by AUTH-2 (plan 3.0.3). Only words iOS never says go here; every
// iOS string comes from the generated tables through t()/tp(). The rules for
// a pack are in ./pack.ts.
//
// iOS never shows Google without Apple (App Review 4.8), so it has a terms
// line for both (`auth.social_terms`) and for Apple alone
// (`auth.social_terms_apple`), but none for Google alone. Android shows each
// provider the server has on (owner decision D1 (a)), so Google alone needs
// its own line, worded exactly like iOS's two.
import { definePack } from './pack';

export default definePack({
  en: {
    'auth.social_terms_google':
      'By continuing with Google you agree to the LifePass [Terms]({terms}) and [Privacy Policy]({privacy}).',
  },
  is: {
    'auth.social_terms_google':
      'Með því að halda áfram með Google samþykkir þú [skilmála]({terms}) og [persónuverndarstefnu]({privacy}) LifePass.',
  },
});
