/**
 * The hero's weather line (iOS HomeWeatherService): the WMO code and the
 * temperature to a condition, a glyph and a recommendation, and a read that
 * hides the line on any failure instead of inventing a 0°.
 */
import { http, HttpResponse, server } from '@test/server';

import {
  classifySky,
  decodeWeather,
  fetchWeather,
  WEATHER_URL,
  weatherFrom,
  weatherLine,
  weatherRecommendation,
} from '../weather';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';

describe('the WMO mapping', () => {
  it.each([
    [0, 'SUNNY', 'weather-sunny'],
    [1, 'CLOUDY', 'weather-partly-cloudy'],
    [2, 'CLOUDY', 'weather-partly-cloudy'],
    [3, 'CLOUDY', 'weather-partly-cloudy'],
    [45, 'FOGGY', 'weather-fog'],
    [48, 'FOGGY', 'weather-fog'],
    [51, 'RAINY', 'weather-rainy'],
    [67, 'RAINY', 'weather-rainy'],
    [71, 'SNOWING', 'snowflake'],
    [86, 'SNOWING', 'snowflake'],
    [95, 'STORMY', 'weather-lightning'],
    [99, 'STORMY', 'weather-lightning'],
    [4, 'CLOUDY', 'weather-cloudy'],
    [68, 'CLOUDY', 'weather-cloudy'],
    [90, 'CLOUDY', 'weather-cloudy'],
  ])('code %i is %s with %s', (code, condition, icon) => {
    const weather = weatherFrom(code, 7);
    expect(weather.condition).toBe(condition);
    expect(weather.icon).toBe(icon);
  });
});

describe('the recommendation', () => {
  it.each([
    ['storm', 20, 'STAY IN — SAUNA DAY'],
    ['snow', 20, 'HOT SPRING WEATHER'],
    ['rainy', 20, 'LAGOON WEATHER'],
    ['sunny', 15, 'PERFECT FOR OUTDOORS'],
    ['sunny', 14, 'OUTDOOR POOL WEATHER'],
    ['sunny', 5, 'OUTDOOR POOL WEATHER'],
    ['sunny', 4, 'HOT SPRING WEATHER'],
    ['partlySunny', 10, 'OUTDOOR POOL WEATHER'],
    ['partlySunny', 9, 'SPA & HOT SPRING DAY'],
    ['partlySunny', 5, 'SPA & HOT SPRING DAY'],
    ['partlySunny', 4, 'HOT SPRING WEATHER'],
    ['cloudy', 10, 'INDOOR POOL WEATHER'],
    ['cloudy', 9, 'SPA & SAUNA WEATHER'],
    ['cloudy', 5, 'SPA & SAUNA WEATHER'],
    ['cloudy', 4, 'INDOOR & SAUNA DAY'],
    ['cloudy', 0, 'INDOOR & SAUNA DAY'],
    ['cloudy', -1, 'HOT SPRING WEATHER'],
    ['foggy', 10, 'INDOOR POOL WEATHER'],
    ['foggy', -3, 'HOT SPRING WEATHER'],
  ] as const)('%s at %i° says %s', (sky, temperature, words) => {
    expect(weatherRecommendation(sky, temperature)).toBe(words);
  });

  it('rounds the temperature half away from zero before it is compared, as Swift does', () => {
    expect(weatherFrom(0, 14.5).temperature).toBe(15);
    expect(weatherFrom(0, 14.5).recommendation).toBe('PERFECT FOR OUTDOORS');
    expect(weatherFrom(3, -0.5).temperature).toBe(-1);
    expect(weatherFrom(3, -0.4).temperature).toBe(0);
    expect(Object.is(weatherFrom(3, -0.4).temperature, -0)).toBe(false);
  });

  it('writes the line with the icon left to the screen', () => {
    expect(weatherLine(weatherFrom(3, 7.2))).toBe('CLOUDY · 7° · SPA & HOT SPRING DAY');
  });

  it('classifySky follows the WMO table', () => {
    expect(classifySky(45)).toBe('foggy');
    expect(classifySky(96)).toBe('storm');
  });
});

describe('decodeWeather', () => {
  it('reads current.temperature_2m and current.weather_code', () => {
    expect(decodeWeather({ current: { temperature_2m: 6.4, weather_code: 61 } })).toEqual({
      temperature: 6,
      condition: 'RAINY',
      icon: 'weather-rainy',
      recommendation: 'LAGOON WEATHER',
    });
  });

  it('a missing or unreadable field is no weather at all, never 0°', () => {
    expect(decodeWeather({ current: { weather_code: 0 } })).toBeNull();
    expect(decodeWeather({ current: { temperature_2m: 5 } })).toBeNull();
    expect(decodeWeather({ current: { temperature_2m: '5', weather_code: 0 } })).toBeNull();
    expect(decodeWeather({ current: { temperature_2m: 5, weather_code: 1.5 } })).toBeNull();
    expect(decodeWeather({})).toBeNull();
    expect(decodeWeather(null)).toBeNull();
  });
});

describe('fetchWeather', () => {
  it('asks Open-Meteo for Reykjavík centre, never the phone’s position', async () => {
    let asked: URL | null = null;
    server.use(
      http.get(FORECAST, ({ request }) => {
        asked = new URL(request.url);
        return HttpResponse.json({ current: { temperature_2m: 11.6, weather_code: 0 } });
      }),
    );
    expect(await fetchWeather()).toMatchObject({ temperature: 12, condition: 'SUNNY', recommendation: 'OUTDOOR POOL WEATHER' });
    expect(asked!.toString()).toBe(WEATHER_URL);
    expect(asked!.searchParams.get('latitude')).toBe('64.1466');
    expect(asked!.searchParams.get('longitude')).toBe('-21.9426');
  });

  it('hides the line on a non-200 answer, an unreadable body or no network', async () => {
    server.use(http.get(FORECAST, () => HttpResponse.json({ error: true }, { status: 503 })));
    expect(await fetchWeather()).toBeNull();
    server.use(http.get(FORECAST, () => new HttpResponse('<html>', { status: 200 })));
    expect(await fetchWeather()).toBeNull();
    server.use(http.get(FORECAST, () => HttpResponse.error()));
    expect(await fetchWeather()).toBeNull();
  });
});
