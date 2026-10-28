/**
 * The Scan tab's QR rules, ported from iOS CheckInScanTests (`ios-ux.md`
 * 11.4.4): camera first means the viewfinder is live before the member has
 * aimed at anything, so it sees menus, Wi-Fi signs and parking stickers. None
 * of that may raise an alert or lock the scanner; a LifePass staff code still
 * does, and so does anything aimed at on purpose from a venue's "Scan QR".
 *
 * The harness wires the classifier to the gate exactly as the Scan screen
 * does (iOS `CheckInView.handleQR` over `ScanCameraController.didRead`).
 */
import { setAnalyticsObserver, type AnalyticsParams } from '../../../../lib/analytics';
import { dispositionOf, QrGate, QrReadClassifier, resetForeignReportForTests, type QrRead } from '../qrRead';

const VENUE_URL = 'https://lifepass.is/scan?v=3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f';
const FOREIGN_URL = 'https://example.com/menu?table=7';
const STAFF_CODE = '{"type":"booking_checkin","id":"3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f"}';

/** The Scan screen's wiring: what each read did, the alert, the venue that started. */
function makeScanner() {
  const classifier = new QrReadClassifier();
  const gate = new QrGate();
  const state = {
    pushed: false,
    error: null as string | null,
    scannedVenueId: null as string | null,
    calls: 0,
  };
  const read = (payload: string, now = Date.now()) =>
    gate.didRead(payload, (value) => {
      state.calls += 1;
      const result = classifier.read(value, state.pushed, now);
      if (result.kind === 'venue') {
        state.error = null;
        state.scannedVenueId = result.venueId;
      }
      if (result.kind === 'rejected') state.error = result.messageKey;
      return dispositionOf(result);
    });
  return { classifier, gate, state, read };
}

const events: [string, AnalyticsParams][] = [];
beforeEach(() => {
  resetForeignReportForTests();
  events.length = 0;
  setAnalyticsObserver((event, params) => events.push([event, params]));
});
afterEach(() => setAnalyticsObserver(null));

describe('foreign codes', () => {
  it('a foreign URL in tab mode raises no alert and does not lock', () => {
    const { gate, state, read } = makeScanner();
    read(FOREIGN_URL);
    expect(state.error).toBeNull();
    expect(gate.isLocked).toBe(false);
    expect(state.scannedVenueId).toBeNull();
    // And a LifePass code in view right after it still works.
    read(VENUE_URL);
    expect(state.scannedVenueId).toBe('3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f');
    expect(gate.isLocked).toBe(true);
  });

  it('a foreign code read again after the window shows the chip, never an alert', () => {
    const { classifier } = makeScanner();
    const start = 1_000_000;
    const kinds = [0, 1_000, 3_200, 4_000].map((offset) => classifier.read(FOREIGN_URL, false, start + offset).kind);
    expect(kinds).toEqual(['foreignIgnored', 'foreignIgnored', 'foreignChip', 'foreignIgnored']);
  });

  it('a foreign code left in the viewfinder chips only once', () => {
    const { classifier } = makeScanner();
    const start = 1_000_000;
    let chips = 0;
    for (let offset = 0; offset <= 12_000; offset += 200) {
      if (classifier.read(FOREIGN_URL, false, start + offset).kind === 'foreignChip') chips += 1;
    }
    expect(chips).toBe(1);
  });

  it('the same foreign code read four times (t+0, t+3.2, t+7, t+11) chips once', () => {
    const { classifier } = makeScanner();
    const start = 1_000_000;
    const reads: QrRead[] = [0, 3_200, 7_000, 11_000].map((offset) => classifier.read(FOREIGN_URL, false, start + offset));
    expect(reads.filter((r) => r.kind === 'foreignChip')).toHaveLength(1);
  });

  it('each foreign code gets its own chip', () => {
    const { classifier } = makeScanner();
    const start = 1_000_000;
    for (const payload of [FOREIGN_URL, 'https://example.org/other']) {
      classifier.read(payload, false, start);
      expect(classifier.read(payload, false, start + 3_200).kind).toBe('foreignChip');
    }
  });

  it('a code met again a minute later says its chip once more', () => {
    const { classifier } = makeScanner();
    const start = 1_000_000;
    classifier.read(FOREIGN_URL, false, start);
    expect(classifier.read(FOREIGN_URL, false, start + 3_200).kind).toBe('foreignChip');
    // Forgotten after 60 s: the first sight again, then the chip again.
    expect(classifier.read(FOREIGN_URL, false, start + 70_000).kind).toBe('foreignIgnored');
    expect(classifier.read(FOREIGN_URL, false, start + 73_300).kind).toBe('foreignChip');
  });

  it('plain text and other people’s URLs are foreign: silence, and no lock', () => {
    const { gate, state, read } = makeScanner();
    for (const payload of [
      'WIFI:S:Cafe;T:WPA;P:secret;;',
      'hello',
      'BEGIN:VCARD\nFN:Anna\nEND:VCARD',
      'tel:+3545551234',
      'https://example.com/scan?v=not-a-uuid',
      // JSON is not a LifePass envelope by itself.
      '{"type":"wifi","ssid":"CafeGuest"}',
      '{"orderId":42,"table":7}',
      '{"type":"ticket","seat":"12A"}',
    ]) {
      read(payload);
      expect(state.error).toBeNull();
      expect(gate.isLocked).toBe(false);
    }
  });

  it('qr_foreign_ignored is counted once per app session', () => {
    const { classifier } = makeScanner();
    classifier.read(FOREIGN_URL, false, 0);
    classifier.read('hello', false, 10);
    new QrReadClassifier().read('another', false, 20);
    expect(events.filter(([event]) => event === 'qr_foreign_ignored')).toHaveLength(1);
  });
});

