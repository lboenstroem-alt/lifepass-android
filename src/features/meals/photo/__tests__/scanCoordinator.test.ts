/**
 * The scan request, which can outlive the page (iOS MealScanCoordinator):
 * the body OP-32 gets, the one 768 px retry with the same key after a 413,
 * the 60 s cancel window that deletes a late draft, Keep going's toasts,
 * and that nothing of a member's scans outlives a sign-out.
 */
import { ProblemError, TransportError, type ApiError } from '../../../../api';
import { runSignOutCleaners } from '../../../../app/signOut';
import { resetHealthStoreForTests, useHealthStore } from '../../../../health/store';
import { runHealthWipeHooks } from '../../../../health/wipe';
import { setAnalyticsObserver } from '../../../../lib/analytics';
import { resetIntentStoreForTests, useIntentStore } from '../../../../stores/intentStore';
import { setMealApi, type MealApi } from '../../api/mealApi';
import { fakeMealApi } from '../../api/testing';
import { showMealToast } from '../../capture/saveFeedback';
import { base64FromBytes, bytesFromBase64 } from '../../imageEncoder/base64';
import { jpegDataUri, type EncodedMealImage, type LoadedMealImage } from '../../imageEncoder/encoder';
import type { Rect, Size } from '../../imageEncoder/cropMath';
import { cameraJpeg, FakePipeline, frameSize } from '../../imageEncoder/__tests__/fakePipeline';
import { mealRecord, photoItemJson } from '../../itemEditor/__tests__/fixtures';
import { draftThumbnail, forgetAllDraftThumbnails } from '../../mealEditor/draftThumbnails';
import type { MealScanBody, MealScanResult } from '../../types/models';
import {
  cancelMealScan,
  keepGoingWithScan,
  noteScansLeft,
  resetMealScanCoordinator,
  scanMealPhoto,
  scansLeftToday,
  SCAN_CANCEL_WINDOW_MS,
  SCAN_READY_TOAST_MS,
  setScanPipelineForTests,
} from '../scanCoordinator';

jest.mock('../../capture/saveFeedback', () => ({
  ...jest.requireActual('../../capture/saveFeedback'),
  showMealToast: jest.fn(),
}));

const toast = showMealToast as jest.MockedFunction<typeof showMealToast>;

const DATE = '2026-10-21';
const draft = () => mealRecord({ id: 'draft-1', items: [photoItemJson()], confirmed: false, source: 'photo' });

function photo(width = 1024, height = 768): EncodedMealImage {
  const base64 = base64FromBytes(cameraJpeg({ width, height }));
  return { base64, byteLength: 1000, pixelWidth: width, pixelHeight: height };
}

function answer(overrides: Partial<MealScanResult> = {}): MealScanResult {
  return { meal: draft(), noFood: false, needsConfirm: true, scansLeftToday: 2, replayed: false, ...overrides };
}

function problem(slug: string, status: number): ApiError {
  return new ProblemError({ type: `https://lifepass.is/problems/${slug}`, status }, status);
}

/** A scan that answers when the test says so. */
function heldScan() {
  let release: (value: MealScanResult) => void = () => undefined;
  const scan = jest.fn(
    () =>
      new Promise<MealScanResult>((resolve) => {
        release = resolve;
      }),
  );
  return { scan, answerWith: (value: MealScanResult) => release(value) };
}

/** A pipeline whose drawing of the draft's picture waits for the test (a native round trip on the phone). */
class HeldThumbnailPipeline extends FakePipeline {
  rendering = false;
  private finish: () => void = () => undefined;

  override async render(image: LoadedMealImage, crop: Rect | null, size: Size, quality: number): Promise<string> {
    this.rendering = true;
    await new Promise<void>((resolve) => {
      this.finish = resolve;
    });
    return super.render(image, crop, size, quality);
  }

  done(): void {
    this.finish();
  }
}

