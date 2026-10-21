/**
 * The poster parser (iOS WalkInQRParser, itself the web's canonical
 * walk-in-qr-parser.ts): what a printed code, a legacy envelope and a bare id
 * read as, and which payloads are shaped like ours without parsing.
 */
import { isLifePassShaped, isVenueUuid, parseWalkInQr, venueIdFromScan } from '../walkInQrParser';

const VENUE = '3f2b8c1e-7d4a-4b6e-9c2f-1a2b3c4d5e6f';

describe('parseWalkInQr', () => {
  it.each([
    [`https://lifepass.is/scan?v=${VENUE}`, 'urlQuery'],
    [`https://www.lifepass.is/scan?v=${VENUE}`, 'urlQuery'],
    [`https://app.lifepass.is/scan?v=${VENUE}`, 'urlQuery'],
    [`https://staging.lifepass.is/scan?v=${VENUE}`, 'urlQuery'],
    [`HTTPS://LIFEPASS.IS/scan?v=${VENUE}`, 'urlQuery'],
    [`  https://lifepass.is/scan?v=${VENUE}\n`, 'urlQuery'],
    [`https://lifepass.is/scan?x=1&v=${VENUE}`, 'urlQuery'],
    [`https://lifepass.is/scan#${encodeURIComponent(JSON.stringify({ type: 'venue_checkin', id: VENUE }))}`, 'urlFragment'],
    [JSON.stringify({ type: 'venue_checkin', id: VENUE }), 'json'],
    [JSON.stringify({ id: VENUE }), 'json'],
    [VENUE, 'uuid'],
  ])('%s reads as the venue (%s)', (payload, source) => {
    expect(parseWalkInQr(payload)).toEqual({ ok: true, venueId: VENUE, source });
  });

  it('keeps ids lower case, as every id in the app is', () => {
    expect(venueIdFromScan(VENUE.toUpperCase())).toBe(VENUE);
    expect(venueIdFromScan(`https://lifepass.is/scan?v=${VENUE.toUpperCase()}`)).toBe(VENUE);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    [JSON.stringify({ type: 'booking_checkin', id: VENUE }), 'wrong_type'],
    [JSON.stringify({ type: 'wifi', ssid: 'Cafe' }), 'wrong_type'],
    [`https://example.com/scan?v=${VENUE}`, 'untrusted_host'],
    [`https://lifepass.is.evil.example/scan?v=${VENUE}`, 'untrusted_host'],
    ['https://lifepass.is/scan?v=not-a-uuid', 'invalid_uuid'],
    // All zero: no version nibble.
    ['00000000-0000-0000-0000-000000000000', 'invalid_payload'],
    ['https://lifepass.is/scan?v=00000000-0000-0000-0000-000000000000', 'invalid_uuid'],
    // Version 6 and a bad variant are outside RFC 4122 v1 to v5.
    ['3f2b8c1e-7d4a-6b6e-9c2f-1a2b3c4d5e6f', 'invalid_payload'],
    ['3f2b8c1e-7d4a-4b6e-7c2f-1a2b3c4d5e6f', 'invalid_payload'],
    [JSON.stringify({ type: 'venue_checkin', id: 'nope' }), 'invalid_uuid'],
    [JSON.stringify({ type: 'venue_checkin' }), 'invalid_payload'],
    ['{"type":"venue_checkin"', 'invalid_payload'],
    ['[1,2,3]', 'invalid_payload'],
    ['https://www.lifepass.is/scan', 'invalid_payload'],
    ['https://lifepass.is/scan#not-json', 'invalid_payload'],
    [`https://lifepass.is/scan#${encodeURIComponent(JSON.stringify({ type: 'booking_checkin', id: VENUE }))}`, 'wrong_type'],
    ['hello', 'invalid_payload'],
    ['WIFI:S:Cafe;T:WPA;P:secret;;', 'invalid_payload'],
  ])('%j is refused: %s', (payload, reason) => {
    expect(parseWalkInQr(payload)).toEqual({ ok: false, reason });
  });

  it('trusts the configured API host too, as the web trusts its own host', () => {
    // The tests point the API at a `.test` host (test/setup/env.ts).
    const apiHost = new URL(process.env.EXPO_PUBLIC_LIFEPASS_API_URL ?? '').hostname;
    expect(parseWalkInQr(`https://${apiHost}/scan?v=${VENUE}`)).toEqual({ ok: true, venueId: VENUE, source: 'urlQuery' });
  });

  it('trusts a laptop in a development build only (iOS #if DEBUG)', () => {
    expect(__DEV__).toBe(true);
    expect(parseWalkInQr(`http://localhost:3000/scan?v=${VENUE}`).ok).toBe(true);
    expect(parseWalkInQr(`http://127.0.0.1/scan?v=${VENUE}`).ok).toBe(true);
  });
});

describe('isVenueUuid', () => {
  it('accepts v1 to v5 in either case and nothing else', () => {
    expect(isVenueUuid(VENUE)).toBe(true);
    expect(isVenueUuid(VENUE.toUpperCase())).toBe(true);
    expect(isVenueUuid('3f2b8c1e-7d4a-1b6e-8c2f-1a2b3c4d5e6f')).toBe(true);
    expect(isVenueUuid('3f2b8c1e-7d4a-5b6e-bc2f-1a2b3c4d5e6f')).toBe(true);
    expect(isVenueUuid('3f2b8c1e-7d4a-0b6e-9c2f-1a2b3c4d5e6f')).toBe(false);
    expect(isVenueUuid(`${VENUE}0`)).toBe(false);
    expect(isVenueUuid(`{${VENUE}}`)).toBe(false);
  });
});

describe('isLifePassShaped', () => {
  it.each([
    'https://lifepass.is/scan?v=not-a-uuid',
    'https://www.lifepass.is/scan',
    'https://www.lifepass.is/anything',
    '{"type":"venue_checkin","id":"nope"}',
    '{"type":"venue_checkin"',
    '{"type":"booking_checkin","id":"x"}',
  ])('%s is ours', (payload) => {
    expect(isLifePassShaped(payload)).toBe(true);
  });

  it.each([
    'https://example.com/menu?table=7',
    'https://example.com/scan?v=not-a-uuid',
    '{"type":"wifi","ssid":"CafeGuest"}',
    '{"orderId":42,"table":7}',
    '{"type":"ticket","seat":"12A"}',
    'WIFI:S:Cafe;T:WPA;P:secret;;',
    'hello',
    'tel:+3545551234',
    'BEGIN:VCARD\nFN:Anna\nEND:VCARD',
    '',
  ])('%j is somebody else’s', (payload) => {
    expect(isLifePassShaped(payload)).toBe(false);
  });
});
