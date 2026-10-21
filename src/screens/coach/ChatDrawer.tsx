/* eslint lifepass/no-literal-copy: "error" */
// The Coach's drawer, behind the burger (iOS CoachView.swift
// `CoachDrawerView`): 78% of the width, at most 300 dp, on #0E1E38.
//
//   the wordmark
//   Add chat                a new chat (the one on screen is saved first)
//   Saved                   the saved venues (Profile, Saved half)
//   RECENTS                 the last three chats, or "No recent chats yet"
//   New Chat                the same as Add chat, as a button at the foot
//
// A modal, so the back button and a tap on the shade close it, and TalkBack
// stays inside it while it is open.
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LPText, Wordmark } from '../../components/ui';
import type { RecentChat } from '../../features/coach/persistence/sessions';
import { coachPalette } from '../../features/coach/theme/palette';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useT } from '../../i18n';

type Props = {
  visible: boolean;
  onClose: () => void;
  onNewChat: () => void;
  /** The saved venues. */
  onSaved: () => void;
  /** A recent chat. */
  onSelectRecent: (chatId: string) => void;
  recentChats: readonly RecentChat[];
};

export default function ChatDrawer({ visible, onClose, onNewChat, onSaved, onSelectRecent, recentChats }: Props) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const width = Math.min(screenWidth * 0.78, 300);
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(visible ? 0 : -width)).current;
  const shade = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) setMounted(true);
    const duration = reduceMotion ? 0 : visible ? 260 : 200;
    const animation = Animated.parallel([
      Animated.timing(slide, { toValue: visible ? 0 : -width, duration, useNativeDriver: true }),
      Animated.timing(shade, { toValue: visible ? 1 : 0, duration, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => animation.stop();
  }, [visible, width, reduceMotion, slide, shade]);

  if (!mounted && !visible) return null;

  const newChat = () => {
    onNewChat();
    onClose();
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.shade, { opacity: shade }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.drawer,
          { width, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 20, transform: [{ translateX: slide }] },
        ]}
        testID="coach.drawer"
      >
        <View style={styles.logo}>
          <Wordmark height={26} color="#FFFFFF" />
        </View>

        <View style={styles.nav}>
          <NavItem icon="add" label={t('coach.drawer.add_chat')} onPress={newChat} testID="coach.drawer.add_chat" />
          <NavItem icon="heart-outline" label={t('coach.drawer.saved')} onPress={onSaved} testID="coach.drawer.saved" />
        </View>

        <LPText size={13} weight="semibold" color={coachPalette.textMeta} tracking={0.5} style={styles.recentsHeading} accessibilityRole="header">
          {t('coach.drawer.recents')}
        </LPText>

        <ScrollView style={styles.recents} showsVerticalScrollIndicator={false}>
          {recentChats.length === 0 ? (
            <LPText size={14} color={coachPalette.textMeta} style={styles.noRecents}>
              {t('coach.drawer.no_recents')}
            </LPText>
          ) : (
            recentChats.map((chat) => (
              <Pressable
                key={chat.id}
                onPress={() => onSelectRecent(chat.id)}
                style={({ pressed }) => [styles.recent, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={chat.title}
                testID={`coach.drawer.recent.${chat.id}`}
              >
                <LPText size={15} color={coachPalette.textSecondary} numberOfLines={1}>
                  {chat.title}
                </LPText>
              </Pressable>
            ))
          )}
        </ScrollView>

        <Pressable
          onPress={newChat}
          style={({ pressed }) => [styles.newChat, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t('coach.drawer.new_chat')}
          testID="coach.drawer.new_chat"
        >
          <Ionicons name="add-circle-outline" size={18} color={coachPalette.textPrimary} />
          <LPText size={15} weight="semibold" color={coachPalette.textPrimary}>
            {t('coach.drawer.new_chat')}
          </LPText>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

function NavItem({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: 'add' | 'heart-outline';
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <View style={styles.navIcon}>
        <Ionicons name={icon} size={18} color={coachPalette.textPrimary} />
      </View>
      <LPText size={16} color={coachPalette.textPrimary}>
        {label}
      </LPText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shade: { backgroundColor: coachPalette.drawerScrim },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: 24,
    backgroundColor: coachPalette.drawer,
  },
  logo: { marginBottom: 36, alignItems: 'flex-start' },
  nav: { marginBottom: 28, gap: 2 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11, minHeight: 48 },
  navIcon: { width: 20, alignItems: 'center' },
  recentsHeading: { marginBottom: 6 },
  recents: { flex: 1 },
  noRecents: { paddingVertical: 8 },
  recent: { paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  newChat: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: coachPalette.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: coachPalette.glassStroke,
  },
  pressed: { opacity: 0.7 },
});
