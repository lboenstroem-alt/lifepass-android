/* eslint lifepass/no-literal-copy: "error" */
/**
 * The tab bar: the Android port of iOS `MainTabView.customTabBar`
 * (Navigation/MainTabView.swift).
 *
 * Five tabs: Home, Explore, Scan (the oversized centre button), Coach and
 * Plan. Plan took the place of the first build's Profile tab and nothing was
 * removed: Profile (bookings and saved) is one tap away behind the Home
 * avatar and every person button.
 *
 * - Labels are the iOS keys, upper-cased, re-read on a language change.
 * - TalkBack: the bar is a tab list; each tab is a tab with its label and its
 *   selected state; the centre button says "Scan" (never its icon's name);
 *   Plan's value is "New" while its dot shows.
 * - The Plan dot shows to ENTITLED members only, until they first open Plan:
 *   a badge that pulls a non-member to a paywall is an advert wearing the
 *   clothes of a notification.
 * - Over Coach (an immersive photo) and over the Scan tab while its camera is
 *   live, the bar turns transparent with a dark foot and white labels;
 *   everywhere else it fades to warm paper.
 * - Each tap fires `nav_tab_selected {tab}`. Tapping the tab you are on pops
 *   that tab back to its first screen.
 * - The bar ignores the keyboard, as on iOS, where the keyboard simply covers
 *   it: while the keyboard is up the bar is not drawn, so it can never ride
 *   up over a text field (the Coach's input, a search).
 */
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { StackActions, type NavigationState, type PartialState } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import WaveIcon from '../components/WaveIcon';
import { useT } from '../i18n';
import { track } from '../lib/analytics';
import { useAppStore } from '../stores/appStore';
import { useIntentStore } from '../stores/intentStore';
import { colors, sans } from '../theme';
import { useNavPrefs } from './navPrefs';
import type { MainTab } from './types';

/** The bar's button row (iOS `.frame(height: 76)`). */
export const TAB_BAR_HEIGHT = 76;

/** Pushed pages the bar does not draw over: they bring their own bottom action (iOS shows booking as a sheet). */
export const BAR_HIDDEN_ON_ROUTES: readonly string[] = ['BookingFlow'];

/** `nav_tab_selected.tab` per tab (iOS `analyticsTabName`). */
export const TAB_ANALYTICS_NAME: Readonly<Record<MainTab, string>> = {
  Home: 'home',
  Explore: 'explore',
  Scan: 'scan',
  Coach: 'coach',
  Plan: 'plan',
};

/** Each tab's label key (iOS `TabItem.labelKey`). */
export const TAB_LABEL_KEY: Readonly<Record<MainTab, string>> = {
  Home: 'tab.home',
  Explore: 'tab.explore',
  Scan: 'tab.scan',
  Coach: 'tab.coach',
  Plan: 'tab.plan',
};

type IconRenderer = (color: string, active: boolean, onDark: boolean) => ReactNode;

const ICONS: Readonly<Record<Exclude<MainTab, 'Scan'>, IconRenderer>> = {
  Home: (color, active) => <Ionicons name={active ? 'home' : 'home-outline'} size={22} color={color} />,
  Explore: (color, active) => <Ionicons name={active ? 'search' : 'search-outline'} size={22} color={color} />,
  Coach: (color, active, onDark) => (
    <WaveIcon size={22} color={color} strokeWidth={onDark ? 2.4 : active ? 2.2 : 1.5} />
  ),
  Plan: (color, active) => <Ionicons name={active ? 'clipboard' : 'clipboard-outline'} size={22} color={color} />,
};

const LEFT_TABS: readonly Exclude<MainTab, 'Scan'>[] = ['Home', 'Explore'];
const RIGHT_TABS: readonly Exclude<MainTab, 'Scan'>[] = ['Coach', 'Plan'];

type AnyState = NavigationState | PartialState<NavigationState>;

/** The focused route inside the active tab's stack, if any. */
function focusedChildRoute(state: BottomTabBarProps['state']): string | undefined {
  const child = state.routes[state.index]?.state as AnyState | undefined;
  if (!child || typeof child.index !== 'number') return undefined;
  return child.routes[child.index]?.name;
}

