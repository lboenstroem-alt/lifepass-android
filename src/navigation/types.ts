/**
 * Every route the app has, and its params (plan 3.0.2). F4 declares them all
 * up front so forty packages can navigate to each other's screens before
 * those screens exist; each screen's owner fills the stub F4 created and
 * keeps the params below.
 *
 * THE SHAPE, as iOS MainTabView builds it:
 *
 *   Root stack
 *   ├─ Auth (stack): Onboarding, Login, SignUp            signed out
 *   ├─ Main (tabs): Home, Explore, Scan, Coach, Plan       signed in
 *   │    each tab is a stack: its own first screen, then every SHARED route
 *   │    (Profile, Account, VenueDetail, ...), so a pushed page keeps the
 *   │    tab bar, as an iOS NavigationStack inside the TabView does
 *   └─ root modals, which cover the tab bar (iOS sheets and full-screen
 *      covers): Plans, WriteReview, ClassesDiscoveryModal, MealCapture,
 *      WorkoutRunner
 *
 * From a screen in any tab, `navigation.navigate('VenueDetail', { slug })`
 * pushes onto that tab's own stack, and `navigation.navigate('Plans')`
 * bubbles up to the root. `useAppNavigation()` (./hooks.ts) is typed for both.
 *
 * LEGACY. The first Android build's screens (src/screens/**) still import the
 * old names at the bottom of this file. They are kept only so those screens
 * compile until their owners rebuild them; at run time the old route names
 * they navigate to are translated (./legacyRoutes.ts). New code never uses
 * them. QA-1 deletes them with the last legacy screen.
 */
