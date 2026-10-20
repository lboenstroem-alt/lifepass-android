/**
 * The Scan tab's pure rules: the camera state from the permission, when the
 * camera is wanted, and where the reticle sits (iOS QRScannerView `centreY`,
 * CheckInView `reticleReserveTop`).
 */
import { reserveTopFor } from '../CheckInScanView';
import { reticlePath, RETICLE_SIDE } from '../Reticle';
import { HINT_CENTRE_BELOW_RETICLE, HINT_ROOM, hintCentreY, reticleCentreY } from '../ScanViewfinder';
import { cameraAnalyticsValue, cameraAuthorization, isForeground, wantsCamera } from '../useScanCamera';
import { DENIED, DENIED_ASK_AGAIN, GRANTED, UNDETERMINED } from './scanDoubles';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
jest.mock('expo-camera', () => require('./scanDoubles').expoCameraModule);
/* eslint-enable @typescript-eslint/no-require-imports */

describe('camera authorization', () => {
  it('reads the permission as iOS reads AVAuthorizationStatus, with Android asking again', () => {
    expect(cameraAuthorization(null, false)).toBe('checking');
    expect(cameraAuthorization(GRANTED, false)).toBe('authorized');
    expect(cameraAuthorization(GRANTED, true)).toBe('unavailable');
    expect(cameraAuthorization(UNDETERMINED, false)).toBe('notDetermined');
    expect(cameraAuthorization(DENIED_ASK_AGAIN, false)).toBe('notDetermined');
    expect(cameraAuthorization(DENIED, false)).toBe('denied');
    // A bind failure says nothing about a camera that is not allowed.
    expect(cameraAuthorization(DENIED, true)).toBe('denied');
  });

  it('names the state for scan_tab_viewed as iOS does', () => {
    expect(cameraAnalyticsValue('authorized')).toBe('authorized');
    expect(cameraAnalyticsValue('notDetermined')).toBe('not_determined');
    expect(cameraAnalyticsValue('denied')).toBe('denied');
    expect(cameraAnalyticsValue('unavailable')).toBe('unavailable');
  });

  it('wants the camera only while focused, in front and allowed', () => {
    expect(wantsCamera(true, true, 'authorized')).toBe(true);
    expect(wantsCamera(false, true, 'authorized')).toBe(false);
    expect(wantsCamera(true, false, 'authorized')).toBe(false);
    for (const state of ['checking', 'notDetermined', 'denied', 'unavailable'] as const) {
      expect(wantsCamera(true, true, state)).toBe(false);
    }
  });

  it('counts an unknown first AppState as the foreground', () => {
    expect(isForeground('active')).toBe(true);
    expect(isForeground('unknown')).toBe(true);
    expect(isForeground(null)).toBe(true);
    expect(isForeground('background')).toBe(false);
    expect(isForeground('inactive')).toBe(false);
  });
});

describe('the reticle', () => {
  it('sits under the meal entry with a 24 dp gap, or 24 dp under the bar without one', () => {
    expect(reserveTopFor(64)).toBe(16 + 64 + 24);
    expect(reserveTopFor(36)).toBe(16 + 36 + 24);
    expect(reserveTopFor(0)).toBe(24);
  });

  it('is centred between the reserve and the hint room above the tab bar', () => {
    const height = 640;
    const reserveTop = 104;
    const reserveBottom = 76;
    const regionBottom = height - reserveBottom - HINT_ROOM;
    expect(reticleCentreY(height, reserveTop, reserveBottom)).toBe((reserveTop + regionBottom) / 2);
  });

  it('never rises above half a reticle under the reserve on a short screen', () => {
    expect(reticleCentreY(300, 104, 76)).toBe(104 + RETICLE_SIDE / 2);
  });

  it("puts the hint's centre 44 dp under the reticle, as iOS positions it", () => {
    expect(HINT_CENTRE_BELOW_RETICLE).toBe(24 + 20);
    expect(hintCentreY(300)).toBe(300 + RETICLE_SIDE / 2 + 44);
  });

  it('is four brackets drawn as one path with rounded corners', () => {
    const d = reticlePath(240, 4);
    expect(d.match(/M /g)).toHaveLength(4);
    expect(d.match(/Q /g)).toHaveLength(4);
    expect(d.startsWith('M 4 32')).toBe(true);
  });
});
