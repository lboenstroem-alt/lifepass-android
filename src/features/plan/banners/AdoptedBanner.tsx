/**
 * Shown once, for the appearance that follows an adopt (iOS `adoptedBanner`,
 * 3.5): "Your plan starts {date}." and what the member will be reminded of.
 * Which of the three lines it uses depends on whether the member will
 * actually be reminded (../shell/adoptedBanner.ts), because a banner that
 * promises notes on a phone with notifications off is a small lie that costs
 * a workout. "Change" opens Body and goals at its reminders.
 */
import { useEffect, useState } from 'react';

import { StatusBanner } from '../../../components/ui';
import { useT } from '../../../i18n';
import { shortDay } from '../../../i18n/format';
import { useAppStore } from '../../../stores/appStore';
import { readAdoptedBannerKey, type AdoptedBannerKey } from '../shell/adoptedBanner';
import { pushPlanRoute, usePlanShell } from '../shell/planShell';

export default function AdoptedBanner() {
  const { t, language } = useT();
  const banner = usePlanShell((s) => s.adoptedBanner);
  const profileId = useAppStore((s) => s.profile?.id ?? null);
  const [key, setKey] = useState<AdoptedBannerKey | null>(null);

  // The stored reminder choice is read when the banner comes up: the adopt
  // tap wrote it moments ago.
  useEffect(() => {
    if (!banner) {
      setKey(null);
      return;
    }
    let live = true;
    void readAdoptedBannerKey(profileId).then((next) => {
      if (live) setKey(next);
    });
    return () => {
      live = false;
    };
  }, [banner, profileId]);

  if (!banner || !key) return null;
  return (
    <StatusBanner
      icon="checkmark-circle"
      message={t(key, { date: banner.startsOn ? shortDay(banner.startsOn, language) : '' })}
      actionLabel={t('plan.adopted.reminders')}
      onAction={() => pushPlanRoute('BodyAndGoals', { anchor: 'reminders' })}
      testID="plan.banner.adopted"
    />
  );
}
