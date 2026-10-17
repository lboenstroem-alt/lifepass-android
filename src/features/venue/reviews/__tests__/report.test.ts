/**
 * "Report review" (owner decision D5): the reasons, what the member is told,
 * and one report at a time per review.
 */
import { ProblemError } from '../../../../api';
import { setCurrentLanguage, translate } from '../../../../i18n';
import { REPORT_REASONS } from '../api';
import { reportReasonKey, sendReviewReport } from '../report';

const V = 'aaaaaaaa-0000-4000-8000-000000000001';
const R = 'bbbbbbbb-0000-4000-8000-000000000002';

function deps(send: () => Promise<{ alreadyReported: boolean }>) {
  const toasts: string[] = [];
  const alerts: string[] = [];
  return {
    toasts,
    alerts,
    deps: { send: jest.fn(send), toast: (m: string) => toasts.push(m), alert: (m: string) => alerts.push(m) },
  };
}

it('offers the five reasons the API takes, each worded in both languages', () => {
  expect(REPORT_REASONS).toEqual(['offensive', 'personal_information', 'not_genuine', 'spam', 'other']);
  for (const reason of REPORT_REASONS) {
    const key = reportReasonKey(reason);
    expect(translate(key, 'en')).not.toBe(key);
    expect(translate(key, 'is')).not.toBe(key);
    expect(translate(key, 'is')).not.toBe(translate(key, 'en'));
  }
});

it.each([
  ['en', 'Thanks for telling us. The LifePass team will take a look.'],
  ['is', 'Takk fyrir ábendinguna. LifePass-teymið fer yfir umsögnina.'],
] as const)('thanks the member when the report is sent (%s)', async (lang, text) => {
  setCurrentLanguage(lang);
  const { deps: d, toasts, alerts } = deps(async () => ({ alreadyReported: false }));
  await expect(sendReviewReport(V, R, 'spam', d)).resolves.toBe('sent');
  expect(d.send).toHaveBeenCalledWith(V, R, 'spam');
  expect(toasts).toEqual([text]);
  expect(alerts).toEqual([]);
});

it('says so when the member had already reported it (the server accepts the repeat)', async () => {
  setCurrentLanguage('en');
  const { deps: d, toasts } = deps(async () => ({ alreadyReported: true }));
  await expect(sendReviewReport(V, R, 'offensive', d)).resolves.toBe('already');
  expect(toasts).toEqual(["You've already reported this review. The LifePass team will take a look."]);
});

it('words the own-review refusal, and any other failure as the formatter does', async () => {
  setCurrentLanguage('en');
  const own = new ProblemError(
    { type: 'https://lifepass.is/problems/review_report_own', title: 'x', status: 400, detail: 'Own review.' },
    400,
  );
  const first = deps(async () => Promise.reject(own));
  await expect(sendReviewReport(V, R, 'other', first.deps)).resolves.toBe('failed');
  expect(first.alerts).toEqual(["You can't report your own review."]);

  const server = new ProblemError({ type: 'https://lifepass.is/problems/internal_error', title: 'x', status: 500 }, 500);
  const second = deps(async () => Promise.reject(server));
  await sendReviewReport(V, R, 'other', second.deps);
  expect(second.alerts).toHaveLength(1);
  expect(second.toasts).toEqual([]);
});

it('ignores a second report of the same review while the first is on its way', async () => {
  let release!: () => void;
  const { deps: d } = deps(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ alreadyReported: false });
      }),
  );
  const first = sendReviewReport(V, R, 'spam', d);
  await expect(sendReviewReport(V, R.toUpperCase(), 'spam', d)).resolves.toBe('ignored');
  release();
  await expect(first).resolves.toBe('sent');
  expect(d.send).toHaveBeenCalledTimes(1);
});
