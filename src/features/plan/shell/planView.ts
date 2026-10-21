/**
 * What the Plan screen and every section read about the page: which body
 * renders, the day the cards draw, and whether writes are allowed. The
 * derived values of iOS PlanView (`section`, `shownDay`, `isShowingToday`,
 * `isReadOnly`, `isOffline`, `isBlockFinished`), computed in ONE place so a
 * section can never disagree with the page it sits on.
 *
 *   const { shownDay, isReadOnly, isOffline } = usePlanView();
 */
import { useMemo } from 'react';

import type { Profile } from '../../../api/profile';
import { useHealthStore, type HealthAccess, type HealthDay, type HealthStoreState } from '../../../health';
import { todayServerDay } from '../../../i18n/format';
import { useAppStore } from '../../../stores/appStore';

import { hasProgramToShow, resolvePlanSection, type PlanSection } from './sectionRule';

export interface PlanViewModel {
  readonly access: HealthAccess;
  readonly hasConsent: boolean;
  readonly section: PlanSection;
  /** The Today read (or its cache). */
  readonly today: HealthDay | null;
  /** The day the cards draw: the selected date when the strip moved off today, today otherwise. */
  readonly shownDay: HealthDay | null;
  readonly selectedDate: string;
  readonly isShowingToday: boolean;
  /**
   * EVERY MEMBER WHO IS NOT ENTITLED READS, AND WRITES NOTHING. past_due and
   * a lapsed member whose consent stands both get the read-only column, and
   * everything that creates or changes plan data is behind the full gate:
   * testing past_due alone left a pass_only member with live Mark as done,
   * No energy and Skip buttons, each a 403 after the tap.
   */
  readonly isReadOnly: boolean;
  /** The last read failed for want of a network. */
  readonly isOffline: boolean;
  /** A programme this tab still draws (active, paused or completed). */
  readonly hasProgramToShow: boolean;
  /** The programme on screen ran to its end date (it reads `completed`). */
  readonly isBlockFinished: boolean;
}

type AppSlice = { readonly healthAccess: HealthAccess; readonly profile: Profile | null };
type HealthSlice = Pick<HealthStoreState, 'today' | 'days' | 'selectedDate' | 'loadState' | 'lastError'>;

export function computePlanView(app: AppSlice, health: HealthSlice, todayKey: string = todayServerDay()): PlanViewModel {
  const access = app.healthAccess;
  // iOS `hasHealthConsent`: the profile's health block carries a consent.
  const hasConsent = !!app.profile?.health?.consent;
  const showsProgram = hasProgramToShow(health.today?.program?.status);
  const section = resolvePlanSection({
    access,
    hasConsent,
    hasDay: health.today !== null,
    isLoading: health.loadState.kind === 'loading',
    readFailed: health.loadState.kind === 'failed',
    hasProgramToShow: showsProgram,
  });
  const shownDay = health.days[health.selectedDate] ?? health.today;
  return {
    access,
    hasConsent,
    section,
    today: health.today,
    shownDay,
    selectedDate: health.selectedDate,
    isShowingToday: health.selectedDate === todayKey,
    isReadOnly: access !== 'entitled',
    isOffline: health.lastError?.isOffline === true,
    hasProgramToShow: showsProgram,
    isBlockFinished: shownDay?.program?.status === 'completed',
  };
}

/** The page as it is now, for code outside React (the shell's actions). */
export function currentPlanView(): PlanViewModel {
  return computePlanView(useAppStore.getState(), useHealthStore.getState());
}

/** The page, re-rendering when anything it is computed from changes. */
export function usePlanView(): PlanViewModel {
  const healthAccess = useAppStore((s) => s.healthAccess);
  const profile = useAppStore((s) => s.profile);
  const today = useHealthStore((s) => s.today);
  const days = useHealthStore((s) => s.days);
  const selectedDate = useHealthStore((s) => s.selectedDate);
  const loadState = useHealthStore((s) => s.loadState);
  const lastError = useHealthStore((s) => s.lastError);
  return useMemo(
    () => computePlanView({ healthAccess, profile }, { today, days, selectedDate, loadState, lastError }),
    [healthAccess, profile, today, days, selectedDate, loadState, lastError],
  );
}
