/**
 * What the sights say on the map and in search, from the generated iOS keys.
 */
import type { AttractionMarker } from '../../../api/attractions';
import { isHike } from '../model';
import { kindLabel, regionLabel, type Lookup } from '../rules';

/** A ring as a screen reader says it: "{name}, Top pick, Trailhead" as applicable (iOS `sightAccessibilityLabel`). */
export function sightAccessibilityLabel(sight: Pick<AttractionMarker, 'tier' | 'kind'>, name: string, t: Lookup): string {
  const parts = [name];
  if (sight.tier === 'top') parts.push(t('attraction.top_pick'));
  if (isHike(sight)) parts.push(t('attraction.trailhead'));
  return parts.join(', ');
}

/**
 * A search row's detail line, "Waterfall · South Iceland · Top pick" (iOS
 * `sightDetailLine`): the kind from the app's dictionary ("Sight" for one this
 * build does not know), the region when known, and "Top pick" for one.
 */
export function sightDetailLine(sight: Pick<AttractionMarker, 'tier' | 'kind' | 'region'>, t: Lookup): string {
  const parts = [kindLabel(sight.kind, t)];
  const region = regionLabel(sight.region, t);
  if (region !== null) parts.push(region);
  if (sight.tier === 'top') parts.push(t('attraction.top_pick'));
  return parts.join(' · ');
}
