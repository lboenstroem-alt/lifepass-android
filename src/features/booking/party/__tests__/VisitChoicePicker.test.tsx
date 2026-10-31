/**
 * The premium rung picker on screen (iOS BookingChargeSection
 * visitChoicePicker): the title, one row per rung with its price, the
 * picked one marked, a tap on the other picks it, nothing while a booking is
 * in flight, and both languages.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { VisitChoiceOption } from '../../../../api/bookings';
import { lookup, setCurrentLanguage } from '../../../../i18n';
import VisitChoicePicker, { visitChoiceLabelKey } from '../VisitChoicePicker';

// The UI kit's icons load fonts, whose loader needs expo-asset.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });

const OPTIONS: VisitChoiceOption[] = [
  { choice: 'spend_visit', priceIsk: 1_500, consumesVisit: true, surchargeReason: 'premium_subscriber_visit', breakdown: null },
  { choice: 'keep_visit', priceIsk: 4_900, consumesVisit: false, surchargeReason: 'premium_visit_kept', breakdown: null },
];
const CHOICES = OPTIONS.map((option) => option.choice);

beforeEach(() => setCurrentLanguage('en'));

it('names each rung with its price; the picked one is marked', async () => {
  await render(<VisitChoicePicker choices={CHOICES} options={OPTIONS} selected="spend_visit" onSelect={jest.fn()} />);
  expect(screen.getByText(lookup('consent.visit_choice_title', 'en'))).toBeOnTheScreen();
  expect(screen.getByText('Use a visit + surcharge')).toBeOnTheScreen();
  expect(screen.getByText(lookup('consent.visit_choice_keep', 'en'))).toBeOnTheScreen();
  expect(screen.getByText('ISK 1,500')).toBeOnTheScreen();
  expect(screen.getByText('ISK 4,900')).toBeOnTheScreen();

  const spend = screen.getByRole('radio', { name: 'Use a visit + surcharge, ISK 1,500' });
  const keep = screen.getByRole('radio', { name: `${lookup('consent.visit_choice_keep', 'en')}, ISK 4,900` });
  expect(spend).toBeChecked();
  expect(keep).not.toBeChecked();
  // The picked row is tinted with the accent; the other is the plain row.
  expect(spend).toHaveStyle({ backgroundColor: 'rgba(71,133,194,0.15)' });
  expect(keep).not.toHaveStyle({ backgroundColor: 'rgba(71,133,194,0.15)' });
});

it('a tap on the other rung picks it; the picked one asks nothing again', async () => {
  const onSelect = jest.fn();
  await render(<VisitChoicePicker choices={CHOICES} options={OPTIONS} selected="spend_visit" onSelect={onSelect} />);
  await fireEvent.press(screen.getByTestId('booking.visit_choice.spend_visit'));
  expect(onSelect).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('booking.visit_choice.keep_visit'));
  expect(onSelect).toHaveBeenCalledWith('keep_visit');
});

it('refuses taps while a booking is in flight', async () => {
  const onSelect = jest.fn();
  await render(<VisitChoicePicker choices={CHOICES} options={OPTIONS} selected="spend_visit" onSelect={onSelect} disabled />);
  const keep = screen.getByTestId('booking.visit_choice.keep_visit');
  expect(keep).toBeDisabled();
  await fireEvent.press(keep);
  expect(onSelect).not.toHaveBeenCalled();
});

it('draws nothing with no rungs, and the rung names alone without prices', async () => {
  const { rerender } = await render(<VisitChoicePicker choices={[]} selected={null} onSelect={jest.fn()} />);
  expect(screen.queryByTestId('booking.visit_choice')).toBeNull();
  await rerender(<VisitChoicePicker choices={CHOICES} selected={null} onSelect={jest.fn()} />);
  expect(screen.getByRole('radio', { name: 'Use a visit + surcharge' })).not.toBeChecked();
  expect(screen.queryByText(/ISK/)).toBeNull();
});

it('reads in Icelandic, the price still "ISK 4,900"', async () => {
  setCurrentLanguage('is');
  await render(<VisitChoicePicker choices={CHOICES} options={OPTIONS} selected="keep_visit" onSelect={jest.fn()} />);
  expect(screen.getByText('Hvernig viltu greiða?')).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: `${lookup('consent.visit_choice_keep', 'is')}, ISK 4,900` })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Nota heimsókn + álag, ISK 1,500' })).not.toBeChecked();
});

it('keep_visit is the keep row; any other rung is the spend row', () => {
  expect(visitChoiceLabelKey('keep_visit')).toBe('consent.visit_choice_keep');
  expect(visitChoiceLabelKey('spend_visit')).toBe('consent.visit_choice_spend');
  expect(visitChoiceLabelKey('anything')).toBe('consent.visit_choice_spend');
});