describe('what still alerts', () => {
  it('a damaged LifePass code alerts on the first read and locks', () => {
    const { gate, state, read } = makeScanner();
    for (const payload of [
      'https://lifepass.is/scan?v=not-a-uuid', // garbled id
      'https://www.lifepass.is/scan', // lost its ?v=
      '{"type":"venue_checkin","id":"nope"}', // envelope, bad id
      '{"type":"venue_checkin"', // truncated JSON
    ]) {
      state.error = null;
      gate.resume();
      read(payload);
      expect(state.error).not.toBeNull();
      expect(gate.isLocked).toBe(true);
    }
  });

  it('a damaged LifePass code is rejected, not silently ignored', () => {
    expect(new QrReadClassifier().read('https://lifepass.is/scan?v=not-a-uuid', false)).toEqual({
      kind: 'rejected',
      messageKey: 'checkin.err.qr_invalid',
    });
  });

  it('a staff code keeps today’s alert and locks', () => {
    const { gate, state, read } = makeScanner();
    read(STAFF_CODE);
    expect(state.error).toBe('checkin.err.qr_staff');
    expect(gate.isLocked).toBe(true);
  });

  it('in pushed mode every refusal alerts', () => {
    const { gate, state, read } = makeScanner();
    state.pushed = true;
    read(FOREIGN_URL);
    expect(state.error).toBe('checkin.err.qr_untrusted');
    expect(gate.isLocked).toBe(true);
    gate.resume();
    read('hello');
    expect(state.error).toBe('checkin.err.qr_invalid');
  });
});

describe('a LifePass code', () => {
  it('starts once and locks until rescan', () => {
    const { gate, state, read } = makeScanner();
    read(VENUE_URL);
    read(VENUE_URL);
    read(VENUE_URL);
    expect(state.calls).toBe(1);
    expect(state.scannedVenueId).toBe('3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f');
    gate.resume();
    read(VENUE_URL);
    expect(state.calls).toBe(2);
  });

  it('the gate tells its listeners when it locks and resumes', () => {
    const gate = new QrGate();
    const seen: boolean[] = [];
    const stop = gate.subscribe(() => seen.push(gate.getSnapshot()));
    gate.lock();
    gate.lock();
    gate.resume();
    stop();
    gate.lock();
    expect(seen).toEqual([true, false]);
  });
});
