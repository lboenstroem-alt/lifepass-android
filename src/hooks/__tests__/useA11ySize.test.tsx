import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  FONT_SCALE_CAP,
  a11ySizeFor,
  isAccessibilityTypeSize,
  typeSizeAtLeast,
  typeSizeFor,
  useA11ySize,
} from '../useA11ySize';

describe('typeSizeFor: Android font scale in iOS Dynamic Type terms', () => {
  it("lands each of Android 14's steps on an iOS size", () => {
    expect(typeSizeFor(0.85)).toBe('small');
    expect(typeSizeFor(1)).toBe('large');
    expect(typeSizeFor(1.15)).toBe('xxLarge');
    expect(typeSizeFor(1.3)).toBe('xxxLarge');
    expect(typeSizeFor(1.5)).toBe('accessibility1');
    expect(typeSizeFor(1.8)).toBe('accessibility2');
    expect(typeSizeFor(2)).toBe('accessibility3');
  });

  it('reads an exact iOS ratio as that size, not the next one', () => {
    expect(typeSizeFor(28 / 17)).toBe('accessibility1');
    expect(typeSizeFor(23 / 17)).toBe('xxxLarge');
  });

  it('treats a nonsense scale as the default', () => {
    expect(typeSizeFor(Number.NaN)).toBe('large');
    expect(typeSizeFor(0)).toBe('large');
    expect(typeSizeFor(9)).toBe('accessibility5');
  });

  it('switches to the accessibility layouts from 1.5, never at the ordinary sizes', () => {
    expect(a11ySizeFor(1.3).isAccessibilitySize).toBe(false);
    expect(a11ySizeFor(1.5).isAccessibilitySize).toBe(true);
    expect(a11ySizeFor(2).isAccessibilitySize).toBe(true);
    expect(isAccessibilityTypeSize('xxxLarge')).toBe(false);
    expect(isAccessibilityTypeSize('accessibility1')).toBe(true);
  });

  it('says when text is larger than the default', () => {
    expect(a11ySizeFor(1).isLargerThanDefault).toBe(false);
    expect(a11ySizeFor(0.85).isLargerThanDefault).toBe(false);
    expect(a11ySizeFor(1.15).isLargerThanDefault).toBe(true);
    expect(typeSizeAtLeast('xxLarge', 'xLarge')).toBe(true);
    expect(typeSizeAtLeast('large', 'xLarge')).toBe(false);
  });

  it('caps text at the iOS ceilings (.dynamicTypeSize(...large) and friends)', () => {
    expect(FONT_SCALE_CAP.large).toBe(1);
    expect(FONT_SCALE_CAP.xxLarge).toBeCloseTo(21 / 17);
    expect(FONT_SCALE_CAP.accessibility1).toBeCloseTo(28 / 17);
  });
});

// React Native's own jest setup reports a window font scale of 2; each test
// sets the scale it needs.
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 375, height: 812, scale: 3, fontScale: mockFontScale }),
}));

describe('useA11ySize', () => {
  function Probe() {
    const size = useA11ySize();
    return <Text testID="size">{`${size.typeSize} ${size.isAccessibilitySize}`}</Text>;
  }

  it('reads the window font scale', async () => {
    mockFontScale = 2;
    await render(<Probe />);
    expect(screen.getByTestId('size')).toHaveTextContent('accessibility3 true');
  });

  it('is the default size at a scale of 1', async () => {
    mockFontScale = 1;
    await render(<Probe />);
    expect(screen.getByTestId('size')).toHaveTextContent('large false');
  });
});
