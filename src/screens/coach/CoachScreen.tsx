/* eslint lifepass/no-literal-copy: "error" */
// The Coach tab (iOS CoachView.swift), over the chat store
// (src/features/coach/store/coachStore.ts, the port of CoachViewModel).
//
//   the photo, under the 2.5.4 ink scrim
//   the wordmark ABOVE the burger (the drawer: new chat, saved, recents)
//   before the member says anything: the heading and the chips;
//   after: the chat (bubbles, question chips, venue cards, the flows' cards)
//   the free tier's count line or membership card
//   the input: 1 to 5 lines, Send on the keyboard, the mic while empty, the
//   send arrow while not; locked (55%, its own placeholder) while an
//   allowance is spent
//
// On every appearance (iOS `onAppear`): the profile's coach block is applied
// (the newer reading wins), and whatever another tab parked for the Coach (a
// prompt, a programme entry) is taken and run once. An entry parked while
// this tab has a page pushed (a venue from Book it, Saved, Account) first
// takes the tab back to the chat: iOS rebuilds the tab on a switch, so its
// Coach always appears and sends at once. The conversation lives in the
// store, so it survives tab switches. Location is NOT asked for here: the
// venue wizard warms a fix when it starts.
//
// The saved chats are read only once the sign-in hook has claimed them for
// this member (src/features/coach/register.ts); the screen never reads them
// on a sign-in of its own, since the tabs can stay mounted through one.
import { useFocusEffect } from '@react-navigation/native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { setStatusBarStyle } from 'expo-status-bar';
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  ImageBackground,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isLiveProgramStatus } from '../../api/profile';
import { LPText, Wordmark } from '../../components/ui';
import { inputPromptKey } from '../../features/coach/freeTier/freeTier';
import FreeTierStrip from '../../features/coach/freeTier/FreeTierStrip';
import type { CoachRoute } from '../../features/coach/store/host';
import { hasStartedChat, isFlowBubble, type CoachMessage } from '../../features/coach/store/messages';
import {
  COACH_FLOWS,
  selectIsAILocked,
  selectRecentChats,
  useCoachStore,
} from '../../features/coach/store/coachStore';
import { usePlanEditOffered } from '../../features/coach/planEdit';
import { coachPalette, LOCKED_INPUT_OPACITY } from '../../features/coach/theme/palette';
import { selectHasLiveProgram, useHealthStore } from '../../health';
import { useT } from '../../i18n';
import { openSharedRoute } from '../../navigation/sharedSheet';
import type { AppNavigation, TabRootProps } from '../../navigation/types';
import { selectSupportsPlanRevision, useAppStore } from '../../stores/appStore';
import { useIntentStore } from '../../stores/intentStore';
import { TAB_BAR_HEIGHT } from '../../navigation/CustomTabBar';
import type { Venue } from '../../types/venue';
import { CategoryPrompt } from './CategoryStrip';
import ChatDrawer from './ChatDrawer';
import { MessageBubble, TypingIndicator } from './MessageBubble';
import MicButton from './MicButton';
import QuestionBubbleMessage from './QuestionBubbleMessage';
import SuggestionChips, { type SuggestionChipAction } from './SuggestionChips';
import { useDictation, type Dictation } from './useDictation';
import VenueCarouselMessage from './VenueCarouselMessage';

const BACKGROUND = require('../../../assets/bg-chat.jpg');

/** The input grows to five lines (iOS `.lineLimit(1...5)`). */
const INPUT_LINES = 5;
const INPUT_LINE_HEIGHT = 20;
const INPUT_PADDING_V = 11;

/**
 * How much of the window the keyboard covers. Android draws edge to edge, so
 * the window never resizes for the keyboard; and some phones under-report the
 * keyboard's height (they miss the navigation bar strip), so its top edge in
 * SCREEN coordinates decides.
 */
