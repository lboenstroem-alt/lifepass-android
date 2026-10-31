/**
 * When a barcode in view counts as read: the barcode half of iOS
 * `ScanCameraController.didRead` and `resumeBarcode`.
 *
 * - The same value in two frames within one second is a real read, not a
 *   smudge half-decoded as the phone moves.
 * - One read at a time: after a read the lock holds until the result sheet
 *   has gone (and then a second, so the same packet still in view is not
 *   read again at once), or until the value could not be used.
 *
 * Pure and clock-injected, so the rule is unit tested.
 */
import { symbologyOf, type BarcodeSymbology } from './normaliser';

/** Two frames of the same value this close together make a read. */
export const BARCODE_CONFIRM_MS = 1000;
/** After the result sheet closes, reading resumes this much later (iOS sleeps one second). */
export const BARCODE_RESUME_DELAY_MS = 1000;

export interface BarcodeRead {
  readonly value: string;
  readonly symbology: BarcodeSymbology;
}

export class BarcodeReadLock {
  private locked = false;
  private candidate: { readonly value: string; readonly at: number } | null = null;

  get isLocked(): boolean {
    return this.locked;
  }

  /**
   * One frame's code (expo-camera `onBarcodeScanned`). Returns the read when
   * this frame confirms it, and locks; null otherwise.
   */
  frame(type: string, value: string, now: number = Date.now()): BarcodeRead | null {
    if (this.locked) return null;
    const symbology = symbologyOf(type);
    if (!symbology || value.length === 0) return null;
    const candidate = this.candidate;
    if (candidate && candidate.value === value && now - candidate.at <= BARCODE_CONFIRM_MS) {
      this.locked = true;
      this.candidate = null;
      return { value, symbology };
    }
    this.candidate = { value, at: now };
    return null;
  }

  /** Hold reads (a typed code is being looked up). */
  lock(): void {
    this.locked = true;
    this.candidate = null;
  }

  /** Read again (iOS `resumeBarcode`). */
  resume(): void {
    this.locked = false;
    this.candidate = null;
  }
}
