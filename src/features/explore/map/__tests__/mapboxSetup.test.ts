/**
 * Mapbox is set up before the first map is drawn: the runtime token first,
 * then telemetry off once Mapbox has taken it (LifePass does not track, and
 * the member's position never leaves the phone); once. On Android the
 * telemetry switch builds a throwaway native map, which throws without a
 * token, so the order is the difference between a launch and a crash. And
 * the regions the map opens on.
 */
import { TEST_MAPBOX_TOKEN } from '@test/server/testEnv';

import { configureMapbox, hasMapboxToken, resetMapboxSetupForTests } from '../mapbox';
import { ICELAND_REGION, regionBounds, regionZoom, REYKJAVIK_REGION } from '../regions';

async function settle() {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

describe('the Mapbox setup', () => {
  it('on import, hands over the token first and switches telemetry off once Mapbox has it', async () => {
    const calls: string[] = [];
    let resolveToken: (token: string | null) => void = () => undefined;
    jest.isolateModules(() => {
      jest.doMock('@rnmapbox/maps', () => ({
        __esModule: true,
        default: {
          setTelemetryEnabled: (enabled: boolean) => calls.push(`telemetry ${enabled}`),
          setAccessToken: (token: string | null) => {
            calls.push(`token ${token}`);
            return new Promise<string | null>((resolve) => {
              resolveToken = resolve;
            });
          },
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../mapbox');
    });
    // Not before Mapbox has taken the token: the switch would build a map without one.
    await settle();
    expect(calls).toEqual([`token ${TEST_MAPBOX_TOKEN}`]);
    resolveToken(TEST_MAPBOX_TOKEN);
    await settle();
    expect(calls).toEqual([`token ${TEST_MAPBOX_TOKEN}`, 'telemetry false']);
  });

  it('does it once', async () => {
    resetMapboxSetupForTests();
    const target = { setTelemetryEnabled: jest.fn(), setAccessToken: jest.fn() };
    await configureMapbox(target, 'pk.one');
    await configureMapbox(target, 'pk.two');
    expect(target.setTelemetryEnabled).toHaveBeenCalledTimes(1);
    expect(target.setTelemetryEnabled).toHaveBeenCalledWith(false);
    expect(target.setAccessToken).toHaveBeenCalledWith('pk.one');
    expect(target.setAccessToken).toHaveBeenCalledTimes(1);
  });

  it('a build without a token touches neither: there is no map to set up', async () => {
    for (const token of [null, '', '   ']) {
      resetMapboxSetupForTests();
      const target = { setTelemetryEnabled: jest.fn(), setAccessToken: jest.fn() };
      await expect(configureMapbox(target, token)).resolves.toBeUndefined();
      expect(target.setAccessToken).not.toHaveBeenCalled();
      expect(target.setTelemetryEnabled).not.toHaveBeenCalled();
    }
    expect(hasMapboxToken(null)).toBe(false);
    expect(hasMapboxToken('pk.one')).toBe(true);
  });

  it('a token Mapbox refuses leaves telemetry alone, and never throws', async () => {
    resetMapboxSetupForTests();
    const rejecting = { setTelemetryEnabled: jest.fn(), setAccessToken: jest.fn(() => Promise.reject(new Error('no'))) };
    await expect(configureMapbox(rejecting, 'pk.bad')).resolves.toBeUndefined();
    expect(rejecting.setTelemetryEnabled).not.toHaveBeenCalled();

    resetMapboxSetupForTests();
    const throwing = {
      setTelemetryEnabled: jest.fn(),
      setAccessToken: jest.fn(() => {
        throw new Error('no');
      }),
    };
    await expect(configureMapbox(throwing, 'pk.bad')).resolves.toBeUndefined();
    expect(throwing.setTelemetryEnabled).not.toHaveBeenCalled();
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