import type { BottomTabNavigationProp, BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type {
  CompositeNavigationProp,
  CompositeScreenProps,
  NavigatorScreenParams,
} from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';

// ---------------------------------------------------------------------------
// Tabs

/** The five tabs, in bar order. Scan is the oversized centre button. */
export type MainTab = 'Home' | 'Explore' | 'Scan' | 'Coach' | 'Plan';

/** Bar order (iOS indices 0 to 4). */
export const MAIN_TABS: readonly MainTab[] = ['Home', 'Explore', 'Scan', 'Coach', 'Plan'];

/** Each tab's first screen, the root of its stack. */
export const TAB_ROOT_SCREEN = {
  Home: 'HomeMain',
  Explore: 'ExploreMain',
  Scan: 'ScanMain',
  Coach: 'CoachMain',
  Plan: 'PlanMain',
} as const satisfies Record<MainTab, string>;

// ---------------------------------------------------------------------------
// Param shapes shared by several routes

/** Which half of Profile (iOS LibraryView) opens. */
export type ProfileTab = 'bookings' | 'saved';

/** The activity a booking is for (iOS `BookingView(activity:)`). */
export interface BookingFlowActivity {
  readonly id: string;
  readonly name: string;
  /** The booking provider (`activities.provider`), null when the venue books it itself. */
  readonly provider: string | null;
}

/** Plans opens on one of its two halves (iOS `plans.segment.*`). */
export type PlansSegment = 'monthly' | 'passes';

/** Body and goals can be asked to open on one section (iOS `BodyAndGoalsView.Anchor`). */
export type BodyAndGoalsAnchor = 'reminders' | 'feedback' | 'data';

/** Plan's history page halves (iOS `PlanHistory.Segment`). */
export type WorkoutHistorySegment = 'workouts' | 'pastPlans';

/** How a programme is shown (iOS `ProgramOverviewView.Mode`). */
export type ProgramOverviewMode = 'live' | 'proposal' | 'past';

/** Who opened the meal page, which decides where Save leads (iOS `MealCaptureOrigin`). */
export type MealCaptureOrigin = 'scanTab' | 'plan' | 'diary' | 'editor';

/** The three ways into a meal (iOS `MealCaptureMode`). */
export type MealCaptureMode = 'photo' | 'barcode' | 'search';

/** A meal's slot (iOS `MealSlot`). */
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink';

/** Where the workout runner was opened from (iOS `RunnerEntry`, `workout_started.entry`). */
export type RunnerEntry = 'today' | 'missed' | 'resume';

// ---------------------------------------------------------------------------
// Shared routes: registered in EVERY tab stack (./sharedRoutes.tsx)

export interface VenueDetailParams {
  readonly slug: string;
}

export interface BookingFlowParams {
  readonly venueId: string;
  readonly activity: BookingFlowActivity;
  /** A `YYYY-MM-DD` day to open on (Reykjavík). */
  readonly initialDate?: string;
}

export type SharedRoutes = {
  /** Profile: bookings and saved (iOS LibraryView). Owner LIB-1. */
  Profile: { readonly initialTab: ProfileTab };
  /** Account, behind Profile's gear. Owner ACCT-1. */
  Account: undefined;
  /** Purchase history. Owner ACCT-2. */
  Receipts: undefined;
  /** Plan and usage. Owner ACCT-2. */
  PlanUsage: undefined;
  /**
   * A venue's page, by slug (replaces the first build's `venueId`). Owner
   * VENUE-1. Until every caller has moved, a legacy caller may still pass
   * `{ venueId }` (`LegacyVenueDetailParams`; `venueDetailTarget` reads both).
   */
  VenueDetail: VenueDetailParams | LegacyVenueDetailParams;
  /** All reviews of a venue. Owner VENUE-2. */
  VenueReviews: { readonly venueId: string; readonly venueName: string };
  /** A public sight's card. Owner ATTR-1. */
  AttractionDetail: { readonly slug: string };
  /**
   * Book an activity. Owner BOOK-1. A legacy caller may still pass
   * `{ venueId, activityId }` until it is rebuilt (`LegacyBookingFlowParams`).
   */
  BookingFlow: BookingFlowParams | LegacyBookingFlowParams;
  /** The scanner pushed from a page, with a back button. Owner CHECKIN-1. */
  ScanPushed: { readonly fromVenueSlug?: string } | undefined;
  /** Body and goals. Owner BODY-1. */
  BodyAndGoals: { readonly anchor?: BodyAndGoalsAnchor } | undefined;
  /** Measurements history. Owner BODY-1. */
  Measurements: undefined;
  /** Health Connect detail: NOT BUILT (owner decision), renders nothing. */
  HealthConnectDetail: undefined;
  /** The food diary for one day (`YYYY-MM-DD`). Owner MEAL-5. */
  Diary: { readonly date: string };
  /** Past meals. Owner MEAL-5. */
  MealHistory: undefined;
  /** Workouts and past plans. Owner PLAN-4. */
  WorkoutHistory: { readonly segment: WorkoutHistorySegment };
  /** One finished workout. Owner PLAN-4. */
  WorkoutDetail: { readonly sessionId: string };
  /** A programme's weeks. Owner PLAN-4. */
  ProgramOverview: { readonly programId: string; readonly mode: ProgramOverviewMode };
  /** Meal drafts. Owner PLAN-5. */
  Drafts: undefined;
  /** A monthly feedback report: the one named, or the month's, or the current one. Owner FEED-1. */
  FeedbackReport: { readonly reportId?: string; readonly periodMonth?: string } | undefined;
  /** Past months. Owner FEED-1. */
  FeedbackHistory: undefined;
  /** A saved meal's editor. Owner MEAL-4. */
  MealEditor: { readonly mode: 'stored'; readonly mealId: string };
};

export type SharedRouteName = keyof SharedRoutes;

// ---------------------------------------------------------------------------
// Tab stacks

export type HomeStackRoutes = SharedRoutes & { HomeMain: undefined };
export type ExploreStackRoutes = SharedRoutes & { ExploreMain: undefined };
export type ScanStackRoutes = SharedRoutes & { ScanMain: undefined };
export type CoachStackRoutes = SharedRoutes & {
  /** `prefilledMessage`: the first build's Home cards (legacy; new code parks `pendingCoachPrompt`). */
  CoachMain: { readonly prefilledMessage?: string } | undefined;
};
export type PlanStackRoutes = SharedRoutes & { PlanMain: undefined };

/** Every route a tab stack can show (each stack has its own root plus the shared ones). */
export type TabStackRoutes = SharedRoutes & {
  HomeMain: undefined;
  ExploreMain: undefined;
  ScanMain: undefined;
  CoachMain: CoachStackRoutes['CoachMain'];
  PlanMain: undefined;
};

export type MainTabRoutes = {
  Home: NavigatorScreenParams<HomeStackRoutes> | undefined;
  Explore: NavigatorScreenParams<ExploreStackRoutes> | undefined;
  Scan: NavigatorScreenParams<ScanStackRoutes> | undefined;
  Coach: NavigatorScreenParams<CoachStackRoutes> | undefined;
  Plan: NavigatorScreenParams<PlanStackRoutes> | undefined;
};

// ---------------------------------------------------------------------------
// Root modals (cover the tab bar)

export interface MealCaptureParams {
  readonly origin: MealCaptureOrigin;
  readonly slot?: MealSlot;
  /** `YYYY-MM-DD`; never a future day. */
  readonly date?: string;
  readonly mode?: MealCaptureMode;
}

/** The meal page's own stack (iOS `MealCaptureRoute`). Owners MEAL-2 (Capture), MEAL-4 (Review, Draft). */
export type MealCaptureRoutes = {
  Capture: MealCaptureParams;
  /** The tray, reviewed as a new meal. */
  Review: undefined;
  /** A draft the server just saved from a photo or a description. */
  Draft: { readonly mealId: string };
};

export type RootModalRoutes = {
  /** Plans and passes. Owner PLANS-1. */
  Plans: { readonly segment?: PlansSegment; readonly slug?: string } | undefined;
  /** Write a review. Owner VENUE-2. */
  WriteReview: { readonly venueId: string; readonly venueName: string };
  /** The classes feed as a sheet (from Plan). Owner CLASS-1. */
  ClassesDiscoveryModal: { readonly initialCategory?: string; readonly initialDate?: string } | undefined;
  /** The meal page (full screen), its own stack. Owners MEAL-2 and MEAL-4. */
  MealCapture: MealCaptureParams;
  /** The workout runner (full screen). Owner RUN-2. */
  WorkoutRunner: { readonly sessionId: string; readonly entry: RunnerEntry };
};

export type RootModalName = keyof RootModalRoutes;

export type AuthStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  SignUp: undefined;
};

