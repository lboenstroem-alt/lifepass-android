// The chip under Home's top bar: the member's soonest-expiring pass and its
// visits left (iOS `HomeView.contextualChipsRow`). The old credit, top-up,
// luxury and tourist chips are retired; this is the only one left.
import type { ActivePass } from '../../api/profile';
import type { Params } from '../../i18n';

/** The pass that runs out first, or null with none (iOS `activePasses.min(by: expiresAt)`). */
export function soonestPass(passes: readonly ActivePass[]): ActivePass | null {
  let soonest: ActivePass | null = null;
  for (const pass of passes) {
    // Strictly earlier: equal expiries keep the first, as Swift's `min(by:)` does.
    if (soonest === null || pass.expiresAt.getTime() < soonest.expiresAt.getTime()) soonest = pass;
  }
  return soonest;
}

/**
 * The chip's words. iOS chooses with `visitsLeft == 1`, not the language's
 * plural rule, so "21 pass visits left" stays "passaheimsóknir" in
 * Icelandic too; kept exactly.
 */
export function passVisitsText(pass: Pick<ActivePass, 'visitsLeft'>, translate: (key: string, params?: Params) => string): string {
  return pass.visitsLeft === 1
    ? translate('home.pass_visits.one')
    : translate('home.pass_visits.many', { count: pass.visitsLeft });
}
