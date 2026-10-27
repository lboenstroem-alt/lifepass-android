/**
 * `EXPO_PUBLIC_FIXTURE="state=<state>,visitRating=<variant>"`: "How was your
 * visit?" in a known state, for device checks and screenshots of a
 * development build (src/dev/fixtures.ts), as the class sheet has its own.
 *
 * Variants:
 * - `card`: Home's card for a visit to World Class Laugar an hour ago;
 * - `sheet`: the sheet over it, 4 stars overall, Equipment 5, a comment;
 * - `written`: the sheet for a member who already wrote a review (the
 *   replace note instead of the comment);
 * - `thanks`: the thank-you after a 5 star answer, "Write a public review".
 *
 * SAFETY: development builds only (`fixtureArg` is null in a release
 * bundle), reachable only through the variable, and it makes NO request:
 * `current`, the answer and the dismiss are answered on the phone, nothing
 * is scheduled and Google Play is never asked.
 */
import { fixtureArg } from '../../dev/fixtures';
import type { VisitRatingPrompt } from '../../api/visitRating';
import type { StoreApi } from 'zustand/vanilla';

import { configureVisitRatingDeps, visitRatingStore, type VisitRatingStore } from './store';

export const VISIT_RATING_FIXTURE_VARIANTS = ['card', 'sheet', 'written', 'thanks'] as const;

export type VisitRatingFixtureVariant = (typeof VISIT_RATING_FIXTURE_VARIANTS)[number];

/** The variant this development build was started with, or null (always null in release). */
export function visitRatingFixtureVariant(): VisitRatingFixtureVariant | null {
  const value = fixtureArg('visitRating');
  return (VISIT_RATING_FIXTURE_VARIANTS as readonly string[]).includes(value ?? '')
    ? (value as VisitRatingFixtureVariant)
    : null;
}

let taken = false;

/** The variant to apply now: once per run, then null. */
export function takeVisitRatingFixture(): VisitRatingFixtureVariant | null {
  const variant = visitRatingFixtureVariant();
  if (!variant || taken) return null;
  taken = true;
  return variant;
}

/** For tests: the fixture may apply again. */
export function resetVisitRatingFixtureForTests(): void {
  taken = false;
}

const HOUR = 60 * 60 * 1000;

/** The fixture's ask: a visit an hour and five minutes ago, due five minutes ago. */
export function visitRatingFixturePrompt(variant: VisitRatingFixtureVariant, now: number = Date.now()): VisitRatingPrompt {
  const dueAt = new Date(now - 5 * 60 * 1000);
  return {
    id: '6f1c2a4e-0000-4000-8000-0000000000f1',
    venueId: '3f2b8c1e-0000-4000-8000-0000000000f1',
    venueName: 'World Class Laugar',
    venueSlug: 'world-class-laugar',
    checkedInAt: new Date(dueAt.getTime() - HOUR),
    dueAt,
    expiresAt: new Date(dueAt.getTime() + 72 * HOUR),
    shownAt: null,
    answeredAt: null,
    dismissedAt: null,
    hasWrittenReview: variant === 'written',
  };
}

/** Puts the store in `variant`'s state, with every call answered on the phone. */
export async function applyVisitRatingFixture(
  variant: VisitRatingFixtureVariant,
  store: StoreApi<VisitRatingStore> = visitRatingStore,
): Promise<void> {
  const prompt = visitRatingFixturePrompt(variant);
  configureVisitRatingDeps(store, {
    fetchCurrent: async () => prompt,
    answer: async () => ({ prompt, happyMoment: true, hasWrittenReview: variant === 'written' }),
    dismiss: async () => undefined,
    cancelNotification: async () => undefined,
    isSignedIn: () => true,
    flowOnScreen: () => false,
    happyMoment: () => undefined,
  });
  store.getState().noteForeground();
  if (variant === 'card') return;
  await store.getState().openFromNotification();
  const actions = store.getState();
  actions.setStars('overall', variant === 'thanks' ? 5 : 4);
  actions.setStars('equipment', 5);
  if (variant === 'sheet') actions.setComment('Spotless showers and plenty of free racks.');
  if (variant === 'thanks') await actions.send();
}