/** True while the software keyboard is up. */
function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setShown(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

/** Whether the bar sits on a dark surface: Coach, or Scan while the camera is live. */
export function barOnDarkSurface(tab: MainTab | undefined, scanCameraLive: boolean): boolean {
  return tab === 'Coach' || (tab === 'Scan' && scanCameraLive);
}

/** Whether Plan carries its "new" dot: entitled members only, until they first open Plan. */
export function showsPlanDot(healthAccess: string, planTabSeen: boolean, hydrated: boolean): boolean {
  return hydrated && !planTabSeen && healthAccess === 'entitled';
}

export default function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { t } = useT();
  const scanCameraLive = useIntentStore((s) => s.scanCameraLive);
  const healthAccess = useAppStore((s) => s.healthAccess);
  const planTabSeen = useNavPrefs((s) => s.planTabSeen);
  const prefsHydrated = useNavPrefs((s) => s.hydrated);
  const keyboardShown = useKeyboardShown();

  const activeTab = state.routes[state.index]?.name as MainTab | undefined;
  const onDark = barOnDarkSurface(activeTab, scanCameraLive);
  const planDot = showsPlanDot(healthAccess, planTabSeen, prefsHydrated);

  if (keyboardShown || BAR_HIDDEN_ON_ROUTES.includes(focusedChildRoute(state) ?? '')) return null;

  function select(tab: MainTab): void {
    const index = state.routes.findIndex((route) => route.name === tab);
    const route = state.routes[index];
    if (!route) return;
    track('nav_tab_selected', { tab: TAB_ANALYTICS_NAME[tab] });
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (event.defaultPrevented) return;
    if (state.index === index) {
      // The tab you are on: back to its first screen.
      const nested = route.state as AnyState | undefined;
      if (nested && typeof nested.index === 'number' && nested.index > 0 && nested.key) {
        navigation.dispatch({ ...StackActions.popToTop(), target: nested.key });
      }
      return;
    }
    // By name only: a tab's params can still hold a nested route a link once
    // asked for, which must not be opened again by a plain tab tap.
    navigation.navigate(route.name);
  }

  function tabButton(tab: Exclude<MainTab, 'Scan'>) {
    const active = activeTab === tab;
    const color = onDark ? (active ? '#FFFFFF' : 'rgba(255,255,255,0.65)') : active ? colors.paper : colors.paper3;
    const dot = tab === 'Plan' && planDot;
    const label = t(TAB_LABEL_KEY[tab]);
    return (
      <Pressable
        key={tab}
        onPress={() => select(tab)}
        style={styles.tabButton}
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        accessibilityValue={dot ? { text: t('a11y.tab_new') } : undefined}
        testID={`tab.${tab}`}
      >
        <View style={styles.iconBox}>
          {ICONS[tab](color, active, onDark)}
          {dot ? <View style={styles.dot} testID="tab.Plan.dot" /> : null}
        </View>
        <Text
          style={[styles.label, { color, opacity: active ? 1 : 0.7 }]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          importantForAccessibility="no"
        >
          {label.toUpperCase()}
        </Text>
      </Pressable>
    );
  }

  const scanActive = activeTab === 'Scan';

  return (
    <View
      pointerEvents="box-none"
      style={[styles.container, { paddingBottom: insets.bottom }]}
      accessibilityRole="tablist"
      testID="tab-bar"
    >
      <LinearGradient
        pointerEvents="none"
        colors={
          onDark
            ? ['rgba(0,0,0,0)', 'rgba(0,0,0,0.16)', 'rgba(0,0,0,0.38)']
            : ['rgba(248,246,241,0)', 'rgba(248,246,241,0.60)', 'rgba(248,246,241,0.92)', colors.ink, colors.ink]
        }
        locations={onDark ? [0, 0.45, 1] : [0, 0.22, 0.45, 0.65, 1]}
        style={[styles.gradient, { height: TAB_BAR_HEIGHT + insets.bottom }]}
        testID={onDark ? 'tab-bar.dark' : 'tab-bar.light'}
      />

      <View style={styles.row}>
        {LEFT_TABS.map(tabButton)}

        <Pressable
          onPress={() => select('Scan')}
          style={styles.centerSlot}
          accessibilityRole="tab"
          accessibilityLabel={t(TAB_LABEL_KEY.Scan)}
          accessibilityState={{ selected: scanActive }}
          testID="tab.Scan"
        >
          <View style={styles.centerCircle}>
            <Svg width={58} height={58} style={StyleSheet.absoluteFill}>
              <Defs>
                <RadialGradient id="scanFill" cx="30%" cy="30%" r="78%" fx="30%" fy="30%">
                  <Stop offset="0" stopColor={colors.rust2} />
                  <Stop offset="1" stopColor={colors.rust} />
                </RadialGradient>
              </Defs>
              <Circle cx={29} cy={29} r={29} fill="url(#scanFill)" />
            </Svg>
            <Ionicons name="qr-code-outline" size={24} color="#FFFFFF" />
          </View>
        </Pressable>

        {RIGHT_TABS.map(tabButton)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  row: {
    height: TAB_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingBottom: 6,
  },
  tabButton: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  iconBox: {
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Anchored to the icon's centre and offset (+10, -10), as iOS draws it.
  dot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.rust,
    left: '50%',
    top: '50%',
    marginLeft: 10 - 3,
    marginTop: -10 - 3,
  },
  label: {
    ...sans(9.5, 'semibold'),
    letterSpacing: 0.8,
  },
  centerSlot: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    // Raised above the bar so it punches out, with the rust glow.
    transform: [{ translateY: -22 }],
    elevation: 12,
    shadowColor: colors.rust,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    backgroundColor: colors.rust,
    overflow: 'visible',
  },
});
