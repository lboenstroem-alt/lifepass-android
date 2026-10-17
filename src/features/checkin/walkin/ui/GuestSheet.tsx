/* eslint lifepass/no-literal-copy: "error" */
/**
 * "Bringing anyone?": the guests riding this scan (iOS
 * `CheckInView.guestPickerSheet`). The preview's `guestBands` is the whole
 * contract: one stepper per band the venue sells, with the venue's OWN price
 * and age range (nothing hard-coded); the member attests each guest's age
 * fits the band. Up to nine guests (the server's ceiling).
 *
 * WHOSE PRICE IS WHOSE (2.5.3): these rows are GUEST prices. A free own visit
 * says so; a charged one names its own price apart ("Your visit: ISK 1,990.
 * Guest prices come on top..."), so the two are never added up in the
 * member's head.
 *
 * Continue (with guests) or Just me, and a secondary Just me that clears
 * them; each acts once. iOS cannot dismiss this sheet by hand; on Android
 * back (and a pan down) ends the attempt, nothing having been sent.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import { Pressable, StyleSheet, View, type Text } from 'react-native';

import { LPText, Sheet } from '../../../../components/ui';
import { iskPrefix, useT } from '../../../../i18n';
import { colors, minTouch, radius } from '../../../../theme';
import { ownVisitIsFree, type GuestBandOffer } from '../../../../api/walkInPreview';
import { guestCountTotal, guestTotalIsk, MAX_GUESTS } from '../store';
import { useWalkIn, walkInActions } from '../useWalkIn';

import { LinkButton, SolidButton } from './buttons';

/** "Child (6–15)": always the venue's own range from the offer. */
export function guestBandLabel(offer: GuestBandOffer, t: (key: string) => string): string {
  const base = t(`checkin.guests.band.${offer.band}`);
  return offer.rangeLabel ? `${base} (${offer.rangeLabel})` : base;
}

export default function GuestSheet() {
  const { t } = useT();
  const visible = useWalkIn((s) => s.showGuestPicker);
  const offers = useWalkIn((s) => s.guestBandOffers);
  const counts = useWalkIn((s) => s.guestCounts);
  const preview = useWalkIn((s) => s.preview);
  const titleRef = useRef<Text>(null);
  const total = guestCountTotal({ guestCounts: counts });
  const totalIsk = guestTotalIsk({ guestBandOffers: offers, guestCounts: counts });

  let whosePrice: string | null = null;
  if (preview) {
    if (ownVisitIsFree(preview)) whosePrice = t('checkin.guests.own_free');
    else if (preview.charge) {
      whosePrice = `${t('checkin.guests.own_price', { price: iskPrefix(preview.charge.amountIsk) })} ${t('checkin.guests.own_charged')}`;
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={() => walkInActions().cancelGuests()}
      initialFocusRef={titleRef}
      testID="walkin.guests"
      footer={
        <>
          <SolidButton
            title={t(total > 0 ? 'checkin.guests.continue' : 'checkin.guests.just_me')}
            onPress={() => void walkInActions().confirmGuestSelection()}
            testID="walkin.guests.continue"
          />
          {total > 0 ? (
            <LinkButton
              size={15}
              title={t('checkin.guests.just_me')}
              onPress={() => void walkInActions().skipGuests()}
              testID="walkin.guests.justMe"
            />
          ) : null}
        </>
      }
    >
      <View style={styles.body}>
        <View style={styles.texts}>
          <LPText ref={titleRef} size={22} weight="bold" color={colors.paper} accessibilityRole="header">
            {t('checkin.guests.title')}
          </LPText>
          <LPText size={14} color={colors.mutedTextStrong}>
            {t('checkin.guests.subtitle')}
          </LPText>
          {whosePrice ? (
            <LPText size={14} weight="medium" color={colors.paper} style={styles.whose} testID="walkin.guests.whosePrice">
              {whosePrice}
            </LPText>
          ) : null}
        </View>
        <View style={styles.rows}>
          {offers.map((offer) => (
            <GuestBandRow key={offer.band} offer={offer} count={counts[offer.band] ?? 0} canAdd={total < MAX_GUESTS} />
          ))}
        </View>
        {total > 0 ? (
          <View style={styles.total} accessible testID="walkin.guests.total">
            <LPText size={15} weight="medium" color={colors.mutedTextStrong}>
              {t('checkin.guests.total')}
            </LPText>
            <LPText size={17} weight="bold" color={colors.paper}>
              {iskPrefix(totalIsk)}
            </LPText>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

function GuestBandRow({ offer, count, canAdd }: { offer: GuestBandOffer; count: number; canAdd: boolean }) {
  const { t } = useT();
  const label = guestBandLabel(offer, t);
  const price = offer.unitIsk > 0 ? `${iskPrefix(offer.unitIsk)} ${t('checkin.guests.per_guest')}` : t('checkin.guests.free');
  const canRemove = count > 0;
  return (
    <View style={styles.row} testID={`walkin.guests.band.${offer.band}`}>
      <View style={styles.rowTexts} accessible accessibilityLabel={`${label}, ${price}`}>
        <LPText size={16} weight="semibold" color={colors.paper}>
          {label}
        </LPText>
        <LPText size={13} color={colors.mutedTextStrong}>
          {price}
        </LPText>
      </View>
      <View style={styles.stepper}>
        <Pressable
          onPress={() => walkInActions().removeGuest(offer.band)}
          disabled={!canRemove}
          accessibilityRole="button"
          accessibilityLabel={t('checkin.guests.a11y_remove', { band: label })}
          accessibilityState={{ disabled: !canRemove }}
          style={styles.step}
          testID={`walkin.guests.remove.${offer.band}`}
        >
          <Ionicons name="remove-circle" size={30} color={canRemove ? colors.accentText : colors.paper4} />
        </Pressable>
        <LPText size={17} weight="bold" color={colors.paper} align="center" style={styles.count} testID={`walkin.guests.count.${offer.band}`}>
          {String(count)}
        </LPText>
        <Pressable
          onPress={() => walkInActions().addGuest(offer.band)}
          disabled={!canAdd}
          accessibilityRole="button"
          accessibilityLabel={t('checkin.guests.a11y_add', { band: label })}
          accessibilityState={{ disabled: !canAdd }}
          style={styles.step}
          testID={`walkin.guests.add.${offer.band}`}
        >
          <Ionicons name="add-circle" size={30} color={canAdd ? colors.accentText : colors.paper4} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 20, paddingTop: 8 },
  texts: { gap: 6 },
  whose: { paddingTop: 4 },
  rows: { gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.field,
    backgroundColor: colors.ink2,
  },
  rowTexts: { flex: 1, gap: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  step: { width: minTouch, height: minTouch, alignItems: 'center', justifyContent: 'center' },
  count: { minWidth: 22 },
  total: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
});
