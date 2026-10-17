/**
 * Loads the purchase history a page at a time: the Android port of iOS
 * `ReceiptsViewModel` (Views/Profile/ReceiptsView.swift).
 *
 * THE RULE THE SCREEN EXISTS FOR. It must never tell a paying member they
 * have no purchases when it simply could not read them. Before iOS 2.5.0 the
 * screen said "No receipts yet" to everyone, paying members included. Now:
 *   - only a SUCCESSFUL empty answer is "No purchases yet" (`loaded` with no
 *     rows);
 *   - a 404 (the route not deployed on this server, including an edge 404
 *     with an HTML body) is `unavailable`: the history is on the website;
 *   - offline, a 5xx or a body the app cannot read is `failed`: the same
 *     website link, plus Try again.
 *
 * Paging: "Show more" sends the server's opaque cursor back unchanged and
 * drops rows already shown (by id). A cursor the server no longer accepts
 * (`400 invalid-cursor`) starts again from the top; any other failure while
 * loading more keeps the list and the button, for a retry.
 *
 * A plain object with `subscribe`/`getSnapshot` (React reads it through
 * `useSyncExternalStore`), so the tests drive it exactly as iOS's tests
 * drive the view model.
 */
import { isApiError, isCancellation, isProblem } from '../../../api/errors';
import { fetchPurchases, type Purchase, type PurchasesPage } from '../../../api/purchases';

export type ReceiptsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly purchases: readonly Purchase[] }
  /** The server has no purchase history route yet (404). */
  | { readonly kind: 'unavailable' }
  /** Offline, a server error, a body the app cannot read. */
  | { readonly kind: 'failed' };

export interface ReceiptsSnapshot {
  readonly state: ReceiptsState;
  /** "Show more" shows: the server said there is more AND gave a cursor to ask with. */
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
}

/** The website's purchase history, where both fallbacks send the member. */
export const WEB_PURCHASES_URL = 'https://www.lifepass.is/purchases';

/**
 * The status line under the amount. Pending is "Not paid": a checkout that
 * was started is not a receipt. A status a newer server adds shows no line
 * rather than a guess.
 */
export function receiptStatusKey(status: string): string | null {
  switch (status) {
    case 'paid':
    case 'fulfilled':
      return 'receipts.status.paid';
    case 'pending':
      return 'receipts.status.pending';
    case 'cancelled':
      return 'receipts.status.cancelled';
    case 'refunded':
      return 'receipts.status.refunded';
    default:
      return null;
  }
}

/** How a page is read; the app's is `fetchPurchases`, a test may pass its own. */
export type FetchPurchases = (options: { cursor?: string | null; signal?: AbortSignal }) => Promise<PurchasesPage>;

export class ReceiptsViewModel {
  private snapshot: ReceiptsSnapshot = { state: { kind: 'loading' }, hasMore: false, isLoadingMore: false };
  private nextCursor: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly controller = new AbortController();
  /**
   * Bumped by every `load`: a page that answers after a newer load started
   * (a pull to refresh during "Show more") is dropped, so an old list never
   * replaces the fresh one.
   */
  private generation = 0;

  constructor(private readonly fetchPage: FetchPurchases = fetchPurchases) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): ReceiptsSnapshot => this.snapshot;

  get state(): ReceiptsState {
    return this.snapshot.state;
  }

  get hasMore(): boolean {
    return this.snapshot.hasMore;
  }

  get isLoadingMore(): boolean {
    return this.snapshot.isLoadingMore;
  }

  /** The screen went away: in-flight reads are cancelled and their answers ignored. */
  dispose(): void {
    this.controller.abort();
    this.listeners.clear();
  }

  private update(next: Partial<ReceiptsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of [...this.listeners]) listener();
  }

  private applyPage(page: PurchasesPage, purchases: readonly Purchase[]): void {
    this.nextCursor = page.pagination.nextCursor;
    this.update({
      state: { kind: 'loaded', purchases },
      hasMore: page.pagination.hasMore && this.nextCursor !== null,
    });
  }

  /**
   * The first page. A list already on screen stays while it reloads (pull to
   * refresh); anything else shows the spinner.
   */
  async load(): Promise<void> {
    const generation = ++this.generation;
    if (this.snapshot.state.kind !== 'loaded') this.update({ state: { kind: 'loading' } });
    try {
      const page = await this.fetchPage({ signal: this.controller.signal });
      if (generation !== this.generation || this.controller.signal.aborted) return;
      this.applyPage(page, page.data);
    } catch (error) {
      if (generation !== this.generation || this.controller.signal.aborted || isCancellation(error)) return;
      const unavailable = isApiError(error) && error.status === 404;
      this.update({ state: { kind: unavailable ? 'unavailable' : 'failed' }, hasMore: false });
    }
  }

  /** The next page, under the server's cursor; rows already shown are not repeated. */
  async loadMore(): Promise<void> {
    const cursor = this.nextCursor;
    const shown = this.snapshot.state;
    if (!this.snapshot.hasMore || this.snapshot.isLoadingMore || cursor === null || shown.kind !== 'loaded') return;
    const generation = this.generation;
    this.update({ isLoadingMore: true });
    try {
      const page = await this.fetchPage({ cursor, signal: this.controller.signal });
      if (generation !== this.generation || this.controller.signal.aborted) return;
      const known = new Set(shown.purchases.map((purchase) => purchase.id));
      this.applyPage(page, [...shown.purchases, ...page.data.filter((purchase) => !known.has(purchase.id))]);
    } catch (error) {
      if (generation !== this.generation || this.controller.signal.aborted) return;
      // The cursor is no longer one the server issued: start over. Any other
      // failure keeps the page already shown, and the button for a retry.
      if (isProblem(error, 'invalid-cursor')) {
        this.nextCursor = null;
        await this.load();
      }
    } finally {
      if (!this.controller.signal.aborted) this.update({ isLoadingMore: false });
    }
  }
}
