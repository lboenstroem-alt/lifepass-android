/**
 * Errors in the language on screen: the error half of iOS
 * `AccountLanguageTests` ("every error that did not have its own copy was the
 * server's English sentence"), the iOS `ErrorFormatter` rules, and the
 * legacy gate-refusal shim.
 */
import { AuthApiError, AuthRetryableFetchError, FunctionsHttpError, PostgrestError } from '@supabase/supabase-js';

import { setDev } from '@test/harness';

import { setCurrentLanguage, translate } from '../../i18n';
import {
  DecodingError,
  HttpStatusError,
  LocalizedError,
  NotAuthenticatedError,
  ProblemError,
  problemMessage,
  statusMessageKey,
  TransportError,
  type ProblemDetails,
} from '../errors';
import { errorMessage, ErrorFormatter, refusalMessage, setRefusalLogger } from '../errorFormatter';
import { gateRefusalFor } from '../gateRefusal';

function fixture(status: number, slug: string, detail = 'Server detail.'): ProblemDetails {
  return { type: `https://lifepass.is/problems/${slug}`, title: slug, status, detail };
}

describe('AccountLanguageTests (iOS): errors', () => {
  it('an unmapped problem reads as its status in Icelandic', () => {
    const problem = fixture(409, 'slot_moved');
    expect(problemMessage(problem, 'is')).toBe(translate('error.conflict', 'is'));
    // An English reader still gets the server's own sentence.
    expect(problemMessage(problem, 'en')).toBe('Server detail.');
  });

  it('a known slug has its own copy in both languages', () => {
    const problem = fixture(400, 'booking_time_in_past');
    expect(problemMessage(problem, 'is')).toBe('Þessi tími er liðinn. Veldu síðari tíma.');
    expect(problemMessage(problem, 'en')).toBe('That time has already passed. Pick a later one.');
  });

  it('transport and formatter errors follow the language', () => {
    setCurrentLanguage('is');
    expect(new TransportError('offline').message).toBe('Engin nettenging. Athugaðu tenginguna og reyndu aftur.');
    expect(errorMessage(new TransportError('timeout'))).toBe('Beiðnin rann út á tíma. Reyndu aftur.');
    expect(errorMessage(new Error('x'))).toBe('Eitthvað fór úrskeiðis. Reyndu aftur.');
    setCurrentLanguage('en');
    expect(errorMessage(new Error('x'))).toBe('Something went wrong. Please try again.');
  });
});

describe('problem messages', () => {
  it('falls back to the title for an English reader, then the status', () => {
    expect(problemMessage({ type: 'https://lifepass.is/problems/x', title: 'Title only', status: 409 }, 'en')).toBe(
      'Title only',
    );
    expect(problemMessage({ type: 'https://lifepass.is/problems/x', status: 404 }, 'en')).toBe(
      translate('error.not_found', 'en'),
    );
    expect(problemMessage({ type: 'https://lifepass.is/problems/x', status: 418, detail: '' }, 'en')).toBe(
      translate('error.generic', 'en'),
    );
  });

  it('has a sentence for every status bucket', () => {
    expect([400, 401, 403, 404, 409, 422, 429, 500, 503, 418, 0].map(statusMessageKey)).toEqual([
      'error.request_invalid',
      'error.sign_in',
      'error.not_allowed',
      'error.not_found',
      'error.conflict',
      'error.request_invalid',
      'error.rate_limited',
      'error.server',
      'error.server',
      'error.generic',
      'error.generic',
    ]);
  });

  it('reads the message when it is read, in the language then on screen', () => {
    const error = new ProblemError(fixture(400, 'booking_time_in_past'), 400);
    setCurrentLanguage('en');
    expect(error.message).toBe('That time has already passed. Pick a later one.');
    setCurrentLanguage('is');
    expect(error.message).toBe('Þessi tími er liðinn. Veldu síðari tíma.');
    expect(error.messageIn('en')).toBe('That time has already passed. Pick a later one.');
  });

  it('words every other kind of API error', () => {
    setCurrentLanguage('en');
    expect(new HttpStatusError(504, '<html>').message).toBe(
      translate('error.unexpected_status', 'en', { code: 504 }),
    );
    expect(new DecodingError('{}').message).toBe(translate('error.decoding', 'en'));
    expect(new NotAuthenticatedError().message).toBe(translate('error.sign_in', 'en'));
    expect(new TransportError('network').message).toBe(translate('error.network', 'en'));
    expect(new TransportError('cancelled').message).toBe(translate('error.cancelled', 'en'));
  });
});

