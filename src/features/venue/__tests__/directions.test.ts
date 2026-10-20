/**
 * Directions on Android (plan 5.6): Google Maps by coordinates (else the
 * address) in driving mode, and a `geo:` link for any other maps app, which
 * falls back to Google Maps when no app takes it.
 */
import { Linking } from 'react-native';

import {
  directionsDestination,
  geoUrl,
  googleMapsDirectionsUrl,
  openInGoogleMaps,
  openInOtherMapsApp,
} from '../directions';

const place = { name: 'Sundhöll Reykjavíkur', address: 'Barónsstígur 45a, 101 Reykjavík', latitude: 64.1427, longitude: -21.9186 };
const addressOnly = { ...place, latitude: null, longitude: null };
const nowhere = { ...addressOnly, address: null };

let openURL: jest.SpyInstance;
beforeEach(() => {
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});
afterEach(() => openURL.mockRestore());

describe('the destination', () => {
  it('prefers the coordinates over the address, as iOS does', () => {
    expect(directionsDestination(place)).toBe('64.1427,-21.9186');
    expect(googleMapsDirectionsUrl(place)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=64.1427,-21.9186&travelmode=driving',
    );
  });

  it('falls back to the address, encoded', () => {
    expect(googleMapsDirectionsUrl(addressOnly)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Bar%C3%B3nsst%C3%ADgur%2045a%2C%20101%20Reykjav%C3%ADk&travelmode=driving',
    );
    expect(geoUrl(addressOnly)).toBe('geo:0,0?q=Bar%C3%B3nsst%C3%ADgur%2045a%2C%20101%20Reykjav%C3%ADk');
  });

  it('a labelled pin for another maps app', () => {
    expect(geoUrl(place)).toBe('geo:64.1427,-21.9186?q=64.1427,-21.9186(Sundh%C3%B6ll%20Reykjav%C3%ADkur)');
  });

  it("parentheses in the name stay inside the pin's label", () => {
    expect(geoUrl({ ...place, name: 'Sundhöllin (innilaug)' })).toBe(
      'geo:64.1427,-21.9186?q=64.1427,-21.9186(Sundh%C3%B6llin%20%28innilaug%29)',
    );
  });

  it('nowhere to go is no link at all', () => {
    expect(directionsDestination(nowhere)).toBeNull();
    expect(googleMapsDirectionsUrl(nowhere)).toBeNull();
    expect(geoUrl(nowhere)).toBeNull();
  });
});

describe('opening it', () => {
  it('"Open in Google Maps" opens the directions URL', async () => {
    await openInGoogleMaps(place);
    expect(openURL).toHaveBeenCalledWith(googleMapsDirectionsUrl(place));
  });

  it('"Open in another app" hands the geo: link to the system', async () => {
    await openInOtherMapsApp(place);
    expect(openURL.mock.calls).toEqual([[geoUrl(place)]]);
  });

  it('with no maps app for geo:, it opens Google Maps instead of doing nothing', async () => {
    openURL.mockRejectedValueOnce(new Error('No Activity found to handle Intent'));
    await openInOtherMapsApp(place);
    expect(openURL.mock.calls).toEqual([[geoUrl(place)], [googleMapsDirectionsUrl(place)]]);
  });

  it('a rejected Google Maps link is swallowed (nothing to show the member)', async () => {
    openURL.mockRejectedValue(new Error('no browser'));
    await expect(openInGoogleMaps(place)).resolves.toBeUndefined();
  });
});