function useKeyboardCoverage(): number {
  const [coverage, setCoverage] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      const { height = 0, screenY } = event.endCoordinates ?? {};
      const screenHeight = Dimensions.get('screen').height;
      setCoverage(typeof screenY === 'number' ? Math.max(height, screenHeight - screenY) : height);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setCoverage(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return coverage;
}

export default function CoachScreen({ navigation, route }: Partial<TabRootProps<'CoachMain'>>) {
  const nav = navigation as unknown as AppNavigation;
  const { t, language } = useT();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const tabBarHeight = useContext(BottomTabBarHeightContext);
  const keyboard = useKeyboardCoverage();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The input's text is NOT read here (./CoachInputBar below): a keystroke or
  // a dictation partial re-renders the bar, not every row of the chat.
  const messages = useCoachStore((s) => s.messages);
  const isTyping = useCoachStore((s) => s.isTyping);
  const freeLimitReached = useCoachStore((s) => s.freeLimitReached);
  const freeMessages = useCoachStore((s) => s.freeMessages);
  const upgrade = useCoachStore((s) => s.upgrade);
  const savedSessions = useCoachStore((s) => s.savedSessions);
  const pendingRoute = useCoachStore((s) => s.pendingRoute);
  const claimed = useCoachStore((s) => s.memberId !== null && s.claimedFor === s.memberId);

  const coachBlock = useAppStore((s) => s.profile?.coach ?? null);
  const profileReadAt = useAppStore((s) => s.profileReadAt);
  const healthAccess = useAppStore((s) => s.healthAccess);
  const supportsPlanRevision = useAppStore(selectSupportsPlanRevision);
  const profileProgramLive = useAppStore((s) => isLiveProgramStatus(s.profile?.health?.program?.status));
  const todayProgramLive = useHealthStore(selectHasLiveProgram);
  // A custom plan refuses a revision: its chip is never "Adjust my plan".
  const todayProgramCustom = useHealthStore((s) => s.today?.program?.custom === true);
  const planEditOffered = usePlanEditOffered();

  const coach = useCoachStore.getState;
  const started = hasStartedChat(messages);
  const recentChats = useMemo(() => selectRecentChats({ savedSessions }), [savedSessions]);

  const dictation = useDictation((text) => coach().setInputText(text));
  const stopDictation = dictation.stop;

  // MARK: The account

  // The chats belong to the member signed in: read once the sign-in hook has
  // claimed them (the store refuses before that; the claim also reads them).
  useEffect(() => {
    if (claimed) void coach().loadSessions();
  }, [claimed, coach]);

  // The greeting follows the account language while it is all there is.
  useEffect(() => {
    coach().updateLanguage();
  }, [language, coach]);

  // A membership bought from the prompt (or anywhere) lifts the free lock on
  // the next profile read; an older read changes nothing.
  useEffect(() => {
    coach().applyProfileCoach(coachBlock, profileReadAt);
  }, [coachBlock, profileReadAt, coach]);

  // MARK: Every appearance

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      const state = useAppStore.getState();
      coach().applyProfileCoach(state.profile?.coach ?? null, state.profileReadAt);
      void coach().consumeParkedEntries();
      // Something parked while the Coach is already on screen.
      const unsubscribe = useIntentStore.subscribe((intents, previous) => {
        const promptArrived = intents.pendingCoachPrompt !== null && intents.pendingCoachPrompt !== previous.pendingCoachPrompt;
        const programArrived =
          intents.pendingCoachProgram !== null && intents.pendingCoachProgram !== previous.pendingCoachProgram;
        const planEditArrived =
          intents.pendingCoachPlanEdit !== null && intents.pendingCoachPlanEdit !== previous.pendingCoachPlanEdit;
        if (promptArrived || programArrived || planEditArrived) void coach().consumeParkedEntries();
      });
      return () => {
        unsubscribe();
        // Leaving the tab stops the mic (iOS `onDisappear { speech.stop() }`).
        stopDictation();
        setStatusBarStyle('dark');
      };
    }, [coach, stopDictation]),
  );

  // An entry parked while a page is pushed on this tab (focused or not):
  // back to the chat, whose focus then runs it. Mounted, not focused: the
  // chat is not focused exactly when a page covers it.
  useEffect(() => {
    if (!navigation) return undefined;
    return useIntentStore.subscribe((intents, previous) => {
      const promptArrived = intents.pendingCoachPrompt !== null && intents.pendingCoachPrompt !== previous.pendingCoachPrompt;
      const programArrived =
        intents.pendingCoachProgram !== null && intents.pendingCoachProgram !== previous.pendingCoachProgram;
      const planEditArrived =
        intents.pendingCoachPlanEdit !== null && intents.pendingCoachPlanEdit !== previous.pendingCoachPlanEdit;
      if (!promptArrived && !programArrived && !planEditArrived) return;
      const stack = navigation.getState();
      if (stack && stack.index > 0) navigation.popToTop();
    });
  }, [navigation]);

  // The first build's Home passed its prompt as a route param; it is parked
  // like any other, so it is sent once per tap, never once per mount.
  const legacyPrompt = route?.params?.prefilledMessage;
  useEffect(() => {
    if (!legacyPrompt) return;
    navigation?.setParams({ prefilledMessage: undefined });
    useIntentStore.getState().parkCoachPrompt(legacyPrompt);
  }, [legacyPrompt, navigation]);

  // MARK: Routes a flow asks for

  const perform = useCallback(
    (target: CoachRoute) => {
      const intents = useIntentStore.getState();
      switch (target.kind) {
        case 'plans':
          nav.navigate('Plans', undefined);
          return;
        case 'account':
          openSharedRoute(nav, 'Account');
          return;
        case 'planTab':
          intents.requestTab('Plan');
          return;
        case 'pastPlans':
          intents.parkPlanAction({ kind: 'openPastPlans' });
          intents.requestTab('Plan');
          return;
        case 'savedProposal':
          intents.parkPlanAction({ kind: 'openProposal' });
          intents.requestTab('Plan');
          return;
        case 'venue':
          openSharedRoute(nav, 'VenueDetail', { slug: target.slug });
          return;
        case 'sight':
          openSharedRoute(nav, 'AttractionDetail', { slug: target.slug });
          return;
      }
    },
    [nav],
  );

  useEffect(() => {
    if (!pendingRoute) return;
    const target = coach().takeRoute();
    if (target) perform(target);
  }, [pendingRoute, perform, coach]);

  // MARK: Actions

  const openVenue = useCallback((venue: Venue) => perform({ kind: 'venue', slug: venue.slug }), [perform]);

  /** The app's own memberships screen; the public plans page only when the server asks for one this build has no screen for. */
  const openMembership = useCallback(() => {
    if (upgrade?.action && upgrade.action !== 'plans' && upgrade.url) {
      void Linking.openURL(upgrade.url);
    } else {
      perform({ kind: 'plans' });
    }
  }, [upgrade, perform]);

  const onChip = (action: SuggestionChipAction) => {
    switch (action.kind) {
      case 'categoryPicker':
        coach().showCategoryPicker(action.labelKey);
        return;
      case 'search':
        coach().startSearch(action.categoryKey, action.labelKey);
        return;
      case 'plan':
        void coach().startPlan(action.labelKey);
        return;
      case 'program':
        void coach().startProgram();
        return;
      case 'adjust':
        void coach().startAdjust();
        return;
      case 'planEdit':
        void coach().startPlanEdit();
        return;
    }
  };

  const send = useCallback(() => {
    Keyboard.dismiss();
    // Cancels: nothing the recogniser still says lands in the emptied input.
    stopDictation();
    void coach().send(coach().inputText);
  }, [coach, stopDictation]);

  // MARK: The chat list

  const scroll = useRef<ScrollView>(null);
  const offsets = useRef(new Map<string, number>());
  const noteOffset = useCallback((id: string, y: number) => {
    offsets.current.set(id, y);
  }, []);
  const last = messages[messages.length - 1];
  const lastId = last?.id;
  const lastAnchorsTop = !!last?.anchorTop;

  // New messages scroll to the end, where the chips and buttons are; a day
  // plan (`anchorTop`) is taller than the screen, so it lands on its top and
  // the member reads down through it (iOS `last.plan == nil ? .bottom : .top`).
  useEffect(() => {
    if (!started || !lastId) return;
    const timer = setTimeout(() => {
      const top = lastAnchorsTop ? offsets.current.get(lastId) : undefined;
      if (top !== undefined) scroll.current?.scrollTo({ y: Math.max(0, top - 8), animated: true });
      else scroll.current?.scrollToEnd({ animated: true });
    }, 60);
    return () => clearTimeout(timer);
  }, [messages.length, lastId, lastAnchorsTop, started]);

  useEffect(() => {
    if (isTyping) scroll.current?.scrollToEnd({ animated: true });
  }, [isTyping]);

  // MARK: Layout

  // Above the keyboard when it is up; otherwise clear of the floating tab bar
  // (iOS: the safe area plus 96).
  const barClearance = tabBarHeight ?? TAB_BAR_HEIGHT + insets.bottom;
  const bottomPadding = keyboard > 0 ? keyboard + 8 : barClearance + 20;
  const inputMaxHeight = INPUT_LINES * INPUT_LINE_HEIGHT * Math.max(1, fontScale) + INPUT_PADDING_V * 2;

  return (
    <View style={styles.root} testID="coach.screen">
      <ImageBackground source={BACKGROUND} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false}>
        <LinearGradient
          pointerEvents="none"
          colors={coachPalette.scrimColors}
          locations={coachPalette.scrimLocations}
          style={StyleSheet.absoluteFill}
        />
      </ImageBackground>

      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
        <Wordmark height={22} color="#FFFFFF" />
        <Pressable
          onPress={() => setDrawerOpen(true)}
          style={styles.burger}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('coach.android.a11y.menu')}
          testID="coach.menu"
        >
          <Ionicons name="menu-outline" size={26} color="#FFFFFF" />
        </Pressable>
      </View>

      <View style={[styles.body, { paddingBottom: bottomPadding }]}>
        {/* A tap on the chat's background closes the keyboard through the
            scroll views themselves (keyboardShouldPersistTaps="handled":
            a tap no child takes blurs the input), never on a touch that
            lands in a field: the question bubble's "Other" keeps focus. */}
        <View style={styles.content}>
          {started ? (
            <ScrollView
              ref={scroll}
              style={styles.flex}
              contentContainerStyle={styles.chat}
              showsVerticalScrollIndicator={false}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              testID="coach.chat"
            >
              {messages.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  busy={isFlowBubble(message) ? isTyping : false}
                  onBook={openVenue}
                  onOffset={noteOffset}
                />
              ))}
              {isTyping ? <TypingIndicator /> : null}
            </ScrollView>
          ) : (
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.empty}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <LPText
                serif
                size={32}
                color="#FFFFFF"
                align="center"
                tracking={-0.5}
                style={styles.heading}
                accessibilityRole="header"
                testID="coach.empty.heading"
              >
                {t('coach.empty.heading')}
              </LPText>
              <View style={styles.flex} />
              <SuggestionChips
                isMinor={healthAccess === 'minor'}
                programChipAdjusts={(todayProgramLive || profileProgramLive) && supportsPlanRevision && !todayProgramCustom}
                programChipEdits={planEditOffered}
                onAction={onChip}
              />
            </ScrollView>
          )}
        </View>

        <FreeTierStrip freeMessages={freeMessages} freeLimitReached={freeLimitReached} onGetMembership={openMembership} />

        <CoachInputBar dictation={dictation} onSend={send} maxHeight={inputMaxHeight} />
      </View>

      <ChatDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNewChat={() => coach().resetChat()}
        onSaved={() => {
          setDrawerOpen(false);
          openSharedRoute(nav, 'Profile', { initialTab: 'saved' });
        }}
        recentChats={recentChats}
        onSelectRecent={(id) => {
          coach().restoreSession(id);
          setDrawerOpen(false);
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// One row of the chat. Memoised: a row draws again only when its message (a
// new object only when that message changed), its busy flag or a callback
// changes, never on a keystroke.

type MessageRowProps = {
  message: CoachMessage;
  /** For a flow's own bubble only (iOS `isBusy: vm.isTyping`); false for every other row. */
  busy: boolean;
  onBook: (venue: Venue) => void;
  onOffset: (id: string, y: number) => void;
};

const MessageRow = memo(function MessageRow({ message, busy, onBook, onOffset }: MessageRowProps) {
  return (
    <View onLayout={(event: LayoutChangeEvent) => onOffset(message.id, event.nativeEvent.layout.y)}>
      <MessageContent message={message} busy={busy} onBook={onBook} />
    </View>
  );
});

function MessageContent({ message, busy, onBook }: Omit<MessageRowProps, 'onOffset'>) {
  if (isFlowBubble(message)) {
    const Renderer = COACH_FLOWS[message.flow].renderers[message.kind];
    // The message as the store keeps it (no copy), so a renderer can memoise on it.
    if (Renderer) return <Renderer message={message} busy={busy} />;
  }
  if (message.venues && message.venues.length > 0) {
    return <VenueCarouselMessage intro={message.text} venues={message.venues} onBook={onBook} />;
  }
  if (message.options && message.options.length > 0) {
    return (
      <QuestionBubbleMessage
        question={message.text}
        options={message.options}
        answered={!!message.answered}
        selectedAnswer={message.selectedAnswer}
        onSelect={(value, label) => void useCoachStore.getState().selectOption(message.id, value, label)}
      />
    );
  }
  if (message.showCategoryStrip) {
    return (
      <CategoryPrompt
        intro={message.text}
        onSelect={(tile) => useCoachStore.getState().startSearch(tile.id, tile.labelKey)}
      />
    );
  }
  return <MessageBubble role={message.role} text={message.text} />;
}

// ---------------------------------------------------------------------------
// The input: 1 to 5 lines, Send on the keyboard, the mic while empty, the
// send arrow while not; locked (55%, its own placeholder) while an allowance
// is spent. Its own component, so the text it follows re-renders only it.

function CoachInputBar({
  dictation,
  onSend,
  maxHeight,
}: {
  dictation: Dictation;
  onSend: () => void;
  maxHeight: number;
}) {
  const { t } = useT();
  const inputText = useCoachStore((s) => s.inputText);
  const isTyping = useCoachStore((s) => s.isTyping);
  // Locked only while the plan cannot be changed in chat either (the lock
  // covers the chat, not the plan change).
  const aiLocked = useCoachStore(selectIsAILocked);
  const planEditOffered = usePlanEditOffered();
  const locked = aiLocked && !planEditOffered;
  const limitReached = useCoachStore((s) => s.limitReached);
  const freeLimitReached = useCoachStore((s) => s.freeLimitReached);
  const inputEmpty = inputText.trim().length === 0;
  const prompt = t(inputPromptKey({ limitReached, freeLimitReached }));

  return (
    <View style={[styles.inputBar, locked && { opacity: LOCKED_INPUT_OPACITY }]}>
      <TextInput
        value={inputText}
        onChangeText={(text) => useCoachStore.getState().setInputText(text)}
        placeholder={prompt}
        placeholderTextColor={coachPalette.placeholder}
        editable={!locked}
        multiline
        submitBehavior="blurAndSubmit"
        returnKeyType="send"
        enterKeyHint="send"
        onSubmitEditing={onSend}
        selectionColor={coachPalette.accent}
        underlineColorAndroid="transparent"
        textAlignVertical="center"
        style={[styles.input, { maxHeight }]}
        accessibilityLabel={prompt}
        accessibilityState={{ disabled: locked }}
        testID="coach.input"
      />
      {dictation.isRecording ? (
        <MicButton recording disabled={false} onStart={() => undefined} onStop={dictation.stop} />
      ) : inputEmpty ? (
        dictation.available ? (
          <MicButton recording={false} disabled={locked} onStart={() => void dictation.start()} onStop={dictation.stop} />
        ) : null
      ) : (
        <Pressable
          onPress={onSend}
          disabled={isTyping}
          style={({ pressed }) => [styles.send, (pressed || isTyping) && styles.sendDimmed]}
          accessibilityRole="button"
          accessibilityLabel={t('coach.a11y.send_message')}
          accessibilityState={{ disabled: isTyping }}
          testID="coach.send"
        >
          <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: coachPalette.ink },
  flex: { flex: 1 },
  topBar: { paddingHorizontal: 20, paddingBottom: 4, gap: 6, alignItems: 'flex-start' },
  burger: { width: 42, height: 42, justifyContent: 'center' },
  body: { flex: 1 },
  content: { flex: 1 },
  chat: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 20, gap: 14 },
  empty: { flexGrow: 1 },
  heading: { paddingHorizontal: 28, paddingTop: 48, lineHeight: 42 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 16, paddingTop: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 18,
    paddingVertical: INPUT_PADDING_V,
    fontSize: 15,
    lineHeight: INPUT_LINE_HEIGHT,
    color: '#FFFFFF',
    borderRadius: 26,
    backgroundColor: coachPalette.inputFill,
    borderWidth: 0.8,
    borderColor: coachPalette.stroke,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: coachPalette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDimmed: { opacity: 0.6 },
});
