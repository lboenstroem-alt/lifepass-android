/**
 * Test set-up for Body and goals and the weight history: a member in the app
 * store (built from the API's own JSON through the real decoder), and the
 * page in a real native stack pushed over the screen it was opened from,
 * with stand-ins for the routes it opens.
 */
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, render, screen } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { Text, View } from 'react-native';

import { decodeProfile } from '../../../api/profile';
import { useAppStore } from '../../../stores/appStore';

export const MEMBER = '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11';
export const PROGRAM = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

export const CONSENT_JSON = { version: '2026-09-v1', consentedAt: '2026-09-01T09:00:00Z', ageSource: 'kennitala' };

export interface MemberOptions {
  readonly access?: string;
  readonly consent?: boolean;
  readonly latest?: { weightKg: number | null; heightCm: number | null } | null;
  readonly program?: { status: string; weekNo: number | null; weeks: number | null; summaryTitle: string | null } | null;
  readonly features?: string[];
  readonly locale?: 'en' | 'is';
}

/** The profile JSON `GET /profile` answers for this member. */
export function profileJson(options: MemberOptions = {}) {
  const features = options.features ?? ['target_weight'];
  return {
    id: MEMBER,
    email: 'member@example.com',
    locale: options.locale ?? 'en',
    kennitalaVerified: true,
    marketingConsent: false,
    health: {
      access: options.access ?? 'entitled',
      consent: options.consent === false ? null : CONSENT_JSON,
      latest:
        options.latest === null
          ? null
          : { weightKg: options.latest?.weightKg ?? 72.5, heightCm: options.latest?.heightCm ?? 178, measuredAt: '2026-10-01T08:00:00Z' },
      weighInDue: false,
      program: options.program ? { id: PROGRAM, today: null, ...options.program } : null,
      proposalId: null,
      appleHealth: null,
      features,
    },
  };
}

/** Signs this member in, the profile decoded the way the app decodes it. */
export function signIn(options: MemberOptions = {}) {
  const profile = decodeProfile(profileJson(options));
  useAppStore.setState({
    isAuthenticated: true,
    userId: MEMBER,
    profile,
    serverFeatures: options.features ?? ['target_weight'],
  });
  // The access signal and the language follow the profile (the store's own subscription).
  return profile;
}

// ---------------------------------------------------------------------------
// The page in a stack

export const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();

const Stack = createNativeStackNavigator();

function routeStandIn(name: string): ComponentType {
  return function RouteStandIn() {
    return (
      <View testID={`route.${name}`}>
        <Text>{`${name} route`}</Text>
      </View>
    );
  };
}

const STAND_INS = ['PlanMain', 'Account', 'Measurements', 'BodyAndGoals'];

/** `component` as route `name` (with `params`), pushed over `below`, with stand-ins for the routes it opens. */
export function renderPushed(name: string, component: ComponentType<never>, options: { params?: object; below?: string } = {}) {
  const below = options.below ?? 'PlanMain';
  const others = STAND_INS.filter((route) => route !== name && route !== below);
  return render(
    <NavigationContainer
      ref={navigationRef}
      initialState={{ index: 1, routes: [{ name: below }, { name, params: options.params }] }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Screen name={below} component={routeStandIn(below)} />
        <Stack.Screen name={name} component={component as unknown as ComponentType} />
        {others.map((route) => (
          <Stack.Screen key={route} name={route} component={routeStandIn(route)} />
        ))}
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

/** What the member sees and hears of a rendered tree: the types, texts, ids and accessibility props. */
function treeSignature(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(treeSignature).join('|');
  const { type, props, children } = node as { type?: string; props?: Record<string, unknown>; children?: unknown };
  const facts = ['testID', 'accessibilityLabel', 'accessibilityHint', 'accessibilityState', 'accessibilityValue']
    .map((key) => {
      const value = props?.[key];
      return value === undefined ? '' : `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`;
    })
    .join(',');
  return `<${type ?? ''} ${facts}>${treeSignature(children)}</>`;
}

/**
 * Lets msw answers and the state they set land: a few turns at once, then
 * turns a few milliseconds apart until the tree has not changed for three of
 * them (at most about two seconds). Counting a fixed number of turns was not
 * enough on a busy machine, where an answer can take longer than six turns.
 */
export async function settle(minTurns = 6): Promise<void> {
  let last = '';
  let stable = 0;
  for (let turn = 0; turn < 200; turn += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, turn < minTurns ? 0 : 10));
    });
    if (turn < minTurns) continue;
    const now = treeSignature(screen.toJSON());
    stable = now === last ? stable + 1 : 0;
    last = now;
    if (stable >= 3) return;
  }
}

export function currentRoute(): string | undefined {
  return navigationRef.getCurrentRoute()?.name;
}

/** One page of weigh-ins as `GET /health/measurements` answers it. */
export function measurementsPage(rows: object[], nextCursor: string | null = null) {
  return { data: rows, pagination: { nextCursor, hasMore: nextCursor !== null, limit: 30 } };
}

export function weighIn(id: string, weightKg: number, source = 'self_reported', measuredAt = '2026-09-17T08:00:00Z') {
  return { id, weightKg, heightCm: null, source, measuredAt, createdAt: measuredAt };
}
