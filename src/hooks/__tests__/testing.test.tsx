import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { restoreTestFontScale, setTestFontScale } from '../testing';
import { useA11ySize } from '../useA11ySize';

function Probe() {
  const { typeSize, isAccessibilitySize } = useA11ySize();
  return <Text testID="size">{`${typeSize} ${isAccessibilitySize ? 'a11y' : 'default'}`}</Text>;
}

afterEach(() => restoreTestFontScale());

it('the test runner starts at a font scale of 2, which is why tests pin it', async () => {
  await render(<Probe />);
  expect(screen.getByTestId('size')).toHaveTextContent('accessibility3 a11y');
});

it('pins the default layout for a test', async () => {
  setTestFontScale(1);
  await render(<Probe />);
  expect(screen.getByTestId('size')).toHaveTextContent('large default');
});

it('a rendered tree follows a change, as when the member changes the setting', async () => {
  setTestFontScale(1);
  await render(<Probe />);
  await act(async () => setTestFontScale(1.5));
  expect(screen.getByTestId('size')).toHaveTextContent('accessibility1 a11y');
});

it('restores the starting scale', async () => {
  setTestFontScale(1);
  restoreTestFontScale();
  await render(<Probe />);
  expect(screen.getByTestId('size')).toHaveTextContent('accessibility3 a11y');
});