describe('ErrorFormatter.message', () => {
  beforeEach(() => setCurrentLanguage('en'));

  it("shows the app's own errors", () => {
    expect(errorMessage(new LocalizedError('Already in the right words.'))).toBe('Already in the right words.');
    expect(ErrorFormatter.message(new NotAuthenticatedError())).toBe(translate('error.sign_in', 'en'));
  });

  it('never shows a developer message or an SDK body', () => {
    expect(errorMessage(new Error('Cannot read properties of undefined'))).toBe(translate('error.generic', 'en'));
    expect(errorMessage('a string')).toBe(translate('error.generic', 'en'));
    expect(errorMessage(null)).toBe(translate('error.generic', 'en'));
    expect(errorMessage({ message: 'relation "bookings" does not exist', code: '42P01' })).toBe(
      translate('error.generic', 'en'),
    );
    expect(
      errorMessage(new PostgrestError({ message: 'permission denied for table x', details: '', hint: '', code: '42501' })),
    ).toBe(translate('error.generic', 'en'));
  });

  it('keeps an Edge Function body out of a release build', () => {
    const fnError = new FunctionsHttpError({ status: 409 });
    setDev(false);
    expect(errorMessage(fnError)).toBe(translate('error.generic', 'en'));
    expect(refusalMessage(fnError)).toBe(translate('error.generic', 'en'));
    setDev(true);
    expect(errorMessage(fnError)).toMatch(/^Debug: /);
  });

  it("shows Supabase Auth's own sentences, and its outages as network errors", () => {
    expect(errorMessage(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'))).toBe(
      'Invalid login credentials',
    );
    expect(errorMessage(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(translate('error.network', 'en'));
    expect(errorMessage(new AuthRetryableFetchError('Bad gateway', 502))).toBe(translate('error.server', 'en'));
  });

  it('reads a raw fetch failure by its kind', () => {
    expect(errorMessage(new TypeError('Network request failed'))).toBe(translate('error.network', 'en'));
    expect(errorMessage(new TypeError('Network request timed out'))).toBe(translate('error.timeout', 'en'));
    const aborted = new Error('Aborted');
    aborted.name = 'AbortError';
    expect(errorMessage(aborted)).toBe(translate('error.cancelled', 'en'));
  });
});

describe('the refusal log', () => {
  afterEach(() => setRefusalLogger(null));

  it("keeps the server's words in the log, off the screen", () => {
    const lines: string[] = [];
    setRefusalLogger((line) => lines.push(line));
    const error = new ProblemError(
      { ...fixture(403, 'trial_venue_not_included', 'Internal: trial rule 7'), errors: [{ field: 'requestId', message: 'req-1' }] },
      403,
    );
    expect(refusalMessage(error)).toBe(translate('refusal.trial_venue', 'en'));
    refusalMessage(new HttpStatusError(504, '<html>'));
    expect(lines).toEqual([
      'refusal trial_venue_not_included 403 reason=- shown=refusal.trial_venue requestId=req-1 detail=Internal: trial rule 7',
      'refusal unexpected status 504',
    ]);
  });
});

describe('the legacy gate-refusal shim', () => {
  it('answers from the table, in the language on screen', () => {
    setCurrentLanguage('is');
    expect(gateRefusalFor('no_active_plan_or_pass')).toEqual({
      title: translate('booking.err.title', 'is'),
      message: translate('booking.err.no_plan', 'is'),
      needsMembership: true,
      cta: 'seePlans',
    });
    expect(gateRefusalFor('slot-already-booked')).toMatchObject({ needsMembership: false, cta: 'myBookings' });
    expect(gateRefusalFor('slot_unavailable', 'class_full')?.message).toBe(translate('booking.class.err_full', 'is'));
  });

  it('is null for anything that does not block at the preview', () => {
    for (const code of [undefined, '', 'rate_limited', 'card_declined', 'brand_new_refusal', 'invalid_booking_create']) {
      expect(gateRefusalFor(code)).toBeNull();
    }
  });
});
