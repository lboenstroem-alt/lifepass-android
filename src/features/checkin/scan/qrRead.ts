/**
 * What one camera read of a QR payload means for the Scan tab: the Android
 * port of iOS `CheckInViewModel.readQR` and `QRRead` (ViewModels/
 * CheckInViewModel.swift, `ios-ux.md` 11.4.4), plus the QR lock iOS keeps on
 * the shared camera (Services/ScanCameraController.swift `qrLocked`,
 * `didRead`, `resumeQR`).
 *
 * CAMERA FIRST MEANS THE VIEWFINDER SEES EVERYTHING. It is live before the
 * member has aimed at anything, so it meets menus, Wi-Fi signs and parking
 * stickers, and CameraX hands the same code over many times a second. None
 * of that may raise an alert or lock the scanner. A LifePass code that did
 * not parse (a staff code, a scratched poster) still alerts, and so does
 * anything aimed at on purpose from a venue's "Scan QR" (pushed mode).
 *
 * Pure and framework free, so the iOS CheckInScanTests port directly.
 */
import { track } from '../../../lib/analytics';
import { isLifePassShaped, parseWalkInQr, type WalkInQrFailure } from '../../../checkin/walkInQrParser';

/** iOS `QRRead`. */
export type QrRead =
  /** A LifePass venue code: start the walk-in. */
  | { readonly kind: 'venue'; readonly venueId: string }
  /**
   * Refused with today's alert (`messageKey`): any LifePass-shaped code that
   * did not parse, anywhere, plus every refusal in pushed mode, where the
   * member aimed at that venue's code on purpose.
   */
  | { readonly kind: 'rejected'; readonly messageKey: string }
  /** Somebody else's code in tab mode, seen for the first time or again inside the window: nothing at all. */
  | { readonly kind: 'foreignIgnored' }
  /** The same foreign code read again after the window: the "Not a LifePass code" chip, never an alert. */
  | { readonly kind: 'foreignChip' };

/** A foreign code read again within this long is still silent (iOS `foreignWindow`, 3 s). */
export const FOREIGN_WINDOW_MS = 3_000;
/** Foreign codes are forgotten after this long (iOS prunes `foreignSeen` at 60 s). */
export const FOREIGN_MEMORY_MS = 60_000;

/** The alert's words for a parser refusal (iOS `CheckInViewModel.message(for:)`). */
export function qrRefusalKey(reason: WalkInQrFailure): string {
  switch (reason) {
    case 'wrong_type':
      return 'checkin.err.qr_staff';
    case 'untrusted_host':
      return 'checkin.err.qr_untrusted';
    default:
      return 'checkin.err.qr_invalid';
  }
}

/** `qr_foreign_ignored` is counted once per app session (iOS `static reportedForeign`). */
let reportedForeign = false;

/** Back to a fresh app session (tests). */
export function resetForeignReportForTests(): void {
  reportedForeign = false;
}

/**
 * The read memory of one scanner: which foreign codes it has met, and which
 * have already had their chip. One per Scan screen, as iOS keeps one per
 * view model.
 */
export class QrReadClassifier {
  /** Foreign payloads and when they were last remembered (ms). */
  private readonly foreignSeen = new Map<string, number>();
  /**
   * Payloads whose chip has already been said. The chip carries a TalkBack
   * announcement, and the camera reads on every frame: without this, a menu
   * code left in the viewfinder chips and announces every three seconds for
   * as long as the member stands there, talking over them and over the
   * walk-in flow. Said once per code, and forgotten with `foreignSeen` by the
   * same 60 second prune, so a code met again much later says it once more.
   */
  private readonly chipped = new Set<string>();

  /** Classify one read (iOS `readQR(_:pushed:appState:now:)`). */
  read(payload: string, pushed: boolean, now: number = Date.now()): QrRead {
    const result = parseWalkInQr(payload);
    if (result.ok) return { kind: 'venue', venueId: result.venueId };

    // A LifePass code that did not parse is not somebody else's QR: a staff
    // code, a garbled id on a poster that was printed wrong or has been
    // scratched, a `/scan` link that lost its `?v=`. The member aimed at it on
    // purpose, so it gets the alert. Only a code that is not ours by any
    // reading (an untrusted host, plain text, a Wi-Fi sticker, an empty read)
    // passes in silence.
    //
    // SHAPE CARRIES THE WHOLE DECISION. `wrong_type` and `invalid_uuid` are
    // not evidence on their own: somebody else's JSON object reaches both (a
    // `{"type":"wifi"}` sticker is `wrong_type`). They can only come from a
    // trusted-host URL or from one of our own envelopes, and
    // `isLifePassShaped` already says yes to both.
    if (pushed || isLifePassShaped(payload)) {
      return { kind: 'rejected', messageKey: qrRefusalKey(result.reason) };
    }

    if (!reportedForeign) {
      reportedForeign = true;
      track('qr_foreign_ignored');
    }
    for (const [seenPayload, at] of this.foreignSeen) {
      if (now - at >= FOREIGN_MEMORY_MS) this.foreignSeen.delete(seenPayload);
    }
    for (const chippedPayload of this.chipped) {
      if (!this.foreignSeen.has(chippedPayload)) this.chipped.delete(chippedPayload);
    }
    const seen = this.foreignSeen.get(payload);
    if (seen !== undefined && now - seen < FOREIGN_WINDOW_MS) return { kind: 'foreignIgnored' };
    this.foreignSeen.set(payload, now);
    if (seen === undefined || this.chipped.has(payload)) return { kind: 'foreignIgnored' };
    this.chipped.add(payload);
    return { kind: 'foreignChip' };
  }
}

/** What the read's handler decided (iOS `ScanCameraController.QRDisposition`). */
export type QrDisposition = 'handled' | 'foreign';

/**
 * A venue and a refusal are handled (the QR locks until "Scan another code");
 * a foreign code is not (iOS `CheckInView.handleQR`).
 */
export function dispositionOf(read: QrRead): QrDisposition {
  return read.kind === 'venue' || read.kind === 'rejected' ? 'handled' : 'foreign';
}

/**
 * The scanner's QR lock (the QR half of iOS `ScanCameraController`).
 *
 * After a handled read the QR stays locked: a phone still pointing at the
 * poster never starts a second walk-in by itself. Foreign codes never lock.
 * "Scan another code" resumes.
 *
 * THE LOCK IS SYNCHRONOUS. CameraX delivers a code on every analysed frame;
 * React state would let several frames through before the next render, so the
 * lock is set here, before the handler's work (and any await) begins.
 */
export class QrGate {
  private locked = false;
  private readonly listeners = new Set<() => void>();

  get isLocked(): boolean {
    return this.locked;
  }

  /** Read for `useSyncExternalStore`. */
  readonly getSnapshot = (): boolean => this.locked;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** One camera read: ignored while locked; locks when the handler handled it. */
  didRead(payload: string, handler: (payload: string) => QrDisposition): void {
    if (this.locked) return;
    if (handler(payload) === 'handled') this.lock();
  }

  lock(): void {
    this.set(true);
  }

  /** "Scan another code" (iOS `resumeQR`). */
  resume(): void {
    this.set(false);
  }

  private set(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    for (const listener of [...this.listeners]) listener();
  }
}
