/**
 * The Kenni sheet's round trip (Icelandic eID, rafræn skilríki), against the
 * stub server, with a stand-in for the Custom Tab: the port of iOS
 * KenniVerificationTests, case for case (16), plus the Android-only cases
 * (the tab's own endings, the redirect parsing, a resume after process death).
 *
 * Every way the round trip can end without a verification says why, in the
 * web's words: a kennitala already on another account (`409
 * kennitala_already_linked`; an older server's unhandled `500` for the same
 * thing), an expired state, Kenni's own `?error=` on the redirect, and the
 * member closing the tab. None of them silently leaves the member on the same
 * screen with nothing said.
 */
import { api, Reply, type StubReply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { lookup } from '../../../i18n';
import {
  callbackQueryItems,
  failureFromAuthentication,
  failureMessageKey,
  failureOffersSignInOther,
  failureOffersSupport,
  KENNI_FAILURES,
  KenniVerificationModel,
  type KenniFailure,
} from '../model';
import { decodeCompleteResponse, decodeStartResponse } from '../service';
import { KenniWebAuthError } from '../webAuth';

stubApiClientPerTest();

const AUTHORIZATION_URL = 'https://idp.kenni.is/sporta/oidc/auth?client_id=x';
const GOOD_CALLBACK = 'lifepass://kenni-callback?code=the-code&state=the-state';
const VERIFIED = { verified: true, kennitalaVerified: true, claims: 0 };

let verifiedCalls = 0;
let authenticateCalls = 0;

beforeEach(() => {
  verifiedCalls = 0;
  authenticateCalls = 0;
});

/** Start answers with an authorization URL (unless told otherwise); complete answers `complete`. */
function answer({ start, complete }: { start?: StubReply; complete: StubReply }) {
  api.on('POST', '/auth/kenni/start', start ?? Reply.ok({ alreadyVerified: false, authorizationUrl: AUTHORIZATION_URL }));
  api.on('POST', '/auth/kenni/complete', complete);
}

function makeModel(browser: (url: string) => string | Promise<string> = () => GOOD_CALLBACK) {
  return new KenniVerificationModel({
    authenticate: async (url) => {
      authenticateCalls += 1;
      return browser(url);
    },
    onVerified: () => {
      verifiedCalls += 1;
    },
  });
}

const starts = () => api.sentAll('/auth/kenni/start', 'POST');
const completions = () => api.sentAll('/auth/kenni/complete', 'POST');
const cancelledTab = () => {
  throw new KenniWebAuthError('cancelled');
};

describe('a kennitala already on another account', () => {
  // The 409: said in so many words, no "Try again" (the same eID gives the
  // same kennitala), support and sign out offered, and complete called
  // exactly once (the state is spent, nothing to retry).
  it('a 409 kennitala_already_linked says the kennitala is on another account', async () => {
    answer({ complete: Reply.problem(409, 'kennitala_already_linked') });
    const model = makeModel();
    await model.start();

    expect(model.failure).toBe('alreadyLinked');
    expect(model.phase).toBe('idle');
    expect(verifiedCalls).toBe(0);
    expect(model.offersVerifyButton).toBe(false);
    expect(failureOffersSupport(model.failure!)).toBe(true);
    expect(failureOffersSignInOther(model.failure!)).toBe(true);
    expect(completions()).toHaveLength(1);
    expect(completions()[0].body).toEqual({ code: 'the-code', state: 'the-state' });
    expect(authenticateCalls).toBe(1);
  });

  // An older server answers the same conflict with an unhandled 500: it reads
  // as "maybe your kennitala is on another account, or try again", never as
  // a bare server error, and keeps Try again (it may be a real outage).
  it("an older server's unhandled 500 names the linked case too", async () => {
    answer({ complete: Reply.problem(500, 'internal_error') });
    const model = makeModel();
    await model.start();

    expect(model.failure).toBe('serverError');
    expect(model.offersVerifyButton).toBe(true);
    expect(model.isRetry).toBe(true);
    expect(failureOffersSupport(model.failure!)).toBe(true);
    expect(failureOffersSignInOther(model.failure!)).toBe(true);
    expect(completions()).toHaveLength(1);

    const en = lookup(failureMessageKey('serverError'), 'en');
    const is = lookup(failureMessageKey('serverError'), 'is');
    expect(en).toContain('already linked to another LifePass account');
    expect(en).toContain('support@lifepass.is');
    expect(is).toContain('þegar tengd öðrum LifePass-aðgangi');
    expect(is).toContain('support@lifepass.is');
  });

  it('any server failure on complete reads the same, even an HTML page', async () => {
    answer({ complete: Reply.raw(502, '<html>Bad gateway</html>') });
    const model = makeModel();
    await model.start();
    expect(model.failure).toBe('serverError');
  });
});

describe('cancelled', () => {
  // The member closes the eID tab: "You cancelled the eID check", with Try
  // again, and complete is never called. It used to say nothing.
  it('closing the eID tab says it was cancelled and offers a retry', async () => {
    answer({ complete: Reply.ok(VERIFIED) });
    const model = makeModel(cancelledTab);
    await model.start();

    expect(model.failure).toBe('cancelled');
    expect(model.isRetry).toBe(true);
    expect(model.offersVerifyButton).toBe(true);
    expect(failureOffersSupport(model.failure!)).toBe(false);
    expect(failureOffersSignInOther(model.failure!)).toBe(false);
    expect(completions()).toHaveLength(0);
    expect(verifiedCalls).toBe(0);
  });

  // Cancelling inside Kenni comes back on the redirect as
  // `?error=access_denied`: the same "cancelled", and complete is never
  // called with it.
  it("Kenni's access_denied on the redirect is a cancel", async () => {
    answer({ complete: Reply.ok(VERIFIED) });
    const model = makeModel(() => 'lifepass://kenni-callback?error=access_denied&state=the-state');
    await model.start();
    expect(model.failure).toBe('cancelled');
    expect(completions()).toHaveLength(0);
  });

  it('a retry after a cancel starts over and can verify', async () => {
    answer({ complete: Reply.ok(VERIFIED) });
    let cancelFirst = true;
    const model = makeModel(() => {
      if (cancelFirst) {
        cancelFirst = false;
        throw new KenniWebAuthError('cancelled');
      }
      return GOOD_CALLBACK;
    });
    await model.start();
    expect(model.failure).toBe('cancelled');

    await model.start();
    expect(model.failure).toBeNull();
    expect(model.phase).toBe('verified');
    expect(verifiedCalls).toBe(1);
    expect(starts()).toHaveLength(2);
    expect(completions()).toHaveLength(1);
  });
});

describe('other ways it ends', () => {
  it('an expired state says it took too long', async () => {
    answer({ complete: Reply.problem(410, 'kenni_state_expired') });
    const model = makeModel();
    await model.start();
    expect(model.failure).toBe('expired');
    expect(model.isRetry).toBe(true);
  });

  // Other refusals of complete, and a redirect Kenni sent with another error
  // or without its code, are "couldn't finish", with Try again.
  it.each([
    [410, 'kenni_state_already_failed'],
    [404, 'kenni_state_unknown'],
    [403, 'kenni_state_profile_mismatch'],
    [400, 'invalid-kenni-completion'],
  ])('a %i %s could not finish', async (status, slug) => {
    answer({ complete: Reply.problem(status, slug) });
    const model = makeModel();
    await model.start();
    expect(model.failure).toBe('failed');
    expect(model.isRetry).toBe(true);
  });

  it.each([
    'lifepass://kenni-callback?error=server_error&state=s',
    'lifepass://kenni-callback?state=s',
    'lifepass://kenni-callback?code=c',
    'lifepass://kenni-callback?code=&state=s',
  ])('the redirect %s could not finish and is never completed', async (callback) => {
    answer({ complete: Reply.ok(VERIFIED) });
    const model = makeModel(() => callback);
    await model.start();
    expect(model.failure).toBe('failed');
    expect(completions()).toHaveLength(0);
  });

  it('a completion that is not verified is not a success', async () => {
    answer({ complete: Reply.ok({ verified: false }) });
    const model = makeModel();
    await model.start();
    expect(model.failure).toBe('failed');
    expect(verifiedCalls).toBe(0);
  });

  it('no connection says so, at complete and at start (where the tab never opens)', async () => {
    answer({ complete: Reply.fail() });
    const model = makeModel();
    await model.start();
    expect(model.failure).toBe('offline');
    expect(authenticateCalls).toBe(1);

    answer({ start: Reply.fail(), complete: Reply.problem(500, 'internal_error') });
    const early = makeModel();
    await early.start();
    expect(early.failure).toBe('offline');
    expect(authenticateCalls).toBe(1);
  });

  // A refused start, or a tab that cannot be shown, is "We couldn't start the
  // eID check", not a kennitala conflict: nothing was checked yet, so no
  // support or sign-in-other buttons, just Try again.
  it('a start that fails is not a conflict', async () => {
    answer({ start: Reply.problem(500, 'internal_error'), complete: Reply.problem(500, 'internal_error') });
    const model = makeModel();
    await model.start();
    expect(model.failure).toBe('couldNotStart');
    expect(authenticateCalls).toBe(0);
    expect(model.isRetry).toBe(true);
    expect(failureOffersSupport(model.failure!)).toBe(false);
    expect(failureOffersSignInOther(model.failure!)).toBe(false);

    answer({ complete: Reply.problem(500, 'internal_error') });
    const tabless = makeModel(() => {
      throw new KenniWebAuthError('couldNotStart');
    });
    await tabless.start();
    expect(tabless.failure).toBe('couldNotStart');
  });
});

describe('success', () => {
  it('a verification completes and reloads the profile', async () => {
    answer({ complete: Reply.ok(VERIFIED) });
    const model = makeModel();
    await model.start();
    expect(model.phase).toBe('verified');
    expect(model.failure).toBeNull();
    expect(verifiedCalls).toBe(1);
  });

  it('an already verified profile never opens the browser', async () => {
    answer({ start: Reply.ok({ alreadyVerified: true }), complete: Reply.problem(500, 'internal_error') });
    const model = makeModel();
    await model.start();
    expect(model.phase).toBe('verified');
    expect(authenticateCalls).toBe(0);
    expect(completions()).toHaveLength(0);
    expect(verifiedCalls).toBe(1);
  });
});

describe('the words', () => {
  // The sentences are the web's eID step's (`plans-copy.ts`, `eid`), word for
  // word, in both languages.
  it("the sentences are the web's words", () => {
    const expected: [KenniFailure, string, string][] = [
      [
        'alreadyLinked',
        'You already have a LifePass account. Sign in with the email you used before. If you chose Hide My Email with Apple, use your original email instead. Need help? Contact support@lifepass.is.',
        'Þú ert nú þegar með LifePass-aðgang. Skráðu þig inn með netfanginu sem þú notaðir áður. Ef þú valdir „Fela netfang“ hjá Apple skaltu nota upprunalega netfangið. Þarftu aðstoð? Hafðu samband við support@lifepass.is.',
      ],
      [
        'cancelled',
        'You cancelled the eID check, so nothing was verified. A membership needs a verified kennitala.',
        'Þú hættir við auðkenninguna og því var ekkert staðfest. Áskrift krefst staðfestrar kennitölu.',
      ],
      [
        'expired',
        'The eID check took too long and expired. Try again; it takes about a minute.',
        'Auðkenningin tók of langan tíma og rann út. Reyndu aftur; það tekur um mínútu.',
      ],
      [
        'failed',
        "We couldn't finish the eID check, and nothing was charged. Try again, or choose a visitor pass, which doesn't need eID.",
        'Ekki tókst að ljúka auðkenningunni og ekkert var gjaldfært. Reyndu aftur eða veldu gestapassa, sem þarf ekki rafræn skilríki.',
      ],
    ];
    for (const [failure, en, is] of expected) {
      expect(lookup(failureMessageKey(failure), 'en')).toBe(en);
      expect(lookup(failureMessageKey(failure), 'is')).toBe(is);
    }
  });

  it('every failure has its own sentence in both languages, translated', () => {
    const keys = KENNI_FAILURES.map(failureMessageKey);
    expect(new Set(keys).size).toBe(KENNI_FAILURES.length);
    for (const key of keys) {
      const en = lookup(key, 'en');
      const is = lookup(key, 'is');
      // `lookup` falls back to the key itself when a table lacks it.
      expect(en).not.toBe(key);
      expect(is).not.toBe(key);
      expect(en).not.toBe(is);
    }
  });
});

describe('what verifying stores (GDPR Art. 13)', () => {
  // The note is on the sheet before the member starts the eID check, and
  // before every retry; not once the kennitala is verified, and not for one
  // already on another account, where there is nothing to start.
  it('the data note is shown before every start', async () => {
    const fresh = makeModel();
    expect(fresh.showsDataNote).toBe(true);

    answer({ complete: Reply.problem(410, 'kenni_state_expired') });
    const expired = makeModel();
    await expired.start();
    expect(expired.failure).toBe('expired');
    expect(expired.offersVerifyButton).toBe(true);
    expect(expired.showsDataNote).toBe(true);

    const cancelled = makeModel(cancelledTab);
    await cancelled.start();
    expect(cancelled.failure).toBe('cancelled');
    expect(cancelled.showsDataNote).toBe(true);

    answer({ complete: Reply.problem(409, 'kennitala_already_linked') });
    const linked = makeModel();
    await linked.start();
    expect(linked.failure).toBe('alreadyLinked');
    expect(linked.showsDataNote).toBe(false);

    answer({ complete: Reply.ok(VERIFIED) });
    const verified = makeModel();
    await verified.start();
    expect(verified.phase).toBe('verified');
    expect(verified.showsDataNote).toBe(false);
  });
});

describe('Android only', () => {
  it('sends exactly the native start body, and the code and state the redirect carried', async () => {
    answer({ complete: Reply.ok(VERIFIED) });
    await makeModel(() => 'lifepass://kenni-callback?state=st%2Fate&code=c%3D1').start();
    expect(api.sent('/auth/kenni/start', 'POST').body).toEqual({ platform: 'native' });
    expect(api.sent('/auth/kenni/complete', 'POST').body).toEqual({ code: 'c=1', state: 'st/ate' });
  });

  it('opens the authorization URL the server gave', async () => {
    answer({ complete: Reply.ok(VERIFIED) });
    const opened: string[] = [];
    await makeModel((url) => {
      opened.push(url);
      return GOOD_CALLBACK;
    }).start();
    expect(opened).toEqual([AUTHORIZATION_URL]);
  });

  it('a start without a usable authorization URL could not start, and opens nothing', async () => {
    for (const body of [{ alreadyVerified: false }, { alreadyVerified: false, authorizationUrl: '' }]) {
      answer({ start: Reply.ok(body), complete: Reply.ok(VERIFIED) });
      const model = makeModel();
      await model.start();
      expect(model.failure).toBe('couldNotStart');
    }
    expect(authenticateCalls).toBe(0);
  });

  it('a start body that does not decode could not start', async () => {
    answer({ start: Reply.ok({ authorizationUrl: AUTHORIZATION_URL }), complete: Reply.ok(VERIFIED) });
    const model = makeModel();
    await model.start();
    expect(model.failure).toBe('couldNotStart');
    expect(authenticateCalls).toBe(0);
  });

  it('a completion body that does not decode could not finish', async () => {
    answer({ complete: Reply.ok({ verified: 'yes' }) });
    const model = makeModel();
    await model.start();
    expect(model.failure).toBe('failed');
  });

  it('only kennitalaVerified, else verified, decides', () => {
    expect(decodeCompleteResponse({ kennitalaVerified: true })).toEqual({ kennitalaVerified: true, verified: undefined });
    expect(decodeStartResponse({ alreadyVerified: true })).toEqual({ alreadyVerified: true, authorizationUrl: undefined });
    expect(() => decodeStartResponse({})).toThrow();
    expect(() => decodeStartResponse([])).toThrow();
  });

  it('a second tap while working starts nothing more', async () => {
    answer({ complete: Reply.ok(VERIFIED) });
    const model = makeModel();
    await Promise.all([model.start(), model.start()]);
    expect(starts()).toHaveLength(1);
    expect(model.phase).toBe('verified');
  });

  it('says working while the round trip runs, and tells its subscribers each change', async () => {
    answer({ complete: Reply.ok(VERIFIED) });
    let release: (url: string) => void = () => undefined;
    const model = makeModel(() => new Promise<string>((resolve) => (release = resolve)));
    const phases: string[] = [];
    const unsubscribe = model.subscribe(() => phases.push(model.getState().phase));
    const running = model.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(model.phase).toBe('working');
    release(GOOD_CALLBACK);
    await running;
    unsubscribe();
    expect(phases).toEqual(['working', 'verified']);
  });

  it("the tab's own endings: closed is a cancel, unopenable could not start, anything else failed", () => {
    expect(failureFromAuthentication(new KenniWebAuthError('cancelled'))).toBe('cancelled');
    expect(failureFromAuthentication(new KenniWebAuthError('couldNotStart'))).toBe('couldNotStart');
    expect(failureFromAuthentication(new Error('boom'))).toBe('failed');
  });

  it('reads the query of the redirect only, never its fragment, and keeps a plus', () => {
    expect(callbackQueryItems('lifepass://kenni-callback?code=a+b&state=s#code=x')).toEqual([
      { name: 'code', value: 'a+b' },
      { name: 'state', value: 's' },
    ]);
    expect(callbackQueryItems('lifepass://kenni-callback')).toEqual([]);
    expect(callbackQueryItems('lifepass://kenni-callback?code=%E0%A4%A')).toEqual([{ name: 'code', value: '%E0%A4%A' }]);
  });

  it('a redirect that arrives after Android stopped the app completes with what it carries', async () => {
    api.on('POST', '/auth/kenni/complete', Reply.ok(VERIFIED));
    const model = makeModel();
    await model.resume(GOOD_CALLBACK);
    expect(model.phase).toBe('verified');
    expect(verifiedCalls).toBe(1);
    expect(starts()).toHaveLength(0);
    expect(authenticateCalls).toBe(0);
    expect(completions()[0].body).toEqual({ code: 'the-code', state: 'the-state' });

    api.on('POST', '/auth/kenni/complete', Reply.problem(403, 'kenni_state_profile_mismatch'));
    const foreign = makeModel();
    await foreign.resume(GOOD_CALLBACK);
    expect(foreign.failure).toBe('failed');

    const denied = makeModel();
    await denied.resume('lifepass://kenni-callback?error=access_denied');
    expect(denied.failure).toBe('cancelled');
  });

  it('records the round trip just before the tab opens, and spends it at the completion, however it came', async () => {
    const events: string[] = [];
    const roundTrip = {
      begin: async () => void events.push('begin'),
      spend: async () => void events.push('spend'),
    };
    const make = () =>
      new KenniVerificationModel({
        authenticate: async () => {
          events.push('tab');
          return GOOD_CALLBACK;
        },
        onVerified: () => undefined,
        roundTrip,
      });

    answer({ complete: Reply.ok(VERIFIED) });
    await make().start();
    expect(events).toEqual(['begin', 'tab', 'spend']);

    events.length = 0;
    await make().resume(GOOD_CALLBACK);
    expect(events).toEqual(['spend']);

    // Already verified: no tab, nothing recorded.
    events.length = 0;
    answer({ start: Reply.ok({ alreadyVerified: true }), complete: Reply.ok(VERIFIED) });
    await make().start();
    expect(events).toEqual([]);
  });

  it('a tab that ends after its sheet has gone hands the redirect on instead of completing it unseen', async () => {
    answer({ complete: Reply.ok(VERIFIED) });
    let release: (url: string) => void = () => undefined;
    const handedOn: string[] = [];
    const model = new KenniVerificationModel({
      authenticate: () => new Promise<string>((resolve) => (release = resolve)),
      onVerified: () => {
        verifiedCalls += 1;
      },
      onRedirectWithoutSheet: (url) => handedOn.push(url),
    });
    model.attach();
    const running = model.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    model.detach();
    release(GOOD_CALLBACK);
    await running;
    expect(handedOn).toEqual([GOOD_CALLBACK]);
    expect(completions()).toHaveLength(0);
    expect(verifiedCalls).toBe(0);

    // Shown again before the tab ended: it completes here as usual.
    const shown = makeModel(() => new Promise<string>((resolve) => (release = resolve)));
    const again = shown.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    shown.detach();
    shown.attach();
    release(GOOD_CALLBACK);
    await again;
    expect(shown.phase).toBe('verified');
  });

  it('a profile read that fails after a verification still leaves it verified', async () => {
    answer({ complete: Reply.ok(VERIFIED) });
    const model = new KenniVerificationModel({
      authenticate: async () => GOOD_CALLBACK,
      onVerified: async () => {
        throw new Error('offline');
      },
    });
    await model.start();
    expect(model.phase).toBe('verified');
  });
});
