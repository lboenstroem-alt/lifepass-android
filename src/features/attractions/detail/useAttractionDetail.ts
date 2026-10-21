/**
 * Loading one sight's card (iOS AttractionDetailView `load()`).
 *
 *   - `GET /attractions/by-slug/{slug}?locale=` in the account language.
 *   - While nothing is loaded: the spinner; a failure then is the failed
 *     state, with the formatted reason and "Try again".
 *   - iOS loads in `.task`, which runs again whenever the card reappears (back
 *     from a nearby sight, a walk or a soak venue pushed on top of it).
 *     `refresh()` is that second read: the card stays on screen while it
 *     reads, and a failure keeps it, as iOS keeps `detail` and only shows the
 *     error while there is none.
 *   - The data belongs to one slug: a card given another sight in place drops
 *     the previous one at once, so one sight's facts never show under
 *     another's name.
 *   - Only the latest read lands: a retry, a new slug or the card closing
 *     cancels a read still on its way, and a cancelled read says nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchAttractionDetail, type AttractionDetail } from '../../../api/attractions';
import { errorMessage } from '../../../api/errorFormatter';
import { isCancellation } from '../../../api/errors';
import type { Lang } from '../../../i18n';

export interface AttractionDetailState {
  readonly detail: AttractionDetail | null;
  readonly isLoading: boolean;
  /** The failed state's reason, in the language on screen when it failed. */
  readonly error: string | null;
}

interface Held extends AttractionDetailState {
  readonly slug: string;
}

const fresh = (slug: string): Held => ({ slug, detail: null, isLoading: true, error: null });

export function useAttractionDetail(
  slug: string,
  language: Lang,
): AttractionDetailState & { readonly load: () => void; readonly refresh: () => void } {
  const [held, setHeld] = useState<Held>(() => fresh(slug));
  // A new slug starts from nothing, during render, so the old card never
  // shows for a frame under the new route.
  const current = held.slug === slug ? held : fresh(slug);
  if (held.slug !== slug) setHeld(current);

  const inFlight = useRef<AbortController | null>(null);

  const read = useCallback(
    async (quiet: boolean) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      if (!quiet) setHeld((state) => (state.slug === slug ? { ...state, isLoading: true, error: null } : fresh(slug)));
      try {
        const detail = await fetchAttractionDetail(slug, language, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setHeld({ slug, detail, isLoading: false, error: null });
      } catch (error) {
        if (controller.signal.aborted || isCancellation(error)) return;
        // With a card on screen, a failed refresh keeps it (iOS shows the
        // error only while there is no detail).
        setHeld((state) =>
          state.slug === slug ? { ...state, isLoading: false, error: state.detail ? null : errorMessage(error) } : state,
        );
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
      }
    },
    [slug, language],
  );

  useEffect(() => {
    void read(false);
    return () => inFlight.current?.abort();
  }, [read]);

  const load = useCallback(() => void read(false), [read]);
  const refresh = useCallback(() => void read(true), [read]);

  return { detail: current.detail, isLoading: current.isLoading, error: current.error, load, refresh };
}
