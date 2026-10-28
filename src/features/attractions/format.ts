/**
 * How the sights' figures read: the formatting helpers of iOS
 * AttractionDetailView (`formatDistance`, `formatDuration`, `kilometres`,
 * `isk`, `lengthText`, `walkTimeText`, `trailFacts`) and HomeOutsideCard
 * (`distanceLabel`).
 *
 * Fixed point with a "." everywhere iOS uses `String(format:)`, which ignores
 * the phone's locale (the Icelandic comma only where iOS writes one:
 * `roadKilometres`, ./model.ts). Money is "ISK 10,100" in both languages, as
 * on the web: a locale-grouped "ISK 10.100" reads as ten point one.
 */
import type { AttractionPairing, AttractionTrailLink } from '../../api/attractions';
import { iskPrefix, type Params } from '../../i18n';
import { printfFixed, roundHalfAwayFromZero } from '../../i18n/format';

/** `t` in the language on screen. */
export type Translate = (key: string, params?: Params) => string;

/** A walk's length or a neighbour's distance: "850 m", "1.2 km", "12.4 km" (always one decimal from 1 km). */
export function sightDistance(metres: number): string {
  return metres >= 1000 ? `${printfFixed(metres / 1000, 1)} km` : `${metres} m`;
}

/** "45 min", "2 h", "1 h 8 min" ("mín" and "klst" in Icelandic). */
export function sightDuration(minutes: number, t: Translate): string {
  const h = Math.trunc(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} ${t('attraction.minutes_short')}`;
  if (m === 0) return `${h} ${t('attraction.hours_short')}`;
  return `${h} ${t('attraction.hours_short')} ${m} ${t('attraction.minutes_short')}`;
}

/** The drive line's kilometres: one decimal near town, whole kilometres beyond. */
export function driveKilometres(km: number): string {
  return km < 10 ? printfFixed(km, 1) : printfFixed(km, 0);
}

/** "{duration} drive from Reykjavík · {km} km". */
export function driveLine(drive: { readonly minutes: number; readonly km: number }, t: Translate): string {
  return t('attraction.drive_from_reykjavik', { duration: sightDuration(drive.minutes, t), km: driveKilometres(drive.km) });
}

/**
 * A walk's length as the card prints it. On an out-and-back walk the stored
 * length is one way while the stored time already covers the return, so each
 * figure names which it is; bare, "7 km" over "3 h" reads as a 7 km walk
 * taking three hours. The facts and the link rows share these.
 */
export function lengthText(metres: number, outAndBack: boolean, t: Translate): string {
  const distance = sightDistance(metres);
  return outAndBack ? t('attraction.one_way', { distance }) : distance;
}

export function walkTimeText(minutes: number, outAndBack: boolean, t: Translate): string {
  const duration = sightDuration(minutes, t);
  return outAndBack ? t('attraction.there_and_back', { duration }) : duration;
}

/** A walk link's facts, "7.1 km one way · 3 h there and back", or null with neither figure. */
export function trailFacts(link: Pick<AttractionTrailLink, 'lengthM' | 'durationMinutes' | 'outAndBack'>, t: Translate): string | null {
  const parts: string[] = [];
  if (link.lengthM !== null) parts.push(lengthText(link.lengthM, link.outAndBack, t));
  if (link.durationMinutes !== null) parts.push(walkTimeText(link.durationMinutes, link.outAndBack, t));
  return parts.length ? parts.join(' · ') : null;
}

/** "Photo: {credit} · {license}" ("Map: …" for a plate): generated from the row, never typed. */
export function creditLine(label: string, credit: string, license: string): string {
  return `${label}: ${credit} · ${license}`;
}

/** "Parking fee: ISK 1,000". */
export function parkingFeeLine(fee: number, t: Translate): string {
  return `${t('attraction.parking_fee')}: ${iskPrefix(fee)}`;
}

/** "65 min drive". */
export function pairingDriveText(pairing: Pick<AttractionPairing, 'driveMinutes'>, t: Translate): string {
  return `${pairing.driveMinutes} ${t('attraction.min_drive')}`;
}

/**
 * A soak row's money line. "Included on any LifePass" ONLY when a pass covers
 * the venue outright (`inBundle`); otherwise the server's from-price, "ISK
 * 4,800 per visit with LifePass", or just "per visit with LifePass" without
 * one. Premium venues and lagoons must never read as included, and the price
 * is never computed on the phone.
 */
export function pairingPriceText(pairing: Pick<AttractionPairing, 'inBundle' | 'fromPriceIsk'>, t: Translate): string {
  if (pairing.inBundle) return t('attraction.included');
  if (pairing.fromPriceIsk !== null) return `${iskPrefix(pairing.fromPriceIsk)} ${t('attraction.per_visit')}`;
  return t('attraction.per_visit');
}

/** Home's straight-line distance column: "350 m", "4.2 km", "42 km", with a point in both languages. */
export function homeDistanceLabel(metres: number): string {
  if (metres < 1000) return `${roundHalfAwayFromZero(metres)} m`;
  if (metres < 10_000) return `${printfFixed(metres / 1000, 1)} km`;
  return `${printfFixed(metres / 1000, 0)} km`;
}
