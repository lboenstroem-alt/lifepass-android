// Real Reykjavík weather for the Home hero: the Android port of iOS
// `HomeWeather` and `HomeWeatherService` (Views/Home/HomeView.swift).
//
// Open-Meteo's current conditions for Reykjavík centre: free, no key, and
// nothing about the member is sent (the coordinates are the city's, never the
// phone's). Any failure, a non-200 answer or a body that does not read hides
// the line: `fetchWeather` answers null, never a made-up 0°.
//
// ENGLISH FOR EVERY ACCOUNT (owner decision D7): iOS hard-codes this line in
// English, Icelandic accounts included, so the words below are not copy keys.
import { wholeNumberOf } from '../i18n/format';

/** Reykjavík centre (iOS `HomeWeatherService.lat/lon`). */
export const WEATHER_LATITUDE = 64.1466;
export const WEATHER_LONGITUDE = -21.9426;

export const WEATHER_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LATITUDE}&longitude=${WEATHER_LONGITUDE}` +
  '&current=temperature_2m,weather_code&temperature_unit=celsius';

/** iOS `Sky`: the seven kinds of sky the line tells apart. */
export type Sky = 'sunny' | 'partlySunny' | 'cloudy' | 'foggy' | 'rainy' | 'snow' | 'storm';

/**
 * The glyph for each sky, from MaterialCommunityIcons (the SF Symbols iOS
 * draws: sun.max.fill, cloud.sun.fill, cloud.fill, cloud.fog.fill,
 * cloud.rain.fill, snowflake, cloud.bolt.fill).
 */
export type WeatherIconName =
  | 'weather-sunny'
  | 'weather-partly-cloudy'
  | 'weather-cloudy'
  | 'weather-fog'
  | 'weather-rainy'
  | 'snowflake'
  | 'weather-lightning';

export interface WeatherSnapshot {
  /** °C, rounded half away from zero, as Swift's `Int(x.rounded())` (never -0). */
  readonly temperature: number;
  /** "SUNNY", "CLOUDY", ... */
  readonly condition: string;
  readonly icon: WeatherIconName;
  /** "OUTDOOR POOL WEATHER", ... */
  readonly recommendation: string;
}

/** WMO weather interpretation codes, as Open-Meteo sends them (iOS `classify`). */
export function classifySky(code: number): Sky {
  if (code === 0) return 'sunny';
  if (code === 1 || code === 2 || code === 3) return 'partlySunny';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 51 && code <= 67) return 'rainy';
  if (code >= 71 && code <= 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}

export function skyCondition(sky: Sky): string {
  switch (sky) {
    case 'sunny':
      return 'SUNNY';
    case 'partlySunny':
    case 'cloudy':
      return 'CLOUDY';
    case 'foggy':
      return 'FOGGY';
    case 'rainy':
      return 'RAINY';
    case 'snow':
      return 'SNOWING';
    case 'storm':
      return 'STORMY';
  }
}

export function skyIcon(sky: Sky): WeatherIconName {
  switch (sky) {
    case 'sunny':
      return 'weather-sunny';
    case 'partlySunny':
      return 'weather-partly-cloudy';
    case 'cloudy':
      return 'weather-cloudy';
    case 'foggy':
      return 'weather-fog';
    case 'rainy':
      return 'weather-rainy';
    case 'snow':
      return 'snowflake';
    case 'storm':
      return 'weather-lightning';
  }
}

/** What to do with the day (iOS `recommendation`); `temperature` is the rounded °C. */
export function weatherRecommendation(sky: Sky, temperature: number): string {
  switch (sky) {
    case 'storm':
      return 'STAY IN — SAUNA DAY';
    case 'snow':
      return 'HOT SPRING WEATHER';
    case 'rainy':
      return 'LAGOON WEATHER';
    case 'sunny':
      if (temperature >= 15) return 'PERFECT FOR OUTDOORS';
      if (temperature >= 5) return 'OUTDOOR POOL WEATHER';
      return 'HOT SPRING WEATHER';
    case 'partlySunny':
      if (temperature >= 10) return 'OUTDOOR POOL WEATHER';
      if (temperature >= 5) return 'SPA & HOT SPRING DAY';
      return 'HOT SPRING WEATHER';
    case 'cloudy':
    case 'foggy':
      if (temperature >= 10) return 'INDOOR POOL WEATHER';
      if (temperature >= 5) return 'SPA & SAUNA WEATHER';
      if (temperature < 0) return 'HOT SPRING WEATHER';
      return 'INDOOR & SAUNA DAY';
  }
}

/** The snapshot for a WMO code and a temperature in °C. */
export function weatherFrom(code: number, temperatureC: number): WeatherSnapshot {
  const sky = classifySky(code);
  const temperature = wholeNumberOf(temperatureC);
  return {
    temperature,
    condition: skyCondition(sky),
    icon: skyIcon(sky),
    recommendation: weatherRecommendation(sky, temperature),
  };
}

/**
 * Reads Open-Meteo's answer as iOS's `Decodable` does: `current.temperature_2m`
 * a number and `current.weather_code` a whole number, or null.
 */
export function decodeWeather(body: unknown): WeatherSnapshot | null {
  if (typeof body !== 'object' || body === null) return null;
  const current = (body as { current?: unknown }).current;
  if (typeof current !== 'object' || current === null) return null;
  const { temperature_2m: temperature, weather_code: code } = current as Record<string, unknown>;
  if (typeof temperature !== 'number' || !Number.isFinite(temperature)) return null;
  if (typeof code !== 'number' || !Number.isInteger(code)) return null;
  return weatherFrom(code, temperature);
}

/** The line's text: "CLOUDY · 7° · SPA & SAUNA WEATHER". */
export function weatherLine(weather: WeatherSnapshot): string {
  return `${weather.condition} · ${weather.temperature}° · ${weather.recommendation}`;
}

/** Current Reykjavík weather, or null on any failure (the line is then hidden). Never throws. */
export async function fetchWeather(options: { signal?: AbortSignal } = {}): Promise<WeatherSnapshot | null> {
  try {
    const response = await fetch(WEATHER_URL, { signal: options.signal });
    if (response.status !== 200) return null;
    return decodeWeather(await response.json());
  } catch {
    return null;
  }
}
