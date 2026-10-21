/**
 * Mapbox is set up before the first map is drawn: telemetry off (LifePass
 * does not track, and the member's position never leaves the phone), then
 * the runtime token; once. And the regions the map opens on.
 */
import { TEST_MAPBOX_TOKEN } from '@test/server/testEnv';

import { configureMapbox, resetMapboxSetupForTests } from '../mapbox';
import { ICELAND_REGION, regionBounds, regionZoom, REYKJAVIK_REGION } from '../regions';

describe('the Mapbox setup', () => {
  it('switches telemetry off on import, before it hands over the token', () => {
    const calls: string[] = [];
    jest.isolateModules(() => {
      jest.doMock('@rnmapbox/maps', () => ({
        __esModule: true,
        default: {
          setTelemetryEnabled: (enabled: boolean) => calls.push(`telemetry ${enabled}`),
          setAccessToken: (token: string | null) => {
            calls.push(`token ${token}`);
            return Promise.resolve(token);
          },
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../mapbox');
    });
    expect(calls).toEqual(['telemetry false', `token ${TEST_MAPBOX_TOKEN}`]);
  });

  it('does it once', () => {
    resetMapboxSetupForTests();
    const target = { setTelemetryEnabled: jest.fn(), setAccessToken: jest.fn() };
    configureMapbox(target, 'pk.one');
    configureMapbox(target, 'pk.two');
    expect(target.setTelemetryEnabled).toHaveBeenCalledTimes(1);
    expect(target.setTelemetryEnabled).toHaveBeenCalledWith(false);
    expect(target.setAccessToken).toHaveBeenCalledWith('pk.one');
    expect(target.setAccessToken).toHaveBeenCalledTimes(1);
  });

  it('a build without a token still sets up, to a blank map rather than a crash', () => {
    resetMapboxSetupForTests();
    const target = { setTelemetryEnabled: jest.fn(), setAccessToken: jest.fn(() => Promise.reject(new Error('no'))) };
    expect(() => configureMapbox(target, null)).not.toThrow();
    expect(target.setTelemetryEnabled).toHaveBeenCalledWith(false);
    expect(target.setAccessToken).toHaveBeenCalledWith(null);
  });
});

describe('the regions', () => {
  it('central Reykjavík is iOS’s 0.08 by 0.08 around the city centre', () => {
    const { ne, sw } = regionBounds(REYKJAVIK_REGION);
    expect(ne[0]).toBeCloseTo(-21.9026, 6);
    expect(ne[1]).toBeCloseTo(64.1866, 6);
    expect(sw[0]).toBeCloseTo(-21.9826, 6);
    expect(sw[1]).toBeCloseTo(64.1066, 6);
  });

  it('all of Iceland is Reykjanes to Langanes', () => {
    const { ne, sw } = regionBounds(ICELAND_REGION);
    expect(ne[0]).toBeCloseTo(-12.85);
    expect(ne[1]).toBeCloseTo(67.06);
    expect(sw[0]).toBeCloseTo(-24.35);
    expect(sw[1]).toBeCloseTo(62.86);
  });

  it('fits the region in the map, the tighter side deciding', () => {
    // A phone's map, 390 by 600 dp: the latitude span decides at 64 degrees north.
    expect(regionZoom(REYKJAVIK_REGION, 390, 600)).toBeCloseTo(11.17, 1);
    expect(regionZoom(ICELAND_REGION, 390, 600)).toBeCloseTo(4.57, 1);
    expect(regionZoom(REYKJAVIK_REGION, 0, 600)).toBe(0);
  });
});
