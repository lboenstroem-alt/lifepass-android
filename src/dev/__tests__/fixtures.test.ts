import { setDev, setEnv } from '@test/harness';

import {
  FIXTURE_KEYS,
  fixtureArg,
  fixtureArgs,
  fixtureKeyForIOSArgument,
  fixturesActive,
  hasFixture,
  isKnownFixtureKey,
  parseFixtureArgs,
} from '../fixtures';

/** Every debug launch argument the iOS 2.5.6 sources and UI tests read. */
const IOS_ARGUMENTS = [
  '-LPScreenshotPlan', '-LPScreenshotTab', '-LPScreenshotState', '-LPScreenshotLanguage',
  '-LPScreenshotHealth', '-LPScreenshotScroll', '-LPScreenshotAH', '-LPScreenshotClassSheet',
  '-LPScreenshotClassPayURL', '-LPScreenshotClassPay', '-LPScreenshotNotification',
  '-LPScreenshotDescribe', '-LPScreenshotSheet', '-LPScreenshotCoach', '-LPScreenshotClassPayPrice',
  '-LPScreenshotClassPayConfirm', '-LPScreenshotCamera', '-LPDebugAssistiveTech', '-LPDebugActivatePin',
  '-LPScreenshotRefusal', '-LPScreenshotRecentCheckIn', '-LPScreenshotProfile', '-LPScreenshotPlanDot',
  '-LPScreenshotMeal', '-LPScreenshotMapZoomOut', '-LPScreenshotMapPins', '-LPScreenshotMapPinned',
  '-LPScreenshotExtra', '-LPScreenshotClassPayTopup', '-LPScreenshotClassPayReason',
  '-LPScreenshotClassPayEarlyPage', '-LPScreenshotCheckIn', '-LPRunnerStub', '-LPRunnerReset',
  '-LPRunnerKeep', '-LPExtraStub', '-LPDebugPayCover', '-LPDebugMapTapFirst', '-LPScreenshotVenueScroll',
  '-LPScreenshotVenue', '-LPScreenshotUnverified', '-LPScreenshotSelectPlan', '-LPScreenshotProfileSaved',
  '-LPScreenshotProfileHint', '-LPScreenshotPlansSheet', '-LPScreenshotMapLegendOpen', '-LPScreenshotKenni',
  '-LPScreenshotExploreHint', '-LPScreenshotClassFeed', '-LPScreenshotAuth', '-LPRunnerWidth',
  '-LPRunnerScreen', '-LPLogWorkoutPrefill', '-LPForceSocialButtons', '-LPBrowseSeed',
];

describe('fixture keys', () => {
  it('maps iOS launch arguments to keys', () => {
    expect(fixtureKeyForIOSArgument('-LPScreenshotState')).toBe('state');
    expect(fixtureKeyForIOSArgument('-LPScreenshotClassPayURL')).toBe('classPayURL');
    expect(fixtureKeyForIOSArgument('-LPScreenshotAH')).toBe('AH');
    expect(fixtureKeyForIOSArgument('-LPForceSocialButtons')).toBe('forceSocialButtons');
    expect(fixtureKeyForIOSArgument('-LPDebugAssistiveTech')).toBe('debugAssistiveTech');
    expect(fixtureKeyForIOSArgument('--state')).toBeNull();
  });

  it('knows every iOS 2.5.6 argument, once', () => {
    const keys = IOS_ARGUMENTS.map(fixtureKeyForIOSArgument);
    for (const key of keys) expect(isKnownFixtureKey(key ?? '')).toBe(true);
    expect(new Set(keys).size).toBe(IOS_ARGUMENTS.length);
    expect(new Set(FIXTURE_KEYS).size).toBe(FIXTURE_KEYS.length);
    expect([...FIXTURE_KEYS].sort()).toEqual([...new Set(keys as string[])].sort());
  });
});

describe('parseFixtureArgs', () => {
  it('reads key=value pairs and bare flags', () => {
    expect(parseFixtureArgs('state=active-plan, language=is,tab=4,forceSocialButtons')).toEqual({
      state: 'active-plan',
      language: 'is',
      tab: '4',
      forceSocialButtons: '',
    });
  });

  it('percent-decodes values and survives junk', () => {
    expect(parseFixtureArgs('classPayURL=https%3A%2F%2Fpay.example%2Fc%2F1%2Cx,,=x, ,bad=%E0%A4%A')).toEqual({
      classPayURL: 'https://pay.example/c/1,x',
      bad: '%E0%A4%A',
    });
    expect(parseFixtureArgs(undefined)).toEqual({});
    expect(parseFixtureArgs('')).toEqual({});
  });
});

describe('fixtureArg', () => {
  it('is empty when nothing was asked for', () => {
    expect(fixturesActive()).toBe(false);
    expect(fixtureArg('state')).toBeNull();
    expect(hasFixture('forceSocialButtons')).toBe(false);
  });

  it('reads the development build switches', () => {
    setEnv({ EXPO_PUBLIC_FIXTURE: 'state=pass-holder,profileSaved' });
    expect(fixturesActive()).toBe(true);
    expect(fixtureArg('state')).toBe('pass-holder');
    expect(fixtureArg('profileSaved')).toBe('');
    expect(hasFixture('profileSaved')).toBe(true);
    expect(hasFixture('profile')).toBe(false);
  });

  it('gives a release bundle nothing, whatever the environment says', () => {
    setEnv({ EXPO_PUBLIC_FIXTURE: 'state=active-plan,forceSocialButtons' });
    setDev(false);
    expect(fixturesActive()).toBe(false);
    expect(fixtureArgs()).toEqual({});
    expect(fixtureArg('state')).toBeNull();
    expect(hasFixture('forceSocialButtons')).toBe(false);
  });
});
