/**
 * The store's published selectors, as screens use them:
 * `useAppStore(selector)`. React's useSyncExternalStore needs the same answer
 * for the same state; a selector that builds a new array or object per read
 * makes React re-render until it aborts the screen ("Maximum update depth
 * exceeded"). The state with no profile is an ordinary one (signed out, an
 * offline cold start, a failed profile read), so every selector is rendered
 * there too.
 */
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { decodeProfile } from '../../api/profile';
import * as appStore from '../appStore';
import { useAppStore, type AppStoreState } from '../appStore';

import { freshStorePerTest, MEMBER_A, profileJSON } from './storeHarness';

freshStorePerTest();

type Selector = (state: AppStoreState) => unknown;

/** Every `select*` the store exports, so a new one is covered without being listed here. */
const selectors = Object.entries(appStore).filter(
  (entry): entry is [string, Selector] => entry[0].startsWith('select') && typeof entry[1] === 'function',
);

/** A member with no plan and no passes, as `GET /profile` sends it. */
const usage = {
  tier: null,
  network: null,
  pools: null,
  daily: null,
  concurrent: { open: 0, cap: null },
  topup: { available: false, prices: { gym: null, studio: null, pool: null } },
  passes: [],
  block: { until: null },
  strikes: { active: 0, threshold: 3 },
};

const states: Record<string, () => Partial<AppStoreState>> = {
  'signed out': () => ({ isAuthenticated: false, userId: null, profile: null }),
  'signed in, no profile yet (offline cold start, failed read)': () => ({
    isAuthenticated: true,
    userId: MEMBER_A,
    profile: null,
  }),
  'a profile without a usage block': () => ({
    isAuthenticated: true,
    userId: MEMBER_A,
    profile: decodeProfile(profileJSON()),
  }),
  'a profile with usage and no passes': () => ({
    isAuthenticated: true,
    userId: MEMBER_A,
    profile: decodeProfile(profileJSON({ usage })),
  }),
};

function Probe({ name, selector }: { name: string; selector: Selector }) {
  const value = useAppStore(selector);
  const shown = Array.isArray(value) ? value.length : String(value);
  return <Text testID={name}>{shown}</Text>;
}

it('the store publishes the selectors screens read', () => {
  expect(selectors.map(([name]) => name)).toEqual(expect.arrayContaining(['selectActivePasses', 'selectUsage']));
});

describe.each(Object.entries(states))('%s', (_label, state) => {
  beforeEach(() => {
    useAppStore.setState(state());
  });

  it('every selector answers the same value for the same state', () => {
    const now = useAppStore.getState();
    for (const [name, selector] of selectors) {
      expect({ name, same: Object.is(selector(now), selector(now)) }).toEqual({ name, same: true });
    }
  });

  it('every selector renders through useAppStore without looping', async () => {
    const consoleError = jest.spyOn(console, 'error');
    try {
      await render(
        <>
          {selectors.map(([name, selector]) => (
            <Probe key={name} name={name} selector={selector} />
          ))}
        </>,
      );
      expect(screen.getByTestId('selectActivePasses')).toHaveTextContent('0');
      const loops = consoleError.mock.calls.filter((call) =>
        call.some((arg) => /getSnapshot should be cached|Maximum update depth/.test(String(arg))),
      );
      expect(loops).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });
});
