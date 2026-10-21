/**
 * The sights' copy (iOS Localization.swift `attraction.*`, LocalizationKeyTests
 * and LocalizationDashTests style): every key in both languages with its
 * placeholders, the kind and region dictionaries word for word the server's,
 * and the Android-only words in ATTR-1's pack.
 */
import { hasKey, lookup } from '../../../i18n';
import en from '../../../i18n/strings.en.json';
import is from '../../../i18n/strings.is.json';
import pack from '../../../i18n/android/ATTR-1';

const tables = { en: en as Record<string, string>, is: is as Record<string, string> };

const attractionKeys = (table: Record<string, string>) => Object.keys(table).filter((key) => key.startsWith('attraction.')).sort();

const KINDS = [
  'waterfall',
  'hot_spring',
  'geyser',
  'hike',
  'viewpoint',
  'canyon',
  'glacier',
  'beach',
  'cave',
  'volcano',
  'lake',
  'geothermal_area',
  'national_park',
  'nature_reserve',
  'mountain',
  'lighthouse',
  'other',
];
const REGIONS = ['capital', 'reykjanes', 'south', 'west', 'westfjords', 'north', 'east', 'highlands'];

it('has the same attraction keys in English and Icelandic', () => {
  expect(attractionKeys(tables.en)).toEqual(attractionKeys(tables.is));
  expect(attractionKeys(tables.en).length).toBeGreaterThan(70);
});

it('has every kind and region of the API’s enums in both languages', () => {
  for (const kind of KINDS) expect(hasKey(`attraction.kind.${kind}`)).toBe(true);
  for (const region of REGIONS) expect(hasKey(`attraction.region.${region}`)).toBe(true);
  expect(lookup('attraction.kind.geyser', 'is')).toBe('Goshver');
  expect(lookup('attraction.region.highlands', 'en')).toBe('The Highlands');
});

it('keeps every placeholder in Icelandic', () => {
  for (const key of attractionKeys(tables.en)) {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    expect([key, placeholders(tables.is[key])]).toEqual([key, placeholders(tables.en[key])]);
  }
  expect(tables.is['attraction.drive_from_reykjavik']).toContain('{duration}');
  expect(tables.is['attraction.drive_from_reykjavik']).toContain('{km}');
});

it('calls a top pick a top pick, never "Mælt með"', () => {
  expect(lookup('attraction.top_pick', 'en')).toBe('Top pick');
  expect(lookup('attraction.top_pick', 'is')).toBe('Hápunktur');
});

it('words the Android-only directions answer in both languages, without dashes', () => {
  expect(Object.keys(pack.en).sort()).toEqual(Object.keys(pack.is).sort());
  expect(lookup('attraction.android.maps_other', 'en')).toBe('Open in another app');
  expect(lookup('attraction.android.maps_other', 'is')).toBe('Opna í öðru forriti');
  for (const value of [...Object.values(pack.en), ...Object.values(pack.is)]) {
    expect(value).not.toMatch(/[–—]/);
  }
});
