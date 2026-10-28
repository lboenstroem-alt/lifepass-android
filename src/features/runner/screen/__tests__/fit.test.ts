/**
 * iOS ViewThatFits for the set rows and the rest bar: side by side only when
 * every measured part and the gaps fit; the fallback until everything is
 * measured.
 */
import { fitsInRow } from '../fit';

it('fits when the parts, the fixed widths and the gaps fit', () => {
  const fit = { parts: { dose: 140, kg: 140 } };
  // The one-line row: label 48, spacer 0, check 52; 140 + 140; four gaps of 8: 412.
  expect(fitsInRow(fit, 412, ['dose', 'kg'], { gap: 8, fixed: 100, fixedCount: 3, fallback: false })).toBe(true);
  expect(fitsInRow(fit, 411, ['dose', 'kg'], { gap: 8, fixed: 100, fixedCount: 3, fallback: true })).toBe(false);
  // The stacked rows' controls side by side: 140 + 10 + 140.
  expect(fitsInRow(fit, 290, ['dose', 'kg'], { gap: 10, fallback: false })).toBe(true);
  expect(fitsInRow(fit, 289, ['dose', 'kg'], { gap: 10, fallback: true })).toBe(false);
});

it('answers the fallback until the container and every part are measured', () => {
  expect(fitsInRow({ parts: { dose: 140 } }, 300, ['dose', 'kg'], { gap: 8, fallback: true })).toBe(true);
  expect(fitsInRow({ parts: { dose: 140 } }, 300, ['dose', 'kg'], { gap: 8, fallback: false })).toBe(false);
  expect(fitsInRow({ parts: { dose: 10 } }, 0, ['dose'], { gap: 8, fallback: false })).toBe(false);
});
