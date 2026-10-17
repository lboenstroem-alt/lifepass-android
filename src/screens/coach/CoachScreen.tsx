import { useState, useRef, useMemo, useEffect, type ComponentType } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Image,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ImageBackground,
  Keyboard,
  Dimensions,
} from 'react-native';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation, type RouteProp } from '@react-navigation/native';
import { colors } from './coachTheme';
import { fonts } from '../../theme';
import WaveIcon from '../../components/WaveIcon';
import Wordmark from '../../components/Wordmark';
import {
  mockCoachMessages,
  selectChips,
} from '../../data/mockCoach';
import { deriveActivityTags } from '../../coach/deriveTags';
import {
  loadSessions,
  buildSession,
  upsertSession,
  messagesFromSession,
  type ChatSession,
} from '../../coach/chatSessions';
import { sendCoachMessage } from '../../supabase/services/coach';
import { useBookings } from '../../supabase/hooks/useBookings';
import { useFavouriteVenues } from '../../supabase/hooks/useFavourites';
import type { ChatMessage, VenueCard } from '../../types/coach';
import type { CoachStackParamList } from '../../navigation/types';
import {
  detectVenueCategory,
  VENUE_QUESTIONS,
  coachLocationFilter,
  coachCategoryOverride,
  icelandRegion,
  type CoachLocationFilter,
} from '../../data/coachQuestions';
import { coachCategories } from '../../data/coachCategories';
import { deriveCoachHeading } from '../../utils/activityHeading';
import { fetchVenuesFromAPI } from '../../supabase/services/venues';
import type { LegacyVenue as Venue } from '../../types/venue';
import type { SuggestionChip } from '../../data/mockCoach';
import ChatDrawer from './ChatDrawer';
import SuggestionChips from './SuggestionChips';
import VenueCarouselMessage from './VenueCarouselMessage';
import QuestionBubbleMessage from './QuestionBubbleMessage';

let idCounter = 100;
const nextId = () => String(++idCounter);

// Voice dictation lives in a separate module so its native import (which
// THROWS in Expo Go, where the speech native module is absent) only ever
// evaluates when that module is actually present. Null in Expo Go / web →
// the mic button is simply hidden; wired for real in a dev/production build.
type MicButtonComponent = ComponentType<{ onTranscript: (text: string) => void }>;
let MicButton: MicButtonComponent | null = null;
try {
  MicButton = require('./MicButton').default as MicButtonComponent;
} catch {
  MicButton = null;
}


