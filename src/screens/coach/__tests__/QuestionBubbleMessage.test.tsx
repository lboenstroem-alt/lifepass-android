/**
 * A wizard's question bubble (iOS `QuestionBubbleView`): the chips answer
 * once, the chosen one stays marked, and "Other" takes typed words cut to the
 * server's limit as they are typed.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { lookup } from '../../../i18n';
import QuestionBubbleMessage from '../QuestionBubbleMessage';

// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ where Jest's resolver cannot see it; Metro resolves it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const en = (key: string) => lookup(key, 'en');

const OPTIONS = [
  { label: 'Near me', value: 'near' },
  { label: 'Downtown', value: 'downtown' },
  { label: 'Other', value: 'other', isOther: true, maxLength: 10 },
];

it('a chip answers with its value and label', async () => {
  const onSelect = jest.fn();
  await render(<QuestionBubbleMessage question="Where?" options={OPTIONS} answered={false} onSelect={onSelect} />);
  expect(screen.getByText('Where?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Downtown' }));
  expect(onSelect).toHaveBeenCalledWith('downtown', 'Downtown');
});

it('once answered, the chips close: the chosen one stays selected, none answers again', async () => {
  const onSelect = jest.fn();
  await render(
    <QuestionBubbleMessage question="Where?" options={OPTIONS} answered selectedAnswer="Near me" onSelect={onSelect} />,
  );
  const chosen = screen.getByRole('button', { name: 'Near me' });
  expect(chosen).toBeSelected();
  expect(chosen).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Downtown' })).toBeDisabled();
  // An answered question's "Other" is a closed chip like the rest: no field opens.
  const other = screen.getByRole('button', { name: 'Other' });
  expect(other).toBeDisabled();
  await fireEvent.press(other);
  expect(screen.queryByTestId('coach.question.other_input')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Downtown' }));
  expect(onSelect).not.toHaveBeenCalled();
});

it('"Other" opens a field that stops at the limit as it is typed, and sends the trimmed words', async () => {
  const onSelect = jest.fn();
  await render(<QuestionBubbleMessage question="Which class?" options={OPTIONS} answered={false} onSelect={onSelect} />);
  await fireEvent.press(screen.getByRole('button', { name: en('coach.other.label') }));
  const field = screen.getByTestId('coach.question.other_input');
  await fireEvent.changeText(field, '  aerial yoga flow');
  expect(screen.getByTestId('coach.question.other_input').props.value).toBe('  aerial y');
  await fireEvent(screen.getByTestId('coach.question.other_input'), 'submitEditing');
  expect(onSelect).toHaveBeenCalledWith('aerial y', 'aerial y');
});

it('answered with the member’s own words ("Other"), no chip is marked and every chip closes', async () => {
  const onSelect = jest.fn();
  await render(
    <QuestionBubbleMessage question="Which class?" options={OPTIONS} answered selectedAnswer="aerial yoga" onSelect={onSelect} />,
  );
  for (const name of ['Near me', 'Downtown', 'Other']) {
    const chip = screen.getByRole('button', { name });
    expect(chip).not.toBeSelected();
    expect(chip).toBeDisabled();
  }
});

it('"Other" with nothing typed sends nothing', async () => {
  const onSelect = jest.fn();
  await render(<QuestionBubbleMessage question="Which class?" options={OPTIONS} answered={false} onSelect={onSelect} />);
  await fireEvent.press(screen.getByRole('button', { name: en('coach.other.label') }));
  await fireEvent.changeText(screen.getByTestId('coach.question.other_input'), '   ');
  await fireEvent.press(screen.getByRole('button', { name: en('coach.a11y.send_message') }));
  expect(onSelect).not.toHaveBeenCalled();
});
