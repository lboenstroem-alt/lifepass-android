/* eslint lifepass/no-literal-copy: "error" */
/**
 * Directions to a venue: the Android equivalent of iOS's "Get directions"
 * dialog (VenueDetailView `directionsButtons`, plan 5.6).
 *
 * iOS offers Apple Maps and Google Maps. A phone running Android has no Apple
 * Maps, so the dialog offers:
 *   - "Open in Google Maps": the universal Google Maps directions URL, which
 *     the Maps app takes over when it is installed (and a browser opens when
 *     it is not), in driving mode as iOS asks;
 *   - "Open in another app": a `geo:` link, which Android hands to whichever
 *     maps app the member uses (Waze, Organic Maps, ...), asking which one
 *     when there is no default.
 * Coordinates are preferred over the address, as on iOS: a position cannot be
 * misread by a geocoder. No app for `geo:` at all (rare) falls back to Google
 * Maps on the web, so the button never does nothing.
 */
import { Linking } from 'react-native';

import type { Venue } from '../../types/venue';

type Place = Pick<Venue, 'name' | 'address' | 'latitude' | 'longitude'>;

/** The destination as Google takes it: "lat,lng", else the address, else null (no directions). */
export function directionsDestination(venue: Place): string | null {
  if (venue.latitude !== null && venue.longitude !== null) return `${venue.latitude},${venue.longitude}`;
  if (venue.address) return encodeURIComponent(venue.address);
  return null;
}

/** `https://www.google.com/maps/dir/?api=1&destination=…&travelmode=driving` (iOS's web fallback, in driving mode). */
export function googleMapsDirectionsUrl(venue: Place): string | null {
  const destination = directionsDestination(venue);
  if (destination === null) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
}

/**
 * A `geo:` link for any maps app: a labelled pin at the coordinates
 * (`geo:lat,lng?q=lat,lng(Name)`), or a search for the address
 * (`geo:0,0?q=Address`).
 */
export function geoUrl(venue: Place): string | null {
  if (venue.latitude !== null && venue.longitude !== null) {
    const at = `${venue.latitude},${venue.longitude}`;
    return `geo:${at}?q=${at}(${encodeURIComponent(venue.name)})`;
  }
  if (venue.address) return `geo:0,0?q=${encodeURIComponent(venue.address)}`;
  return null;
}

/** Opens a URL, swallowing the rejection a missing handler gives (nothing to show the member). */
async function open(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** "Open in Google Maps". */
export async function openInGoogleMaps(venue: Place): Promise<void> {
  const url = googleMapsDirectionsUrl(venue);
  if (url) await open(url);
}

/** "Open in another app": the `geo:` link, or Google Maps when no app takes it. */
export async function openInOtherMapsApp(venue: Place): Promise<void> {
  const url = geoUrl(venue);
  if (!url) return;
  if (await open(url)) return;
  await openInGoogleMaps(venue);
}
