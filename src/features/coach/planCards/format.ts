/**
 * What the plan cards print, as pure functions (iOS CoachPlanView.swift's
 * `PlanClassCard.whenLine`, `PlanSightCard.creditLine`, `kindAndRegion` and
 * `travelLine`), so the honesty rules are tested without drawing anything.
 */
import { addServerDays, classShortDay, serverDay, todayServerDay, venueTime } from '../../../i18n/format';
import type { Lang, Params } from '../../../i18n';
import type { CoachPlanClass } from '../../classes/sheet';
import { drawableSightImageUrl, isPlateImageUrl, roadDriveFromReykjavik, sightDuration } from '../../attractions';
import type { CoachPlanDistance, CoachPlanSight } from '../dayPlan/decode';

type Translate = (key: string, params?: Params) => string;

/**
 * "Today · 18:00–19:00", "Tomorrow · 07:30", "Sat 20 Sept · 10:00–11:00" /
 * "lau. 20. sep. · 10:00–11:00": in Iceland time like every other class
 * time in the app, whatever zone the phone is in.
 */
export function classWhenLine(
  session: Pick<CoachPlanClass, 'startsAt' | 'endsAt'>,
  language: Lang,
  t: Translate,
  now: Date = new Date(),
): string {
  let times = venueTime(session.startsAt);
  if (session.endsAt) times += `–${venueTime(session.endsAt)}`;
  return `${classDayLabel(session.startsAt, language, t, now)} · ${times}`;
}

/** "Today", "Tomorrow", or the short day, on the Reykjavík calendar. */
export function classDayLabel(startsAt: Date, language: Lang, t: Translate, now: Date = new Date()): string {
  const day = serverDay(startsAt);
  const today = todayServerDay(now);
  if (day === today) return t('library.today');
  if (day === addServerDays(today, 1)) return t('library.tomorrow');
  return classShortDay(startsAt, language);
}

/** The plate is a map the app draws, shown whole on its paper and never credited as a photo. */
export function isPlanSightPlate(sight: Pick<CoachPlanSight, 'imageUrl'>): boolean {
  return isPlateImageUrl(sight.imageUrl);
}

/** What the card may draw: the plate, or a photograph that arrived with its photographer; else null (the ring). */
export function planSightImageUrl(sight: Pick<CoachPlanSight, 'imageUrl' | 'imageCredit'>): string | null {
  return drawableSightImageUrl(sight.imageUrl, sight.imageCredit);
}

/**
 * "Photo: {credit}", only for a photograph on screen: the plate is
 * generated, and a photo that failed to load is not there to credit.
 */
export function planSightCreditLine(
  sight: Pick<CoachPlanSight, 'imageUrl' | 'imageCredit'>,
  photoFailed: boolean,
  t: Translate,
): string | null {
  if (photoFailed || isPlanSightPlate(sight) || planSightImageUrl(sight) === null || !sight.imageCredit) return null;
  return `${t('attraction.photo')}: ${sight.imageCredit}`;
}

/**
 * The icon beside a travel line (iOS SF Symbols in brackets):
 * - `drive`: a measured drive, the filled car (`car.fill`), and only that;
 * - `straight`: a straight line, the location arrow (`location`), never a car;
 * - `road`: the usual road time from Reykjavík, the outline car (`car`);
 * - `ferry`: reached by ferry (`ferry`).
 */
export type TravelIcon = 'drive' | 'straight' | 'road' | 'ferry';

export interface TravelLine {
  readonly text: string;
  readonly icon: TravelIcon;
}

/** The icon for a step's own distance (iOS `DistanceLine`): a straight line never gets a car. */
export function distanceIcon(basis: CoachPlanDistance['basis'] | null | undefined): TravelIcon {
  return basis === 'drive' ? 'drive' : 'straight';
}

/**
 * A sight card's travel line, in priority order (iOS `travelLine`): the
 * step's own distance; else a ferry sight's "Reached by ferry"; else the
 * road time from Reykjavík, only where a road actually goes. Null for none
 * (an unknown or offshore access, or no figure).
 */
export function planSightTravelLine(
  sight: Pick<CoachPlanSight, 'roadAccess' | 'driveFromReykjavik'>,
  distanceLabel: string | null,
  basis: CoachPlanDistance['basis'] | null | undefined,
  t: Translate,
): TravelLine | null {
  if (distanceLabel) return { text: distanceLabel, icon: distanceIcon(basis) };
  if (sight.roadAccess === 'ferry') return { text: t('attraction.ferry_no_port'), icon: 'ferry' };
  const drive = roadDriveFromReykjavik(sight);
  if (drive) return { text: t('coach.plan.sight.from_reykjavik', { duration: sightDuration(drive.minutes, t) }), icon: 'road' };
  return null;
}