export type RootRoutes = RootModalRoutes & {
  Auth: NavigatorScreenParams<AuthStackParamList> | undefined;
  Main: NavigatorScreenParams<MainTabRoutes> | undefined;
};

/** The root navigator's param list (the navigation ref's type). */
export type RootStackParamList = RootRoutes;

// ---------------------------------------------------------------------------
// Navigation and screen props

/**
 * What a screen anywhere in the signed-in app navigates with: its own tab's
 * stack (shared routes), the tab bar, and the root modals.
 */
export type AppNavigation = CompositeNavigationProp<
  NativeStackNavigationProp<TabStackRoutes>,
  CompositeNavigationProp<BottomTabNavigationProp<MainTabRoutes>, NativeStackNavigationProp<RootRoutes>>
>;

/** Props of a shared route's screen, e.g. `SharedRouteProps<'VenueDetail'>`. */
export type SharedRouteProps<Name extends SharedRouteName> = CompositeScreenProps<
  NativeStackScreenProps<TabStackRoutes, Name>,
  CompositeScreenProps<BottomTabScreenProps<MainTabRoutes>, NativeStackScreenProps<RootRoutes>>
>;

/** Props of a tab's first screen, e.g. `TabRootProps<'PlanMain'>`. */
export type TabRootProps<Name extends 'HomeMain' | 'ExploreMain' | 'ScanMain' | 'CoachMain' | 'PlanMain'> =
  CompositeScreenProps<
    NativeStackScreenProps<TabStackRoutes, Name>,
    CompositeScreenProps<BottomTabScreenProps<MainTabRoutes>, NativeStackScreenProps<RootRoutes>>
  >;