export default function CoachScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<CoachStackParamList, 'CoachMain'>>();
  const prefilledMessage = route.params?.prefilledMessage;

  const { bookings: pastBookings }     = useBookings(false);
  const { bookings: upcomingBookings } = useBookings(true);
  const { savedVenues } = useFavouriteVenues();

  const contextHeading = useMemo(
    () => deriveCoachHeading(pastBookings, upcomingBookings),
    [pastBookings, upcomingBookings],
  );

  const [messages, setMessages] = useState<ChatMessage[]>(mockCoachMessages);
  // Persisted RECENTS (drawer) — up to 4 past conversations.
  const [savedSessions, setSavedSessions] = useState<ChatSession[]>([]);
  // Id of the on-screen conversation once saved/restored, so re-persisting
  // upserts the SAME recents entry instead of minting a duplicate.
  const currentSessionIdRef = useRef<string | null>(null);
  // Bumped by resetChat/restoreSession — in-flight AI/venue replies capture
  // it and drop their append when the chat changed underneath them.
  const chatGenRef = useRef(0);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const categoryScrollRef = useRef<ScrollView | null>(null);
  const autoSentRef = useRef(false);

  // MIC UNWIRED — restore before launch
  // useSpeechRecognitionEvent('start', () => setIsListening(true));
  // useSpeechRecognitionEvent('end',   () => setIsListening(false));
  // useSpeechRecognitionEvent('result', (event) => {
  //   const transcript = event.results[0]?.transcript ?? '';
  //   if (transcript) setInput(transcript);
  // });
  // useSpeechRecognitionEvent('error', () => setIsListening(false));

  // Q&A flow state — tracks which category and step we're on
  const [qaFlow, setQaFlow] = useState<{
    category: string;
    step: number;
    answers: string[];
  } | null>(null);

  // Request location permission on mount and cache coordinates for "Close by" chip
  // Load the persisted recents once on mount.
  useEffect(() => {
    loadSessions().then(setSavedSessions);
  }, []);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUserCoords({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    })();
  }, []);

  // Hide category strip and remove excess bottom padding while keyboard is open
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => {
      // Android edge-to-edge under-reports endCoordinates.height (it misses the
      // nav-bar strip the window draws behind), leaving the input hidden on some
      // OEM skins (OnePlus/OxygenOS). The input bar is anchored inside the
      // full-bleed edge-to-edge container, so coverage must be measured against
      // the PHYSICAL screen height — some OEMs shrink window.height by the
      // nav-bar area, which pushed the bar too low. screenY is the keyboard's
      // top edge in screen coords; on phones where window == screen (e.g. many
      // Samsung One UI builds) this is identical to before, so no regression.
      const { height = 0, screenY } = e.endCoordinates ?? {};
      const screenH = Dimensions.get('screen').height;
      const coverage = screenY != null ? Math.max(height, screenH - screenY) : height;
      setKeyboardHeight(coverage);
    });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Derive activity tags from real bookings + favourited venues, then pick
  // the 4 most-relevant suggestion chips from the bank.
  const userTags = useMemo(
    () => deriveActivityTags({ bookings: pastBookings, favourites: savedVenues }),
    [pastBookings, savedVenues],
  );
  const chips = useMemo(() => selectChips(userTags), [userTags]);

  const hasStartedChat = messages.some((m) => m.role === 'user');

  // ── Core AI call (bypasses Q&A detection) ────────────────────────────────
  async function callAI(outgoing: ChatMessage[]) {
    const gen = chatGenRef.current; // drop the reply if the chat changes
    setIsTyping(true);
    try {
      // Strip Q&A messages from history so the AI only sees real conversation
      const clean = outgoing.filter((m) => !m.questionOptions);
      const reply = await sendCoachMessage(clean);
      if (gen !== chatGenRef.current) return; // chat was reset/restored mid-flight
      setMessages((m) => [
        ...m,
        {
          id: nextId(),
          role: 'assistant',
          text: reply.text,
          venueCards: reply.venueCards,
          searchQuery: reply.searchQuery,
          createdAt: new Date(),
        },
      ]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e) {
      if (gen !== chatGenRef.current) return; // chat was reset/restored mid-flight
      const err = e instanceof Error ? e.message : 'Coach is unavailable right now.';
      setMessages((m) => [
        ...m,
        {
          id: nextId(),
          role: 'assistant',
          text: `Sorry. ${err}`,
          createdAt: new Date(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }

  // ── Start Q&A flow when a venue category is detected ─────────────────────
  function startQAFlow(userText: string, category: string) {
    const questions = VENUE_QUESTIONS[category];
    const q = questions[0];
    const userMsg: ChatMessage = { id: nextId(), role: 'user', text: userText, createdAt: new Date() };
    const questionMsg: ChatMessage = {
      id: nextId(),
      role: 'assistant',
      text: q.text,
      questionOptions: q.options,
      createdAt: new Date(),
    };
    setMessages((m) => [...m, userMsg, questionMsg]);
    setQaFlow({ category, step: 0, answers: [] });
    setInput('');
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }

  // ── Venue querying (mirrors iOS CoachViewModel.queryVenues) ───────────────

  // Maps a Coach venue-search key (from detectVenueCategory) to a single
  // DB category the /venues API understands.
  function apiCategory(key: string): string {
    switch (key) {
      case 'gym':      return 'Gym';
      case 'lagoon':   return 'Lagoon';
      case 'yoga':     return 'Yoga';
      case 'swimming': return 'Pool';
      case 'spa':      return 'Spa';
      case 'golf':     return 'Golf';
      default:         return key;
    }
  }

  // User-facing word for a broad search key, for chat copy — "swimming"
  // reads better to a member than the DB's "Pool".
  function displayCategoryName(key: string): string {
    return key; // the internal keys are already readable English words
  }

  function haversineMeters(
    lat1: number, lon1: number,
    lat2: number, lon2: number,
  ): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Same threshold iOS uses when routed ETAs are unavailable — RN has no
  // MapKit routing, so the straight-line fallback IS the filter here.
  const NEARBY_RADIUS_METERS = 15_000;
  const REYKJAVIK_CENTRE = { latitude: 64.1466, longitude: -21.9426 };

  // The "Where in Iceland?" chip is honoured client-side (the API has no
  // geo filter): 15-min drive → distance from the user's position
  // (Reykjavík fallback), nearest first; a region → venues whose
  // coordinates fall in that region; none → list untouched.
  function applyLocationFilter(
    venues: Venue[],
    filter: CoachLocationFilter,
  ): { venues: Venue[]; note?: string } {
    switch (filter.kind) {
      case 'none':
        return { venues };

      case 'region':
        return {
          venues: venues.filter((v) => {
            if (!v.latitude || !v.longitude) return false;
            return icelandRegion(v.latitude, v.longitude) === filter.region;
          }),
        };

      case 'nearbyDrive': {
        const hasFix = userCoords != null;
        const origin = userCoords ?? REYKJAVIK_CENTRE;

        const ranked = venues
          .filter((v) => v.latitude && v.longitude)
          .map((v) => ({
            venue: v,
            meters: haversineMeters(origin.latitude, origin.longitude, v.latitude as number, v.longitude as number),
          }))
          .sort((a, b) => a.meters - b.meters);
        const within = ranked.filter((r) => r.meters <= NEARBY_RADIUS_METERS).map((r) => r.venue);
        const all = ranked.map((r) => r.venue);

        if (!hasFix) {
          // No real location — measuring from Reykjavík centre. Prefer the
          // within-radius set (most venues are in the capital), else the
          // closest, and be honest about the origin.
          const pool = within.length > 0 ? within : all;
          return {
            venues: pool,
            note: pool.length > 0
              ? "I don't have your location yet, so these are around Reykjavík. Turn on location for spots near you:"
              : undefined,
          };
        }
        if (within.length === 0) {
          // Nothing within ~15 min — surface the closest options instead of
          // an empty result, and say so.
          return {
            venues: all,
            note: all.length > 0
              ? 'Nothing within a 15-minute drive, so here are the closest:'
              : undefined,
          };
        }
        return { venues: within };
      }
    }
  }

  function venueCardOf(v: Venue, category: string): VenueCard {
    return {
      id: v.id,
      name: v.name,
      location: [v.city, v.address].filter(Boolean).join(' · '),
      description: v.description || '',
      imageUrl: v.imageUrl,
      creditCost: v.creditCost,
      category: v.category?.[0] ?? category,
      // Pricing passthrough for the card's "Included"/premium pill
      inBundle: v.inBundle,
      surchargePrice: v.surchargePrice,
      resolvedSurchargePrice: v.resolvedSurchargePrice,
      topupPrice: v.topupPrice,
      daypassPrice: v.daypassPrice,
      primaryCategory: v.primaryCategory,
    };
  }

  async function queryVenues(category: string, answers: string[]) {
    const gen = chatGenRef.current; // drop the reply if the chat changes
    setIsTyping(true);
    try {
      // A specific training-type chip (e.g. "MMA & Combat") can target a
      // narrower DB category than the broad one; use it so the matching
      // venue surfaces (e.g. Mjölnir for MMA). Fall back to the broad
      // category if the narrower query comes back empty.
      const broadCategory = apiCategory(category);
      const override = coachCategoryOverride(answers);
      // Fetch a generous set, then filter by the member's location chip
      // client-side. 100 gives the distance/region filters enough to choose
      // from before we trim to 10 cards.
      let all = await fetchVenuesFromAPI(override ?? broadCategory, 100);
      let usedOverride = override != null;
      if (all.length === 0 && override != null) {
        all = await fetchVenuesFromAPI(broadCategory, 100);
        usedOverride = false;
      }
      const result = applyLocationFilter(all, coachLocationFilter(answers));
      if (gen !== chatGenRef.current) return; // chat was reset/restored mid-flight
      const shown = result.venues.slice(0, 10);

      // What the member asked for (e.g. "MMA"), vs. what we're showing —
      // a broad fallback shows broad results, so don't mislabel them.
      const wanted = override ?? displayCategoryName(category);
      const showing = (usedOverride ? override : null) ?? displayCategoryName(category);

      if (shown.length === 0) {
        setMessages((m) => [...m, {
          id: nextId(), role: 'assistant',
          text: `Hmm, I couldn't find any ${wanted} options in that area. Try a wider location?`,
          createdAt: new Date(),
        }]);
      } else {
        const intro = result.note
          ?? `Found ${shown.length} ${showing} option${shown.length > 1 ? 's' : ''} for you:`;
        setMessages((m) => [...m, {
          id: nextId(), role: 'assistant',
          text: intro,
          venueCards: shown.map((v) => venueCardOf(v, category)),
          createdAt: new Date(),
        }]);
      }
      // Follow-up: invite the member to explore another category. The
      // category cards start a fresh Q&A flow when tapped.
      setMessages((m) => [...m, {
        id: nextId(), role: 'assistant',
        text: 'Want to explore something else?',
        categoryPicker: true,
        createdAt: new Date(),
      }]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e) {
      if (gen !== chatGenRef.current) return; // chat was reset/restored mid-flight
      setMessages((m) => [...m, {
        id: nextId(), role: 'assistant',
        text: "Sorry, I couldn't load venues right now. Please try again.",
        createdAt: new Date(),
      }]);
    } finally {
      setIsTyping(false);
    }
  }

  // ── Suggestion chips (mirrors iOS showCategoryPicker) ─────────────────────

  // "What's nearby?" / "After work" / "Something new" don't name a venue
  // type, so rather than presuming one they show the same category strip
  // used after a completed search, letting the member pick.
  function showCategoryPicker(chipLabel: string) {
    if (isTyping) return;
    setQaFlow(null);
    setMessages((m) => [
      ...m,
      { id: nextId(), role: 'user', text: chipLabel, createdAt: new Date() },
      {
        id: nextId(), role: 'assistant',
        text: 'What would you like to find nearby?',
        categoryPicker: true,
        createdAt: new Date(),
      },
    ]);
  }

  function handleChipSelect(chip: SuggestionChip) {
    if (chip.showsCategoryStrip) {
      showCategoryPicker(chip.text);
    } else {
      send(chip.prompt);
    }
  }

  // ── Handle chip selection inside a Q&A bubble ─────────────────────────────
  async function handleOptionSelect(msgId: string, value: string, label: string) {
    if (!qaFlow) return;

    // Mark the question message as answered
    setMessages((m) =>
      m.map((msg) =>
        msg.id === msgId
          ? { ...msg, questionAnswered: true, selectedAnswer: label }
          : msg,
      ),
    );

    const newAnswers = [...qaFlow.answers, value];
    const questions = VENUE_QUESTIONS[qaFlow.category];
    const nextStep = qaFlow.step + 1;

    // Add user bubble showing what was selected
    const userMsg: ChatMessage = { id: nextId(), role: 'user', text: label, createdAt: new Date() };

    if (nextStep < questions.length) {
      // Show next question
      const nextQ = questions[nextStep];
      const questionMsg: ChatMessage = {
        id: nextId(),
        role: 'assistant',
        text: nextQ.text,
        questionOptions: nextQ.options,
        createdAt: new Date(),
      };
      setMessages((m) => [...m, userMsg, questionMsg]);
      setQaFlow({ ...qaFlow, step: nextStep, answers: newAnswers });
    } else {
      // All questions answered → query real venues, honouring the location
      // chip (and any other answers) the member picked.
      const { category } = qaFlow;
      setMessages((m) => [...m, userMsg]);
      setQaFlow(null);
      await queryVenues(category, newAnswers);
    }

    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }

  // ── Main send — detects venue searches, otherwise sends to AI ────────────
  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;
    setInput('');

    // If mid-flow and user types manually, treat as answer to current question
    if (qaFlow) {
      const currentQMsg = [...messages].reverse().find((m) => m.questionOptions && !m.questionAnswered);
      if (currentQMsg) {
        handleOptionSelect(currentQMsg.id, trimmed, trimmed);
        return;
      }
    }

    // Detect venue search → start Q&A
    const category = detectVenueCategory(trimmed);
    if (category) {
      startQAFlow(trimmed, category);
      return;
    }

    // Regular message → straight to AI
    const userMsg: ChatMessage = { id: nextId(), role: 'user', text: trimmed, createdAt: new Date() };
    setMessages((m) => [...m, userMsg]);
    callAI([...messages, userMsg]);
  }

  function handleOtherIdeas(searchQuery: string, category: string) {
    send(`Show me other ${searchQuery || category} options in Iceland`);
  }

  function handleBook(venue: VenueCard) {
    // Navigate to the venue detail screen via the Explore stack
    navigation.getParent()?.navigate('Explore', {
      screen: 'VenueDetail',
      params: { venueId: venue.id },
    });
  }

  // Auto-send a message passed via navigation params (e.g. when the user
  // tapped a category card on Home). Fires once on mount only.
  useEffect(() => {
    if (!prefilledMessage || autoSentRef.current) return;
    autoSentRef.current = true;
    send(prefilledMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledMessage]);

  /** Snapshot the live conversation into RECENTS (no-op before the first
   *  user message). Mirrors iOS persistCurrentSession(). */
  async function persistCurrentSession() {
    const session = buildSession(messages, currentSessionIdRef.current);
    if (!session) return;
    currentSessionIdRef.current = session.id;
    setSavedSessions(await upsertSession(savedSessions, session));
  }

  function resetChat() {
    persistCurrentSession(); // save the outgoing chat before wiping it
    chatGenRef.current += 1; // drop any in-flight reply
    currentSessionIdRef.current = null; // the new chat is a brand-new session
    setMessages(mockCoachMessages);
    setInput('');
    setIsTyping(false);
    setQaFlow(null);
  }

  /** Reload a saved session (drawer RECENTS tap). Mirrors iOS restoreSession(). */
  function restoreSession(sessionId: string) {
    // Re-selecting the OPEN session would restore a stale snapshot and
    // silently drop the newest turns — no-op instead.
    if (sessionId === currentSessionIdRef.current) return;
    const session = savedSessions.find((s) => s.id === sessionId);
    if (!session) return;
    // Save the active conversation FIRST so opening a recent never
    // silently discards in-progress work.
    persistCurrentSession();
    chatGenRef.current += 1; // drop any in-flight reply
    currentSessionIdRef.current = session.id;
    setMessages(messagesFromSession(session));
    // Restored messages keep their ORIGINAL ids, which can be ≥ this
    // launch's idCounter — advance it past them so new ids never collide.
    const restoredIds = session.messages
      .map((m) => parseInt(m.id, 10))
      .filter(Number.isFinite);
    idCounter = Math.max(idCounter, ...restoredIds, idCounter);
    setInput('');
    setIsTyping(false);
    setQaFlow(null);
  }

  // Render the category strip (reused in both chat and empty states)
  const CategoryStrip = (
    <View style={styles.categoryStripRow}>
      <TouchableOpacity
        style={styles.categoryArrow}
        onPress={() => categoryScrollRef.current?.scrollTo({ x: 0, animated: true })}
        activeOpacity={0.6}
        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      >
        <Ionicons name="chevron-back" size={16} color="rgba(255,255,255,0.45)" />
      </TouchableOpacity>

      <ScrollView
        ref={categoryScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryScroll}
        style={{ flex: 1 }}
      >
        {coachCategories.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={styles.categoryCard}
            onPress={() => send(cat.prompt)}
            activeOpacity={0.85}
          >
            <Image source={cat.image} style={styles.categoryImage} />
            <Text style={styles.categoryLabel} numberOfLines={2}>
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TouchableOpacity
        style={styles.categoryArrow}
        onPress={() => categoryScrollRef.current?.scrollToEnd({ animated: true })}
        activeOpacity={0.6}
        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      >
        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.45)" />
      </TouchableOpacity>
    </View>
  );

  return (
    // iOS: native 'padding' avoidance smoothly lifts the whole view above the
    // keyboard, so the inputBar only needs a small bottom margin. Android is
    // edge-to-edge (app.json) so the window never resizes and KAV can't help —
    // there we lift the inputBar manually by the measured keyboard height (below).
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <ImageBackground
        source={require('../../../assets/bg-chat.jpg')}
        style={styles.bg}
        resizeMode="cover"
      >
        {/* Light neutral scrim: darkens only the top (heading + status bar) and
            the very bottom (input bar) for legibility, and stays nearly clear
            through the middle so the Seljavallalaug photo reads as the backdrop.
            Neutral (not tinted) so it doesn't fight the photo's cool tones. */}
        <LinearGradient
          pointerEvents="none"
          colors={[
            'rgba(0,0,0,0.45)',
            'rgba(0,0,0,0.10)',
            'rgba(0,0,0,0.14)',
            'rgba(0,0,0,0.52)',
          ]}
          locations={[0, 0.26, 0.72, 1]}
          style={StyleSheet.absoluteFill}
        />

        {/* ── Top bar ── */}
        <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity
            style={styles.burgerBtn}
            onPress={() => setDrawerOpen(true)}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="menu-outline" size={26} color="#FFFFFF" />
          </TouchableOpacity>

          <Wordmark height={17} color={colors.paper} />
          <View style={{ width: 42 }} />
        </View>

        {/* ── Content ── */}
        <View style={{ flex: 1 }}>
          {hasStartedChat ? (
            <ScrollView
              ref={scrollRef}
              style={styles.chatList}
              contentContainerStyle={styles.chatListContent}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              {messages.map((m) =>
                m.venueCards && m.venueCards.length > 0 ? (
                  <VenueCarouselMessage
                    key={m.id}
                    intro={m.text}
                    venues={m.venueCards}
                    searchQuery={m.searchQuery}
                    onOtherIdeas={handleOtherIdeas}
                    onBook={handleBook}
                  />
                ) : m.questionOptions && m.questionOptions.length > 0 ? (
                  <QuestionBubbleMessage
                    key={m.id}
                    question={m.text}
                    options={m.questionOptions}
                    answered={!!m.questionAnswered}
                    selectedAnswer={m.selectedAnswer}
                    onSelect={(value, label) => handleOptionSelect(m.id, value, label)}
                  />
                ) : m.categoryPicker ? (
                  // "Want to explore something else?" — category cards start
                  // a fresh Q&A flow when tapped (same as iOS).
                  <View key={m.id}>
                    <MessageBubble message={m} />
                    {CategoryStrip}
                  </View>
                ) : (
                  <MessageBubble key={m.id} message={m} />
                )
              )}
              {isTyping && <TypingIndicator />}
            </ScrollView>
          ) : (
            <>
              {/* Heading pinned near top */}
              <Pressable style={styles.headingContainer} onPress={Keyboard.dismiss}>
                <Text style={styles.heading}>{contextHeading}</Text>
              </Pressable>
              {/* Flex spacer pushes chips as far down as possible */}
              <View style={{ flex: 1 }} />
              <SuggestionChips chips={chips} onSelect={handleChipSelect} />
            </>
          )}

          {/* ── Input bar ── */}
          {/* Keyboard open → sit the input just above it. iOS: KAV already lifted
              the view, so just an 8px margin. Android: anchor the bar absolutely
              at the keyboard's top edge — immune to flex/padding interactions.
              Closed → in-flow, clearing the floating tab bar (row 76 + inset). */}
          <View
            style={[
              styles.inputBar,
              keyboardHeight > 0 && Platform.OS === 'android'
                ? { position: 'absolute', left: 0, right: 0, bottom: keyboardHeight + 8 }
                : { paddingBottom: keyboardHeight > 0 ? 8 : insets.bottom + 94 },
            ]}
          >
            {/* Send/mic live inside the input pill (trailing). */}
            <View style={styles.inputPill}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Feeling stuck? Let me help!"
                placeholderTextColor="rgba(255,255,255,0.40)"
                style={styles.input}
                multiline
                onSubmitEditing={() => send(input)}
                blurOnSubmit={false}
                selectionColor={colors.blue}
                underlineColorAndroid="transparent"
              />
              {input.trim() ? (
                <TouchableOpacity
                  style={styles.sendButton}
                  onPress={() => send(input)}
                  disabled={isTyping}
                  activeOpacity={0.8}
                >
                  <Ionicons name="arrow-up" size={18} color={colors.ink} />
                </TouchableOpacity>
              ) : MicButton ? (
                // Voice dictation — only present in dev/production builds (hidden
                // in Expo Go, where the speech native module isn't available).
                <MicButton onTranscript={setInput} />
              ) : null}
            </View>
          </View>
        </View>
      </ImageBackground>
      </TouchableWithoutFeedback>

      <ChatDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNewChat={resetChat}
        onSaved={() =>
          navigation.navigate('Bookings', {
            screen: 'BookingsMain',
            params: { initialTab: 'saved' },
          })
        }
        recentChats={savedSessions.map((s) => ({ id: s.id, title: s.title }))}
        onSelectRecent={restoreSession}
      />
    </KeyboardAvoidingView>
  );
}

// ─── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <View style={[bubble.row, isUser && bubble.rowUser]}>
      {!isUser && (
        <View style={bubble.avatar}>
          <WaveIcon size={13} color={colors.paper} />
        </View>
      )}
      <View style={[bubble.wrap, isUser ? bubble.wrapUser : bubble.wrapAssistant]}>
        <Text style={[bubble.text, isUser && bubble.textUser]}>{message.text}</Text>
      </View>
    </View>
  );
}

// ─── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <View style={bubble.row}>
      <View style={bubble.avatar}>
        <WaveIcon size={13} color={colors.paper} />
      </View>
      <View style={[bubble.wrap, bubble.wrapAssistant, bubble.typing]}>
        <View style={bubble.dot} />
        <View style={[bubble.dot, { opacity: 0.6 }]} />
        <View style={[bubble.dot, { opacity: 0.3 }]} />
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ink },
  bg: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  burgerBtn: {
    width: 42, height: 42,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  screenTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.2,
  },

  headingContainer: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 48,
    marginBottom:160,
  },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 36,
    fontWeight: '400',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 46,
    letterSpacing: -0.5,
  },

  chatList: { flex: 1 },
  chatListContent: { paddingTop: 20, paddingHorizontal: 16, paddingBottom: 20, gap: 14 },

  inputBar: {
    paddingHorizontal: 16,
  },
  // The pill wraps the text field + the trailing send/mic button.
  inputPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(26,22,18,0.82)',
    borderRadius: 26,
    borderWidth: 0.8,
    borderColor: 'rgba(255,255,255,0.22)',
    paddingLeft: 18,
    paddingRight: 6,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    paddingVertical: 12,
    fontSize: 15,
    color: '#FFFFFF',
  },
  sendButton: {
    width: 42, height: 42,
    borderRadius: 21,
    // Warm paper button with ink icon — matches the app's editorial CTAs.
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Category image strip — pinned just above input bar
  categoryScroll: {
    gap: 12,
    paddingHorizontal: 8,
  },
  categoryCard: {
    width: 92,
    alignItems: 'center',
    gap: 6,
  },
  categoryImage: {
    width: 82,
    height: 62,
    borderRadius: 12,
    backgroundColor: colors.ink3,
  },
  categoryLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 17,
    // Sits directly on the photo — a soft shadow keeps it crisp anywhere.
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  categoryStripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    marginBottom: 20,
  },
  categoryArrow: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const bubble = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowUser: { justifyContent: 'flex-end' },
  avatar: {
    width: 26, height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  wrap: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  wrapAssistant: {
    // Opaque near-white so the AI's (dark) text stays readable over the photo.
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderTopLeftRadius: 4,
    borderWidth: 0.5,
    borderColor: 'rgba(15,23,42,0.06)',
  },
  wrapUser: {
    // Warm paper bubble with ink text (was bright blue).
    backgroundColor: colors.paper,
    borderTopRightRadius: 4,
  },
  text: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  textUser: { color: colors.ink },
  typing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 14,
  },
  dot: {
    width: 6, height: 6,
    borderRadius: 3,
    backgroundColor: colors.paper2,
  },
});
