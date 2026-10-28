/**
 * The meal page's header (iOS `MealCaptureView.header`, ios-ux.md 12.3):
 *
 *   [X]      [ Lunch · Today v ]      [torch]
 *   [  Photo  |  Barcode  |  Search  ]
 *
 * Over the camera it is drawn on the picture (translucent black capsules,
 * white words, the selected mode white); in Search on the page colour (the
 * selected mode in the accent). The slot and date menu offers the five
 * slots, then "Change date".
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { LPText, MenuPicker, type MenuOption } from '../../../components/ui';
import { useT } from '../../../i18n';
import { mealSlotCopyKey } from '../../../health/models';
import type { MealCaptureMode, MealSlot } from '../../../navigation/types';
import { colors, hairline } from '../../../theme';

import { EDITABLE_SLOTS, modeUsesCamera, type MealCaptureModel } from './captureModel';
import { useCapture } from './capturePages';
import { relativeDay } from './mealText';

/** 52 dp row, 12 dp gap, 40 dp switcher, 10 dp padding (iOS `MealCaptureLayout.headerHeight`). */
export const CAPTURE_HEADER_HEIGHT = 114;

/** The menu's "Change date" entry, after the slots. */
const CHANGE_DATE = 'changeDate';
type MenuValue = MealSlot | typeof CHANGE_DATE;

const ON_CAMERA_FILL = 'rgba(0,0,0,0.35)';
const ON_CAMERA_TRACK = 'rgba(0,0,0,0.5)';
const WHITE = '#FFFFFF';
const BLACK = '#000000';

export interface CaptureHeaderProps {
  readonly model: MealCaptureModel;
  /** The modes the switcher offers, in order. */
  readonly modes: readonly MealCaptureMode[];
  readonly onClose: () => void;
  readonly onSwitchMode: (mode: MealCaptureMode) => void;
  readonly onChangeDate: () => void;
}

export default function CaptureHeader({ model, modes, onClose, onSwitchMode, onChangeDate }: CaptureHeaderProps) {
  const { t, language } = useT();
  const mode = useCapture(model, (s) => s.mode);
  const slot = useCapture(model, (s) => s.slot);
  const date = useCapture(model, (s) => s.date);
  const torchAvailable = useCapture(model, (s) => s.torchAvailable);
  const torchOn = useCapture(model, (s) => s.torchOn);
  const onCamera = modeUsesCamera(mode);

  const slotDate = t('meal.header.slot_date', { slot: t(mealSlotCopyKey(slot)), date: relativeDay(date, language, t) });
  const options: MenuOption<MenuValue>[] = [
    ...EDITABLE_SLOTS.map((value) => ({ value, label: t(mealSlotCopyKey(value)), testID: `meal.slot.${value}` })),
    { value: CHANGE_DATE, label: t('meal.header.change_date'), testID: 'meal.changeDate' },
  ];

  return (
    <View style={[styles.header, !onCamera && styles.onPage]} testID="meal.header">
      <View style={styles.row}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.meal_close')}
          hitSlop={4}
          style={({ pressed }) => [styles.round, { backgroundColor: onCamera ? ON_CAMERA_FILL : colors.ink2 }, pressed && styles.pressed]}
          testID="meal.close"
        >
          <Ionicons name="close" size={20} color={onCamera ? WHITE : colors.paper} />
        </Pressable>

        <View style={styles.middle}>
          <MenuPicker<MenuValue>
            options={options}
            value={slot}
            label={slotDate}
            onChange={(value) => {
              if (value === CHANGE_DATE) onChangeDate();
              else model.setSlot(value);
            }}
            testID="meal.slotDate"
            renderTrigger={() => (
              <View
                style={[
                  styles.capsule,
                  onCamera ? { backgroundColor: ON_CAMERA_FILL } : { backgroundColor: colors.ink2, borderColor: colors.line, borderWidth: hairline },
                ]}
              >
                <LPText size={15} weight="semibold" color={onCamera ? WHITE : colors.paper} numberOfLines={1} style={styles.shrink}>
                  {slotDate}
                </LPText>
                <Ionicons name="chevron-down" size={13} color={onCamera ? WHITE : colors.paper} />
              </View>
            )}
          />
        </View>

        {onCamera && torchAvailable ? (
          <Pressable
            onPress={() => model.setTorch(!torchOn)}
            accessibilityRole="button"
            accessibilityLabel={t(torchOn ? 'a11y.torch_off' : 'a11y.torch_on')}
            hitSlop={4}
            style={({ pressed }) => [styles.round, { backgroundColor: ON_CAMERA_FILL }, pressed && styles.pressed]}
            testID="meal.torch"
          >
            <Ionicons name={torchOn ? 'flashlight' : 'flashlight-outline'} size={19} color={WHITE} />
          </Pressable>
        ) : (
          <View style={styles.roundSpace} />
        )}
      </View>

      {modes.length > 1 ? (
        <View
          accessibilityRole="tablist"
          accessibilityLabel={t('meal.mode.label')}
          style={[
            styles.track,
            onCamera ? { backgroundColor: ON_CAMERA_TRACK } : { backgroundColor: colors.ink2, borderColor: colors.line, borderWidth: hairline },
          ]}
          testID="meal.modes"
        >
          {modes.map((value) => {
            const selected = value === mode;
            const fill = selected ? (onCamera ? WHITE : colors.rust) : 'transparent';
            const text = onCamera ? (selected ? BLACK : WHITE) : selected ? WHITE : colors.paper2;
            return (
              <Pressable
                key={value}
                onPress={() => onSwitchMode(value)}
                accessibilityRole="tab"
                accessibilityLabel={t(`meal.mode.${value}`)}
                accessibilityState={{ selected }}
                style={[styles.segment, { backgroundColor: fill }]}
                testID={`meal.mode.${value}`}
              >
                <LPText size={14} weight="semibold" color={text} numberOfLines={1} align="center">
                  {t(`meal.mode.${value}`)}
                </LPText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: 10, gap: 12 },
  onPage: { backgroundColor: colors.ink },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  roundSpace: { width: 44, height: 44 },
  pressed: { opacity: 0.75 },
  middle: { flex: 1, alignItems: 'center' },
  capsule: {
    minHeight: 36,
    borderRadius: 999,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  shrink: { flexShrink: 1 },
  track: { marginHorizontal: 20, minHeight: 40, borderRadius: 999, padding: 3, flexDirection: 'row' },
  segment: { flex: 1, minHeight: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
});