/** Props of a root modal's screen, e.g. `RootModalProps<'Plans'>`. */
export type RootModalProps<Name extends RootModalName> = NativeStackScreenProps<RootRoutes, Name>;

/** Props of a screen inside the meal page's own stack. */
export type MealCaptureScreenProps<Name extends keyof MealCaptureRoutes> = CompositeScreenProps<
  NativeStackScreenProps<MealCaptureRoutes, Name>,
  NativeStackScreenProps<RootRoutes>
>;

export type AuthStackScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<AuthStackParamList, T>;

// ---------------------------------------------------------------------------
// LEGACY: the first Android build's names, for its screens only (see top)

/** @deprecated The first build passed a venue id; new code passes `{ slug }`. */
export interface LegacyVenueDetailParams {
  readonly venueId: string;
}

/** @deprecated The first build's booking params; new code passes `BookingFlowParams`. */
export interface LegacyBookingFlowParams {
  readonly venueId: string;
  readonly activityId: string;
}

/** The venue a VenueDetail route names, whichever form its caller used. */
export function venueDetailTarget(
  params: SharedRoutes['VenueDetail'],
): { readonly slug: string } | { readonly venueId: string } {
  if ('slug' in params && typeof params.slug === 'string') return { slug: params.slug };
  return { venueId: (params as LegacyVenueDetailParams).venueId };
}

/** True for the first build's booking params (`activityId` instead of `activity`). */
export function isLegacyBookingFlowParams(params: SharedRoutes['BookingFlow']): params is LegacyBookingFlowParams {
  return 'activityId' in params && !('activity' in params);
}

/** @deprecated First-build routes every legacy tab stack registered. */
type LegacySharedTabRoutes = {
  VenueDetail: LegacyVenueDetailParams;
  Account: undefined;
  /** Now the root modal `Plans`. */
  TopUp: undefined;
  BookingFlow: LegacyBookingFlowParams;
};

/** @deprecated Legacy Home stack; new code uses `HomeStackRoutes`. */
export type HomeStackParamList = LegacySharedTabRoutes & {
  HomeMain: undefined;
};

/** @deprecated Legacy Explore stack; new code uses `ExploreStackRoutes`. */
export type ExploreStackParamList = LegacySharedTabRoutes & {
  ExploreMain: undefined;
};

/** @deprecated Legacy Coach stack; new code uses `CoachStackRoutes`. */
export type CoachStackParamList = {
  CoachMain: { prefilledMessage?: string } | undefined;
  Account: undefined;
};

/** @deprecated The first build's Profile tab stack; Profile is now a shared route. */
export type BookingsStackParamList = LegacySharedTabRoutes & {
  /** `initialTab: 'saved'` opens the Saved half (the Coach drawer). */
  BookingsMain: { initialTab?: ProfileTab } | undefined;
};

/** @deprecated The first build's Check-in tab; the tab is now `Scan`. */
export type CheckInStackParamList = {
  /** Never set any more: a link only parks the venue (intent store), it never checks in by itself. */
  CheckInMain: { autoCheckInVenueId?: string } | undefined;
  Account: undefined;
};

/** @deprecated The first build's tab names; new code uses `MainTabRoutes`. */
export type TabParamList = {
  Home: undefined;
  Explore: undefined;
  CheckIn: undefined;
  Coach: undefined;
  Bookings: undefined;
};

/** @deprecated */
export type TabScreenProps<T extends keyof TabParamList> = BottomTabScreenProps<TabParamList, T>;

/** @deprecated */
export type HomeStackScreenProps<T extends keyof HomeStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<HomeStackParamList, T>,
  TabScreenProps<keyof TabParamList>
>;

/** @deprecated */
export type ExploreStackScreenProps<T extends keyof ExploreStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<ExploreStackParamList, T>,
  TabScreenProps<keyof TabParamList>
>;
