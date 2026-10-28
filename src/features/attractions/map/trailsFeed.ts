/**
 * The hiking trails feed for the Explore map (`GET /attractions/trails`), the
 * port of iOS MapViewModel's `loadTrails` and `trailsRetryAfter`.
 *
 * The heavy half of the sights layer (full route geometry), kept apart from
 * the markers: a failure here must never cost the member the rings, which are
 * what they tap. So it is silent on failure, like the markers, and it is only
 * asked for once the markers have loaded (the caller's rule).
 *
 * After a failed request the next one waits TEN MINUTES. The wait lives here,
 * at module scope, rather than with the map: the map is made afresh on every
 * visit to the Explore tab, and kept on the map a tab switch would forget the
 * failure and ask again at once (iOS keeps it static for the same reason).
 * Ten minutes rides out a web release that has not shipped the endpoint and a
 * dropped signal. A 404, a 503, no connection and a body that did not decode
 * are all the same to the map (nothing to draw, nothing permanent), so every
 * failure waits; a cancelled request is not a failure and waits for nothing.
 *
 * A second caller joins the request already out. The lines themselves are
 * held by the map that asked (iOS keeps them on the view model, so a new
 * visit reads them again and a map that is gone frees them).
 */
import { fetchAttractionTrails, type AttractionTrailPage } from '../../../api/attractions';
import { isCancellation } from '../../../api';

/** How long a failed trails request holds off the next one. */
export const TRAILS_RETRY_INTERVAL_MS = 10 * 60 * 1000;

let retryAfter: number | null = null;
let inFlight: Promise<AttractionTrailPage | null> | null = null;

/**
 * The trails, or null when there are none to draw this time: a failure, or a
 * failure less than ten minutes ago (then nothing is asked). Never rejects.
 */
export function loadTrailsFeed(now: () => number = Date.now): Promise<AttractionTrailPage | null> {
  if (inFlight) return inFlight;
  if (retryAfter !== null && retryAfter > now()) return Promise.resolve(null);
  // Every step runs after this function returns, so `inFlight` is set before
  // the request can settle and clear it.
  const request = Promise.resolve()
    .then(() => fetchAttractionTrails())
    .then(
      (page): AttractionTrailPage | null => {
        retryAfter = null;
        return page;
      },
      (error: unknown) => {
        if (!isCancellation(error)) retryAfter = now() + TRAILS_RETRY_INTERVAL_MS;
        return null;
      },
    )
    .then((page) => {
      inFlight = null;
      return page;
    });
  inFlight = request;
  return request;
}

/** Tests: forget the wait and any request on its way. */
export function resetTrailsFeed(): void {
  retryAfter = null;
  inFlight = null;
}
