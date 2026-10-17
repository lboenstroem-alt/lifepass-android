/**
 * The choice controls: what TalkBack hears and what a press does.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { setCurrentLanguage } from '../../../i18n';
import { Chip, ChipRow } from '../Chip';
import CheckboxRow from '../CheckboxRow';
import MenuPicker from '../MenuPicker';
import NumberStepper from '../NumberStepper';
import { parseDecimal } from '../numberInput';
import SegmentedControl from '../SegmentedControl';
import ToggleRow from '../ToggleRow';

jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

describe('Chip and ChipRow', () => {
  it('says which chip is selected and presses', async () => {
    const onPress = jest.fn();
    await render(
      <ChipRow>
        <Chip label="Lose" selected onPress={jest.fn()} />
        <Chip label="Maintain" onPress={onPress} />
      </ChipRow>,
    );
    expect(screen.getByRole('button', { name: 'Lose' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Maintain' })).not.toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: 'Maintain' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a disabled chip refuses the press', async () => {
    const onPress = jest.fn();
    await render(<Chip label="Classes" disabled onPress={onPress} />);
    const chip = screen.getByRole('button', { name: 'Classes' });
    expect(chip).toBeDisabled();
    await fireEvent.press(chip);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('scrolls on one line when asked', async () => {
    await render(
      <ChipRow scroll testID="row">
        <Chip label="All" tone="ink" selected onPress={jest.fn()} />
      </ChipRow>,
    );
    expect(screen.getByTestId('row')).toHaveProp('horizontal', true);
  });
});

describe('SegmentedControl', () => {
  function History() {
    const [value, setValue] = useState<'workouts' | 'plans'>('workouts');
    return (
      <SegmentedControl
        accessibilityLabel="History"
        value={value}
        onChange={setValue}
        segments={[
          { value: 'workouts', label: 'Workouts' },
          { value: 'plans', label: 'Past plans' },
        ]}
      />
    );
  }

  it('is a tab list whose selected tab follows the press', async () => {
    await render(<History />);
    expect(screen.getByRole('tab', { name: 'Workouts' })).toBeSelected();
    await fireEvent.press(screen.getByRole('tab', { name: 'Past plans' }));
    expect(screen.getByRole('tab', { name: 'Past plans' })).toBeSelected();
    expect(screen.getByRole('tab', { name: 'Workouts' })).not.toBeSelected();
  });

  it('does not report a press on the selected segment as a change', async () => {
    const onChange = jest.fn();
    await render(
      <SegmentedControl value="a" onChange={onChange} segments={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />,
    );
    await fireEvent.press(screen.getByRole('tab', { name: 'A' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('CheckboxRow (iOS LPCheckboxRow)', () => {
  it('is one checkbox with its state, toggled by a press anywhere', async () => {
    const onChange = jest.fn();
    await render(<CheckboxRow title="I agree to the health terms" checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'I agree to the health terms' });
    expect(box).not.toBeChecked();
    await fireEvent.press(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reads as checked when it is', async () => {
    await render(<CheckboxRow title="Yes" checked onChange={jest.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Yes' })).toBeChecked();
  });
});

describe('ToggleRow', () => {
  it('is one switch with its state', async () => {
    const onValueChange = jest.fn();
    await render(<ToggleRow title="Weekly check-in" subtitle="Sunday at 18:00" value onValueChange={onValueChange} />);
    const row = screen.getByRole('switch', { name: 'Weekly check-in' });
    expect(row).toBeChecked();
    await fireEvent.press(row);
    expect(onValueChange).toHaveBeenCalledWith(false);
  });
});

describe('MenuPicker', () => {
  const slots = [
    { value: 'breakfast', label: 'Breakfast' },
    { value: 'lunch', label: 'Lunch' },
    { value: 'dinner', label: 'Dinner' },
  ] as const;

  function Slot({ onChange }: { onChange?: (value: string) => void }) {
    const [value, setValue] = useState<string>('lunch');
    return (
      <MenuPicker
        label="Meal"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        options={slots.map((s) => ({ ...s }))}
      />
    );
  }

  it('says what it chooses and its current value, and opens a menu marking it', async () => {
    await render(<Slot />);
    const trigger = screen.getByRole('button', { name: 'Meal' });
    expect(trigger).toHaveAccessibilityValue({ text: 'Lunch' });
    expect(trigger).not.toBeExpanded();
    await fireEvent.press(trigger);
    expect(screen.getByRole('button', { name: 'Meal' })).toBeExpanded();
    expect(screen.getByRole('menuitem', { name: 'Lunch' })).toBeSelected();
    expect(screen.getByRole('menuitem', { name: 'Dinner' })).not.toBeSelected();
  });

  it('a choice closes the menu and changes the value', async () => {
    const onChange = jest.fn();
    await render(<Slot onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Meal' }));
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Dinner' }));
    expect(onChange).toHaveBeenCalledWith('dinner');
    expect(screen.queryByRole('menuitem', { name: 'Dinner' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Meal' })).toHaveAccessibilityValue({ text: 'Dinner' });
  });

  it('choosing the current value changes nothing', async () => {
    const onChange = jest.fn();
    await render(<Slot onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Meal' }));
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Lunch' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('NumberStepper', () => {
  function Weight({ initial = '72,5' }: { initial?: string }) {
    const [text, setText] = useState(initial);
    return (
      <NumberStepper
        testID="weight"
        text={text}
        onChangeText={setText}
        step={0.1}
        min={20}
        max={400}
        fallback={70}
        unit="kg"
        label="Weight"
        spokenUnit="kilograms"
        decreaseLabel="Decrease by 0.1 kilograms"
        increaseLabel="Increase by 0.1 kilograms"
      />
    );
  }

  beforeEach(() => setCurrentLanguage('is'));

  it('the field is adjustable, named with the unit as a word', async () => {
    await render(<Weight />);
    const field = screen.getByRole('adjustable', { name: 'Weight, kilograms' });
    expect(field).toHaveAccessibilityValue({ text: '72,5 kilograms' });
    expect(field.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual(
      expect.arrayContaining(['increment', 'decrement']),
    );
  });

  it('a TalkBack swipe steps it, like the buttons', async () => {
    await render(<Weight />);
    const field = screen.getByRole('adjustable', { name: 'Weight, kilograms' });
    await fireEvent(field, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(screen.getByTestId('weight.input')).toHaveDisplayValue('72,6');
    await fireEvent(field, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    await fireEvent(field, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(screen.getByTestId('weight.input')).toHaveDisplayValue('72,4');
  });

  it('the round buttons step by 0.1', async () => {
    await render(<Weight />);
    await fireEvent.press(screen.getByRole('button', { name: 'Increase by 0.1 kilograms' }));
    expect(screen.getByTestId('weight.input')).toHaveDisplayValue('72,6');
    await fireEvent.press(screen.getByRole('button', { name: 'Decrease by 0.1 kilograms' }));
    expect(screen.getByTestId('weight.input')).toHaveDisplayValue('72,5');
  });

  it('accepts typing with either separator', async () => {
    await render(<Weight initial="" />);
    await fireEvent.changeText(screen.getByTestId('weight.input'), '81.3');
    expect(screen.getByTestId('weight.input')).toHaveDisplayValue('81.3');
    await fireEvent.press(screen.getByRole('button', { name: 'Increase by 0.1 kilograms' }));
    expect(screen.getByTestId('weight.input')).toHaveDisplayValue('81,4');
  });

  // iOS keeps the text as typed and shows parseDecimal's error; dropping the
  // space or the unit would turn "7 2" into 72 and "1 900" into 1900.
  it('keeps what the member typed exactly as typed, for the caller to refuse', async () => {
    await render(<Weight initial="" />);
    for (const typed of ['7 2', '1 900', '72,5 kg']) {
      await fireEvent.changeText(screen.getByTestId('weight.input'), typed);
      expect(screen.getByTestId('weight.input')).toHaveDisplayValue(typed);
      expect(parseDecimal(typed)).toBeNull();
    }
  });

  it('an empty field steps from the fallback', async () => {
    await render(<Weight initial="" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Decrease by 0.1 kilograms' }));
    expect(screen.getByTestId('weight.input')).toHaveDisplayValue('69,9');
  });

  it('refuses to step outside the range', async () => {
    await render(<Weight initial="400" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Increase by 0.1 kilograms' }));
    expect(screen.getByTestId('weight.input')).toHaveDisplayValue('400');
  });

  // iOS BodySheet.stepHeight reads the field with HealthFormat.parseInt, so a
  // "170.5" it cannot read steps from the prefilled 170, never to 172.
  it('a whole-number stepper reads the field as a whole number', async () => {
    function Height() {
      const [text, setText] = useState('170.5');
      return (
        <NumberStepper
          testID="height"
          text={text}
          onChangeText={setText}
          step={1}
          min={100}
          max={250}
          fallback={170}
          integer
          unit="cm"
          label="Height"
          spokenUnit="centimetres"
          decreaseLabel="Decrease by 1 centimetre"
          increaseLabel="Increase by 1 centimetre"
        />
      );
    }
    await render(<Height />);
    await fireEvent.press(screen.getByRole('button', { name: 'Increase by 1 centimetre' }));
    expect(screen.getByTestId('height.input')).toHaveDisplayValue('171');
  });
});
