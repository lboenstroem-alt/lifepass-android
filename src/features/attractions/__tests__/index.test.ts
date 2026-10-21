/**
 * The door other features use (COACH-3's plan sights, PLAN-2's hike rows):
 * light enough to import without the map or the icon fonts, and carrying
 * the pieces those rows draw a sight with.
 */
import * as attractions from '..';
import { translate } from '../../../i18n';

const en = (key: string) => translate(key, 'en');

it('exports the ring, the labels, the lossy reads and the plate rule', () => {
  expect(typeof attractions.AttractionRing).toBe('function');
  expect(attractions.kindRegionLine({ kind: 'waterfall', region: 'south' }, en)).toBe('Waterfall · South Iceland');
  expect(attractions.parseAttractionDrive({ minutes: 0.4, km: 2 })).toBeNull();
  expect(attractions.parseRoadAccess('ferry')).toBe('ferry');
  expect(attractions.roadDriveFromReykjavik({ roadAccess: 'ferry', driveFromReykjavik: { minutes: 40, km: 30 } })).toBeNull();
  expect(attractions.isPlateImageUrl('/api/v1/attractions/plate/x')).toBe(true);
  expect(attractions.PLATE_PAPER).toBe('#F7F5F0');
  expect(attractions.sightDuration(80, en)).toBe('1 h 20 min');
  expect(attractions.ATTRACTION_CREDITS_URL).toBe('https://www.lifepass.is/attractions/credits');
});
