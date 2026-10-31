/**
 * The small pieces Body and goals and the weight history are built from, on
 * top of Account's row primitives (src/features/account: rows draw the
 * hairline ABOVE themselves and the card hides the first one, so every row
 * here does the same).
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Kicker, LPText, MenuPicker, ToggleRow, type MenuOption } from '../../../components/ui';
import { useT } from '../../../i18n';
import { colors } from '../../../theme';
import { AccountRowDivider } from '../../account';

/**
 * The pinned bar of a pushed health page (iOS `BodyAndGoalsView.topBar`): a
 * 36 pt back circle, the page's kicker centred, and a matching blank on the
 * right so the title stays centred.
 */
export function BodyTopBar({ title, onBack, testID }: { readonly title: string; readonly onBack: () => void; readonly testID?: string }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} testID={testID}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        hitSlop={6}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        testID={testID ? `${testID}.back` : undefined}
      >
        <Ionicons name="chevron-back" size={15} color={colors.paper} />
      </Pressable>
      <View style={styles.topBarTitle}>
        <Kicker text={title} color={colors.paper2} accessibilityRole="header" />
      </View>
      <View style={styles.topBarBalance} />
    </View>
  );
}

/** A switch row in a card (iOS `toggleRow`), with the card's hairline above it. */
export function CardToggleRow({
  title,
  subtitle,
  value,
  onChange,
  enabled = true,
  testID,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly value: boolean;
  /** Called with the new value only when it differs (iOS hangs the write on the binding). */
  readonly onChange: (value: boolean) => void;
  readonly enabled?: boolean;
  readonly testID?: string;
}) {
  return (
    <View>
      <AccountRowDivider />
      <ToggleRow
        title={title}
        subtitle={subtitle}
        value={value}
        onValueChange={(next) => {
          if (next !== value) onChange(next);
        }}
        disabled={!enabled}
        testID={testID}
      />
    </View>
  );
}

/**
 * The value a menu shows (iOS `menuValue`): the choice and an up-down
 * chevron on an ink3 lozenge.
 */
function MenuValue({ text }: { readonly text: string }) {
  return (
    <View style={styles.menuValue}>
      <LPText size={14} color={colors.paper2}>
        {text}
      </LPText>
      <Ionicons name="chevron-expand" size={11} color={colors.paper3} />
    </View>
  );
}

/** A menu for one value inside a row (iOS `Menu { Button … } label: menuValue`). */
export function RowMenu<T extends string>({
  label,
  options,
  value,
  valueLabel,
  onChange,
  enabled,
  testID,
}: {
  /** What the menu chooses, for TalkBack. */
  readonly label: string;
  readonly options: MenuOption<T>[];
  readonly value: T;
  /** What the trigger shows, when the value may not be one of the options (a time stored elsewhere). */
  readonly valueLabel?: string;
  readonly onChange: (value: T) => void;
  readonly enabled: boolean;
  readonly testID?: string;
}) {
  return (
    <MenuPicker
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      disabled={!enabled}
      renderTrigger={(selected) => <MenuValue text={valueLabel ?? selected?.label ?? ''} />}
      testID={testID}
    />
  );
}

/**
 * A row with a title on the left and one or more menus on the right (iOS
 * `menuRow`, and the check-in's "Day and time"), drawn at 45 % while off.
 * The menus dim themselves when disabled (the kit's MenuPicker), so only the
 * title is dimmed here: dimming the row as well would draw them at a fifth.
 */
export function CardMenuRow({
  title,
  enabled,
  children,
  testID,
}: {
  readonly title: string;
  readonly enabled: boolean;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  return (
    <View>
      <AccountRowDivider />
      <View style={styles.menuRow} testID={testID}>
        <LPText size={14} weight="medium" color={colors.paper} style={[styles.menuRowTitle, !enabled && styles.disabled]}>
          {title}
        </LPText>
        <View style={styles.menus}>{children}</View>
      </View>
    </View>
  );
}

/** A sentence and a "Try again" (or other) action on one row: an error state inside a card. */
export function CardMessageRow({
  message,
  actionLabel,
  onAction,
  divider = true,
  testID,
}: {
  readonly message: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly divider?: boolean;
  readonly testID?: string;
}) {
  return (
    <View>
      {divider ? <AccountRowDivider /> : null}
      <View style={styles.messageRow} testID={testID}>
        <LPText size={13} color={colors.paper2} style={styles.messageText}>
          {message}
        </LPText>
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={8}
          style={({ pressed }) => [styles.messageAction, pressed && styles.pressed]}
          testID={testID ? `${testID}.action` : undefined}
        >
          <LPText size={13} weight="semibold" color={colors.accentText}>
            {actionLabel}
          </LPText>
        </Pressable>
      </View>
    </View>
  );
}

/** A row's title with a small spinner where its control would be (an export or a withdrawal in flight). */
export function CardBusyRow({ title, testID }: { readonly title: string; readonly testID?: string }) {
  const { t } = useT();
  return (
    <View>
      <AccountRowDivider />
      <View style={styles.busyRow} accessible accessibilityLabel={title} accessibilityState={{ busy: true }} testID={testID}>
        <LPText size={14} weight="medium" color={colors.paper} style={styles.messageText}>
          {title}
        </LPText>
        <ActivityIndicator size="small" color={colors.rust} accessibilityLabel={t('a11y.loading')} />
      </View>
    </View>
  );
}

/** A red line under a row: a refusal the member should read (an export or a withdrawal that failed). */
export function CardErrorLine({ text, testID }: { readonly text: string; readonly testID?: string }) {
  return (
    <View style={styles.errorLine} accessibilityLiveRegion="polite" testID={testID}>
      <LPText size={13} color={colors.destructive}>
        {text}
      </LPText>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
    backgroundColor: colors.ink,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  topBarBalance: { width: 36, height: 36 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.45 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  menuRowTitle: { flexGrow: 1, flexShrink: 1 },
  menus: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  menuValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 40,
    paddingHorizontal: 12,
    backgroundColor: colors.ink3,
    borderRadius: 10,
  },
  messageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  messageText: { flex: 1 },
  messageAction: { minHeight: 44, justifyContent: 'center' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  errorLine: { paddingHorizontal: 16, paddingBottom: 12 },
});
