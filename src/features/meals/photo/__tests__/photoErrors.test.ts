/**
 * The photo error cards (iOS MealPhotoError, MealScanCoordinator.photoError
 * and the card's buttons, ios-ux.md 12.4): every problem code to its card
 * and buttons, and the copy in both languages.
 */
import { ProblemError, TransportError, type ApiError } from '../../../../api';
import { translate } from '../../../../i18n';
import {
  photoErrorActionKey,
  photoErrorActions,
  photoErrorCopyKey,
  photoErrorFor,
  photoErrorOutcome,
  showsRetryCost,
  type MealPhotoError,
} from '../photoErrors';

function problem(slug: string, status: number): ApiError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, status }, status);
}

const ALL: readonly MealPhotoError[] = ['tooLarge', 'tooSmall', 'unsupported', 'limit', 'paused', 'upstream', 'deleted', 'offline', 'noFood', 'other'];

describe('which card an OP-32 failure shows', () => {
  it.each([
    [problem('meal_image_too_large', 413), 'tooLarge'],
    [problem('meal_image_unsupported', 415), 'unsupported'],
    [problem('meal-scan-daily-limit', 429), 'limit'],
    [problem('meal_scan_daily_limit', 429), 'limit'],
    [problem('rate_limited', 429), 'limit'],
    [problem('meal_scan_paused', 503), 'paused'],
    [problem('health_meal_deleted', 409), 'deleted'],
    [problem('coach_upstream_error', 502), 'upstream'],
    [problem('internal', 500), 'upstream'],
    [problem('something_else', 400), 'other'],
    [new TransportError('offline'), 'offline'],
    [new TransportError('network'), 'offline'],
    // The 20 s ceiling: the estimate was slow, not the phone.
    [new TransportError('timeout'), 'upstream'],
  ] as const)('%s', (error, expected) => {
    expect(photoErrorFor(error)).toBe(expected);
  });

  // The shared health rules answer these (consent sheet, gate, close).
  it.each([
    problem('no_active_plan_or_pass', 403),
    problem('health_consent_required', 409),
    problem('account_pending_deletion', 409),
    problem('health_minor_blocked', 403),
  ])('leaves %s to the health rules', (error) => {
    expect(photoErrorFor(error)).toBeNull();
  });
});

describe('the cards', () => {
  it('offer the buttons iOS offers, the first one primary', () => {
    expect(photoErrorActions('tooLarge')).toEqual(['retake', 'search']);
    expect(photoErrorActions('deleted')).toEqual(['retake', 'search']);
    expect(photoErrorActions('noFood')).toEqual(['retake', 'search']);
    // Only a picked photo can be this small: another from the library first.
    expect(photoErrorActions('tooSmall')).toEqual(['chooseOther', 'retake']);
    expect(photoErrorActions('unsupported')).toEqual(['chooseOther', 'retake']);
    expect(photoErrorActions('limit')).toEqual(['search', 'barcode']);
    expect(photoErrorActions('paused')).toEqual(['search', 'barcode']);
    expect(photoErrorActions('upstream')).toEqual(['tryAgain', 'search']);
    expect(photoErrorActions('other')).toEqual(['tryAgain', 'search']);
    expect(photoErrorActions('offline')).toEqual(['tryAgain']);
  });

  it('say what a retry costs only after an upstream failure', () => {
    expect(ALL.filter(showsRetryCost)).toEqual(['upstream']);
  });

  it('report a fixed outcome word each', () => {
    expect(ALL.map(photoErrorOutcome)).toEqual([
      'too_large',
      'too_small',
      'unsupported',
      'limit',
      'paused',
      'upstream',
      'deleted',
      'offline',
      'no_food',
      'upstream',
    ]);
  });

  it('have their copy in both languages', () => {
    for (const language of ['en', 'is'] as const) {
      for (const failure of ALL) {
        const key = photoErrorCopyKey(failure);
        expect(translate(key, language)).not.toBe(key);
      }
      for (const action of ['retake', 'search', 'barcode', 'tryAgain', 'chooseOther'] as const) {
        const key = photoErrorActionKey(action);
        expect(translate(key, language)).not.toBe(key);
      }
    }
  });

  // And the member is told the true thing, in both languages (iOS testTheTooSmallPhotoHasItsOwnCopy).
  it('tells a too small photo apart from a too large one', () => {
    expect(photoErrorCopyKey('tooSmall')).toBe('meal.photo.err.too_small');
    expect(photoErrorCopyKey('tooSmall')).not.toBe(photoErrorCopyKey('tooLarge'));
    for (const language of ['en', 'is'] as const) {
      const copy = translate('meal.photo.err.too_small', language);
      expect(copy).not.toBe('');
      expect(copy).not.toBe('meal.photo.err.too_small');
      expect(copy).not.toBe(translate('meal.photo.err.too_large', language));
    }
  });
});
