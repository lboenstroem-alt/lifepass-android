// DEV ONLY: every UI kit piece on one scrolling page, for visual checks on an
// emulator (font scale 2.0, Remove animations, TalkBack, Icelandic). Nothing
// here ships: the app shell mounts it only in a dev build, and its words are
// sample text, not member copy (src/dev is outside the copy rules).
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Callout,
  Card,
  CheckboxRow,
  Chip,
  ChipRow,
  ConfirmSheet,
  EmptyState,
  ErrorState,
  EstimateChip,
  Kicker,
  LPText,
  MenuPicker,
  NumberStepper,
  PrimaryButton,
  SegmentedControl,
  Sheet,
  SkeletonCard,
  StatusBanner,
  ToggleRow,
  TopBar,
  VenueImage,
  showDialog,
  showToast,
} from '../components/ui';
import { useA11ySize } from '../hooks/useA11ySize';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { setCurrentLanguage, useT } from '../i18n';
import { haptics } from '../lib/haptics';
import { colors, mapRing } from '../theme';

const SAMPLE_PHOTO = 'https://www.lifepass.is/og-image.png';

export default function UiKitScreen() {
  const { t, language } = useT();
  const size = useA11ySize();
  const reduceMotion = useReduceMotion();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [weight, setWeight] = useState('72,5');
  const [goal, setGoal] = useState<'lose' | 'maintain' | 'gain'>('maintain');
  const [segment, setSegment] = useState<'a' | 'b'>('a');
  const [slot, setSlot] = useState<'breakfast' | 'lunch' | 'dinner'>('lunch');
  const [agreed, setAgreed] = useState(false);
  const [reminder, setReminder] = useState(true);
  const [callout, setCallout] = useState(true);

  return (
    <View style={styles.page}>
      <TopBar
        title="UI kit"
        subtitle={`${size.typeSize} · ${reduceMotion ? 'reduced motion' : 'motion'} · ${language}`}
        busy={sheetBusy}
        trailing={{ kind: 'gear', onPress: () => setCurrentLanguage(language === 'en' ? 'is' : 'en') }}
      />
      <StatusBanner icon="cloud-offline-outline" message="You are offline. Changes are saved on this phone." actionLabel="Retry" onAction={() => undefined} />
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Text">
          <LPText serif size={28}>Fraunces 28</LPText>
          <LPText size={15} weight="semibold" color={colors.paper2}>Inter Tight 15 semibold</LPText>
          <Kicker text="Kicker" />
          <EstimateChip />
        </Section>

        <Section title="Buttons">
          <PrimaryButton title={t('common.continue')} onPress={() => haptics.notification('success')} />
          <PrimaryButton title="Action fill (AA)" tone="action" onPress={() => haptics.impact('medium')} />
          <PrimaryButton title="Loading" loading onPress={() => undefined} />
          <PrimaryButton title="Delete" tone="destructive" onPress={() => setConfirmOpen(true)} />
        </Section>

        <Section title="Choices">
          <ChipRow>
            {(['lose', 'maintain', 'gain'] as const).map((value) => (
              <Chip key={value} label={t(`goal.${value}`)} selected={goal === value} onPress={() => setGoal(value)} shape="rounded" grow />
            ))}
          </ChipRow>
          <ChipRow scroll>
            <Chip tone="ink" label={t('classes.segment_venues')} selected onPress={() => undefined} />
            <Chip tone="ink" label={t('classes.segment_classes')} onPress={() => undefined} />
          </ChipRow>
          <SegmentedControl value={segment} onChange={setSegment} segments={[{ value: 'a', label: 'Workouts' }, { value: 'b', label: 'Past plans' }]} />
          <MenuPicker
            label="Meal"
            value={slot}
            onChange={setSlot}
            options={[
              { value: 'breakfast', label: 'Breakfast' },
              { value: 'lunch', label: 'Lunch' },
              { value: 'dinner', label: 'Dinner' },
            ]}
          />
          <CheckboxRow title="I agree to the health terms" checked={agreed} onChange={setAgreed} outlined={!agreed} />
          <ToggleRow title="Weekly check-in" subtitle="Sunday at 18:00" value={reminder} onValueChange={setReminder} />
          <NumberStepper
            text={weight}
            onChangeText={setWeight}
            step={0.1}
            min={20}
            max={400}
            fallback={70}
            unit="kg"
            label={t('body.weight')}
            spokenUnit={t('a11y.unit.kg')}
            decreaseLabel={t('a11y.decrease_weight')}
            increaseLabel={t('a11y.increase_weight')}
          />
        </Section>

        <Section title="Overlays">
          <PrimaryButton title="Open sheet" onPress={() => setSheetOpen(true)} />
          <PrimaryButton
            title="Five-button dialog"
            onPress={() =>
              showDialog({
                title: 'Leave the workout?',
                message: 'Your sets so far are kept on this phone.',
                buttons: [
                  { label: 'Save and finish' },
                  { label: 'Save as done so far' },
                  { label: 'Keep for later' },
                  { label: 'Discard workout', role: 'destructive' },
                  { label: 'Keep going', role: 'cancel' },
                ],
              })
            }
          />
          <PrimaryButton title="Toast" onPress={() => showToast('Saved to lunch', { action: { label: 'Food diary', onPress: () => undefined } })} />
          <PrimaryButton title="Meal toast, no action (4 s)" onPress={() => showToast('Saved offline', { kind: 'meal' })} />
          <PrimaryButton title="Health toast (3.2 s)" onPress={() => showToast('Changed on another device')} />
          <PrimaryButton title="Confirm" tone="action" shape="booking" disabled onPress={() => undefined} />
          {/* TalkBack reads the charge with the name, as iOS's class sheet Confirm. */}
          <PrimaryButton
            title="Confirm"
            accessibilityLabel="Confirm booking: Yoga, Fri 18:00. ISK 1,990 charged when you confirm"
            tone="action"
            shape="booking"
            onPress={() => showToast('Booked')}
          />
          {callout ? (
            <View style={styles.callout}>
              <Callout text={t('home.profile_moved')} onDismiss={() => setCallout(false)} />
            </View>
          ) : null}
        </Section>

        <Section title="States">
          <SkeletonCard rows={2} />
          <ErrorState onRetry={() => undefined} />
          <EmptyState icon="search" message="No venues match these filters." actionLabel="Clear filters" onAction={() => undefined} />
        </Section>

        <Section title="Images and map rings">
          <VenueImage uri={SAMPLE_PHOTO} height={160} />
          <VenueImage uri={null} height={80} />
          <View style={styles.rings}>
            {Object.entries(mapRing)
              .filter(([, value]) => value.startsWith('#'))
              .map(([name, value]) => (
                <View key={name} style={[styles.ring, { borderColor: value }]} />
              ))}
            <View style={[styles.ring, { borderColor: colors.attraction }]} />
          </View>
        </Section>
      </ScrollView>

      <Sheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        busy={sheetBusy}
        fullHeight={size.isAccessibilitySize}
        footer={<PrimaryButton title={sheetBusy ? 'Busy (locked)' : 'Lock for 3 s'} tone="action" shape="booking" loading={sheetBusy} onPress={() => {
          setSheetBusy(true);
          setTimeout(() => setSheetBusy(false), 3000);
        }} />}
      >
        <LPText serif size={24}>A sheet</LPText>
        {/* Focus it: the field and the footer must both stay above the keyboard. */}
        <NumberStepper
          text={weight}
          onChangeText={setWeight}
          step={0.1}
          min={20}
          max={400}
          fallback={70}
          unit="kg"
          size="regular"
          label={t('body.weight')}
          spokenUnit={t('a11y.unit.kg')}
          decreaseLabel={t('a11y.decrease_weight')}
          increaseLabel={t('a11y.increase_weight')}
        />
        <LPText size={14} color={colors.paper2}>
          Pan down, tap outside or press back to close. While locked, none of them work.
        </LPText>
        <Card style={styles.cardPad}>
          <LPText size={13}>A card inside the sheet.</LPText>
        </Card>
        {/* Device check: a sheet closed and opened again mid-slide must come back up. */}
        <PrimaryButton
          title="Close and reopen at once"
          onPress={() => {
            setSheetOpen(false);
            setTimeout(() => setSheetOpen(true), 100);
          }}
        />
      </Sheet>
      <ConfirmSheet
        visible={confirmOpen}
        title="End this plan?"
        body="Your history stays. You can start a new plan whenever you like."
        confirmLabel="End plan"
        destructive
        onConfirm={() => showToast('Plan ended')}
        onClose={() => setConfirmOpen(false)}
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Kicker text={title} color={colors.signal} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.ink },
  content: { padding: 20, gap: 28, paddingBottom: 120 },
  section: { gap: 12 },
  callout: { alignItems: 'flex-end' },
  cardPad: { padding: 14, marginTop: 12 },
  rings: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 8, backgroundColor: colors.ink3 },
  ring: { width: 28, height: 28, borderRadius: 14, borderWidth: 4, backgroundColor: mapRing.swatchFill },
});
