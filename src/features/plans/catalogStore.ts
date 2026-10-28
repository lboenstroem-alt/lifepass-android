/**
 * The catalogue the Plans screen is showing: iOS `PlansViewModel.catalog` and
 * `loadCatalog()`, in a small store so the screen, its info sheet and the
 * checkout (which re-reads it after `product_not_on_sale`) share one value.
 *
 * ONE PER VISIT. iOS builds a fresh view model each time the plans sheet
 * opens, so every visit starts with no catalogue (the built-in passes without
 * those off sale, no prices) until its own read answers. The screen does the
 * same here: `resetPlanCatalog()` when it opens and when it closes, so a
 * price read an hour ago is never shown as today's (a price that differs from
 * the website's is worse than none).
 *
 * BEST EFFORT AND SILENT. A failure must never stop the plans screen
 * rendering, so it is swallowed and the cards simply show no price; there is
 * nothing the member can do about it, and an alert over a missing price
 * would be noise on top of a screen that still works. A re-read that fails
 * keeps the catalogue already on screen: the cards must not fall back to the
 * built-in pass list (which still has passes taken off sale) because one
 * refresh did not answer.
 *
 * A read still out when the visit ends is abandoned (iOS's `.task` is
 * cancelled when the sheet goes): nobody is left to show its answer.
 */
import { create } from 'zustand';

import { fetchPlanCatalog, type PlanCatalog } from './catalog';

interface CatalogState {
  /** Null until a read has answered this visit; kept through a failed re-read. */
  readonly catalog: PlanCatalog | null;
}

const useCatalogStore = create<CatalogState>()(() => ({ catalog: null }));

/** Bumped by every reset: an answer for an earlier visit is dropped. */
let visit = 0;
/** Cancels the reads of the visit on screen; aborted (and replaced) by every reset. */
let visitReads: AbortController | null = null;
/** The newest read whose answer has been applied this visit (a slower, older answer never replaces it). */
let appliedRead = 0;
let reads = 0;

/** The catalogue on screen (re-renders when it changes). */
export function usePlanCatalog(): PlanCatalog | null {
  return useCatalogStore((state) => state.catalog);
}

/** The catalogue on screen, outside React. */
export function currentPlanCatalog(): PlanCatalog | null {
  return useCatalogStore.getState().catalog;
}

/**
 * `GET /catalog/plans` into the store. Never throws; resolves once the read
 * has answered (or failed), so a caller (or a test) can wait for it.
 */
export async function loadPlanCatalog(): Promise<void> {
  const myVisit = visit;
  reads += 1;
  const myRead = reads;
  visitReads ??= new AbortController();
  try {
    const fresh = await fetchPlanCatalog({ signal: visitReads.signal });
    if (myVisit !== visit || myRead < appliedRead) return;
    appliedRead = myRead;
    useCatalogStore.setState({ catalog: fresh });
  } catch {
    // No prices this time; whatever is on screen stays (see the file comment).
  }
}

/** A new visit (or the end of one): no catalogue, and any read still out is dropped. */
export function resetPlanCatalog(): void {
  visitReads?.abort();
  visitReads = null;
  visit += 1;
  appliedRead = reads;
  useCatalogStore.setState({ catalog: null });
}

/** Puts a catalogue on screen directly (tests and dev screens; the app reads it). */
export function setPlanCatalogForTests(catalog: PlanCatalog | null): void {
  useCatalogStore.setState({ catalog });
}