/** Lets pending promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

let events: [string, Record<string, unknown>][] = [];

function install(api: Partial<MealApi>): void {
  setMealApi(fakeMealApi(api));
}

beforeEach(() => {
  resetMealScanCoordinator();
  resetHealthStoreForTests();
  resetIntentStoreForTests();
  forgetAllDraftThumbnails();
  toast.mockClear();
  events = [];
  setAnalyticsObserver((event, params) => events.push([event, { ...params }]));
  setScanPipelineForTests(new FakePipeline());
});

afterEach(() => {
  setMealApi(null);
  setAnalyticsObserver(null);
  setScanPipelineForTests(null);
  jest.useRealTimers();
});

describe('the request', () => {
  it('sends the stripped JPEG, the slot, the day and when, with the key it was given', async () => {
    const scan = jest.fn(async (_body: MealScanBody, _key: string) => answer());
    install({ scan });
    const sent = photo();
    const outcome = await scanMealPhoto(sent, 'lunch', DATE, 'key-1');
    expect(outcome.kind).toBe('draft');
    const [body, key] = scan.mock.calls[0]!;
    expect(key).toBe('key-1');
    expect(body.image).toEqual({ mediaType: 'image/jpeg', dataBase64: sent.base64 });
    expect(body.slot).toBe('lunch');
    expect(body.logDate).toBe(DATE);
    expect(body.loggedAt).toBeInstanceOf(Date);
    // The answer's count is the newest.
    expect(scansLeftToday()).toBe(2);
  });

  it('keeps only a 512 px picture of the draft, in memory, under the draft id', async () => {
    const pipeline = new FakePipeline();
    setScanPipelineForTests(pipeline);
    install({ scan: async () => answer() });
    const sent = photo(1024, 768);
    await scanMealPhoto(sent, 'dinner', DATE, 'key-1');
    // Redrawn from the JPEG that was sent (iOS MealImageEncoder.thumbnail, maxPixel 512).
    expect(pipeline.loads).toEqual([{ kind: 'uri', uri: jpegDataUri(sent.base64) }]);
    expect(pipeline.renders).toEqual([{ crop: null, size: { width: 512, height: 384 }, quality: 0.8 }]);
    expect(pipeline.released).toBe(1);
    const thumbnail = draftThumbnail('draft-1');
    expect(thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    expect(frameSize(bytesFromBase64(thumbnail!.slice('data:image/jpeg;base64,'.length)))).toEqual({ width: 512, height: 384 });
  });

  it('keeps the sent JPEG when the phone cannot redraw it', async () => {
    const pipeline = new FakePipeline();
    pipeline.load = async () => {
      throw new Error('no decoder');
    };
    setScanPipelineForTests(pipeline);
    install({ scan: async () => answer() });
    const sent = photo();
    expect((await scanMealPhoto(sent, 'dinner', DATE, 'key-1')).kind).toBe('draft');
    expect(draftThumbnail('draft-1')).toBe(jpegDataUri(sent.base64));
  });

  it('reads no food as the no food card', async () => {
    install({ scan: async () => answer({ meal: null, noFood: true }) });
    expect(await scanMealPhoto(photo(), 'lunch', DATE, 'k')).toEqual({ kind: 'failed', failure: 'noFood' });
    install({ scan: async () => answer({ meal: null, noFood: false }) });
    expect(await scanMealPhoto(photo(), 'lunch', DATE, 'k')).toEqual({ kind: 'failed', failure: 'noFood' });
  });

  it('never retries by itself', async () => {
    const scan = jest.fn(async (): Promise<MealScanResult> => {
      throw problem('coach_upstream_error', 502);
    });
    install({ scan });
    expect(await scanMealPhoto(photo(), 'lunch', DATE, 'k')).toEqual({ kind: 'failed', failure: 'upstream' });
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('retries ONCE at 768 px with the same key after a 413', async () => {
    const scan = jest.fn(async (_body: MealScanBody, _key: string): Promise<MealScanResult> => {
      if (scan.mock.calls.length === 1) throw problem('meal_image_too_large', 413);
      return answer();
    });
    install({ scan });
    const outcome = await scanMealPhoto(photo(1024, 768), 'lunch', DATE, 'key-413');
    expect(outcome.kind).toBe('draft');
    expect(scan).toHaveBeenCalledTimes(2);
    expect(scan.mock.calls.map((call) => call[1])).toEqual(['key-413', 'key-413']);
    expect(scan.mock.calls[1]![0].image.dataBase64).not.toBe(scan.mock.calls[0]![0].image.dataBase64);
  });

  it('shows too large when the smaller one is refused too', async () => {
    const scan = jest.fn(async (): Promise<MealScanResult> => {
      throw problem('meal_image_too_large', 413);
    });
    install({ scan });
    expect(await scanMealPhoto(photo(), 'lunch', DATE, 'k')).toEqual({ kind: 'failed', failure: 'tooLarge' });
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('hands a refusal the health rules answer back to the page', async () => {
    const refusal = problem('health_consent_required', 409);
    install({
      scan: async () => {
        throw refusal;
      },
    });
    expect(await scanMealPhoto(photo(), 'lunch', DATE, 'k')).toEqual({ kind: 'refused', error: refusal });
  });
});

describe('cancel', () => {
  it('deletes a draft that still arrives, quietly', async () => {
    let release: () => void = () => undefined;
    const scan = jest.fn(
      () =>
        new Promise<MealScanResult>((resolve) => {
          release = () => resolve(answer());
        }),
    );
    const deleteMeal = jest.fn(async () => undefined);
    install({ scan, deleteMeal });
    const pending = scanMealPhoto(photo(), 'lunch', DATE, 'key-c');
    cancelMealScan('key-c');
    release();
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(deleteMeal).toHaveBeenCalledWith('draft-1');
    expect(draftThumbnail('draft-1')).toBeNull();
  });

  it('turns a failure that arrives after it into nothing', async () => {
    install({
      scan: async () => {
        cancelMealScan('key-f');
        throw new TransportError('offline');
      },
    });
    expect(await scanMealPhoto(photo(), 'lunch', DATE, 'key-f')).toEqual({ kind: 'cancelled' });
  });

  it('still wins when tapped while the draft picture is being made', async () => {
    const pipeline = new HeldThumbnailPipeline();
    setScanPipelineForTests(pipeline);
    const deleteMeal = jest.fn(async () => undefined);
    install({ scan: async () => answer(), deleteMeal });
    const pending = scanMealPhoto(photo(), 'lunch', DATE, 'key-t');
    await settle();
    // The answer is in and the picture is being drawn: the member taps Cancel now.
    expect(pipeline.rendering).toBe(true);
    cancelMealScan('key-t');
    pipeline.done();
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(deleteMeal).toHaveBeenCalledWith('draft-1');
    expect(draftThumbnail('draft-1')).toBeNull();
  });

  it('turns a no food answer that arrives after it into nothing', async () => {
    const { scan, answerWith } = heldScan();
    const deleteMeal = jest.fn(async () => undefined);
    install({ scan, deleteMeal });
    const pending = scanMealPhoto(photo(), 'lunch', DATE, 'key-n');
    cancelMealScan('key-n');
    answerWith(answer({ meal: null, noFood: true, scansLeftToday: 1 }));
    expect(await pending).toEqual({ kind: 'cancelled' });
    // There is no draft to delete; the scan was spent, so the count is still the newest.
    expect(deleteMeal).not.toHaveBeenCalled();
    expect(scansLeftToday()).toBe(1);
    // And the cancel is used up: the same key answering again is not dropped.
    install({ scan: async () => answer({ meal: null, noFood: true }) });
    expect(await scanMealPhoto(photo(), 'lunch', DATE, 'key-n')).toEqual({ kind: 'failed', failure: 'noFood' });
  });

  it('lasts a minute', async () => {
    jest.useFakeTimers();
    const deleteMeal = jest.fn(async () => undefined);
    install({ scan: async () => answer(), deleteMeal });
    cancelMealScan('key-late');
    jest.advanceTimersByTime(SCAN_CANCEL_WINDOW_MS + 1);
    const outcome = await scanMealPhoto(photo(), 'lunch', DATE, 'key-late');
    expect(outcome.kind).toBe('draft');
    expect(deleteMeal).not.toHaveBeenCalled();
  });
});

describe('keep going', () => {
  it('turns a draft into a six-second toast whose Check opens it from Plan', async () => {
    install({ scan: async () => answer() });
    keepGoingWithScan('key-k');
    expect(await scanMealPhoto(photo(), 'lunch', DATE, 'key-k')).toEqual({ kind: 'cancelled' });
    expect(toast).toHaveBeenCalledTimes(1);
    const [message, options] = toast.mock.calls[0]!;
    expect(message).toBe('Your photo estimate is ready to check');
    expect(options?.durationMs).toBe(SCAN_READY_TOAST_MS);
    expect(options?.page).toBeUndefined();
    expect(options?.action?.label).toBe('Check');
    options?.action?.onPress();
    expect(useIntentStore.getState().pendingPlanAction?.action).toEqual({ kind: 'openDraft', mealId: 'draft-1' });
    expect(useIntentStore.getState().pendingTab).toBe('Plan');
    expect(events).toContainEqual(['meal_scan_result', { outcome: 'ok' }]);
    // The draft editor will want its picture.
    expect(draftThumbnail('draft-1')).not.toBeNull();
  });

  it('toasts a failure in its own words', async () => {
    install({
      scan: async () => {
        throw problem('meal_scan_paused', 503);
      },
    });
    keepGoingWithScan('key-p');
    expect(await scanMealPhoto(photo(), 'lunch', DATE, 'key-p')).toEqual({ kind: 'cancelled' });
    expect(toast.mock.calls[0]![0]).toBe('Photo estimates are paused for now. Search or scan a barcode instead.');
    expect(events).toContainEqual(['meal_scan_result', { outcome: 'paused' }]);
  });

  it('leaves a refusal to the health rules, in the background', async () => {
    const handle = jest.fn(() => 'other' as const);
    useHealthStore.setState({ handle });
    const refusal = problem('no_active_plan_or_pass', 403);
    install({
      scan: async () => {
        throw refusal;
      },
    });
    keepGoingWithScan('key-r');
    expect(await scanMealPhoto(photo(), 'lunch', DATE, 'key-r')).toEqual({ kind: 'cancelled' });
    expect(handle).toHaveBeenCalledWith(refusal, { foreground: false });
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('the count and the session', () => {
  it('keeps the newest count, and ignores a missing one', () => {
    noteScansLeft(3);
    noteScansLeft(null);
    noteScansLeft(undefined);
    expect(scansLeftToday()).toBe(3);
  });

  it('drops an answer that arrives after a sign-out: no count, no picture, nothing sent', async () => {
    const { scan, answerWith } = heldScan();
    const deleteMeal = jest.fn(async () => undefined);
    install({ scan, deleteMeal });
    keepGoingWithScan('key-out');
    const pending = scanMealPhoto(photo(), 'lunch', DATE, 'key-out');
    await runSignOutCleaners({ memberId: 'member-1' });
    answerWith(answer({ scansLeftToday: 2 }));
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(scansLeftToday()).toBeNull();
    expect(draftThumbnail('draft-1')).toBeNull();
    expect(deleteMeal).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('drops the draft picture when the health data is wiped while it is drawn', async () => {
    const pipeline = new HeldThumbnailPipeline();
    setScanPipelineForTests(pipeline);
    install({ scan: async () => answer() });
    const pending = scanMealPhoto(photo(), 'lunch', DATE, 'key-w');
    await settle();
    expect(pipeline.rendering).toBe(true);
    await runHealthWipeHooks({ profileId: 'member-1', reason: 'withdrawn' });
    pipeline.done();
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(draftThumbnail('draft-1')).toBeNull();
    expect(scansLeftToday()).toBeNull();
  });

  it('drops a failure that arrives after a sign-out, too', async () => {
    let fail: (error: unknown) => void = () => undefined;
    install({
      scan: () =>
        new Promise<MealScanResult>((_resolve, reject) => {
          fail = reject;
        }),
    });
    keepGoingWithScan('key-fail');
    const pending = scanMealPhoto(photo(), 'lunch', DATE, 'key-fail');
    await runSignOutCleaners({ memberId: 'member-1' });
    fail(problem('meal_scan_paused', 503));
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(toast).not.toHaveBeenCalled();
  });

  it('forgets everything at sign-out, so no toast reaches the next member', async () => {
    noteScansLeft(1);
    keepGoingWithScan('key-s');
    await runSignOutCleaners({ memberId: 'member-1' });
    expect(scansLeftToday()).toBeNull();
    install({ scan: async () => answer() });
    expect((await scanMealPhoto(photo(), 'lunch', DATE, 'key-s')).kind).toBe('draft');
    expect(toast).not.toHaveBeenCalled();
  });
});

// The fixture really is a JPEG the pipeline can read back.
it('uses a photo the fake pipeline reads', () => {
  expect(jpegDataUri(photo().base64).startsWith('data:image/jpeg;base64,/9j/')).toBe(true);
});
