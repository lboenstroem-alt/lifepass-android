/**
 * The day plan as drawn (iOS CoachPlanView.swift): the intro, the steps in
 * Before / Main / After order with their slot labels and notes, the three
 * kinds of card with their honesty rules, and the chips (worded, waiting
 * while a reply is in flight). The actions are the wizard's (tested in
 * ../../dayPlan/__tests__/wizard.test.ts); here only that each control
 * calls the right one with the right argument.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { decodeVenue } from '../../../../api/venues';
import { setCurrentLanguage, translate, type Params } from '../../../../i18n';
import type { CoachFlowBubble } from '../../store/messages';
import { decodeCoachPlan } from '../../dayPlan/decode';
import { PLAN_MESSAGE_KIND, type PlanMessagePayload } from '../../dayPlan/wizard';
import PlanMessage from '../PlanMessage';

// expo-font (behind @expo/vector-icons) imports expo-asset, which npm left
// nested under expo/ where Jest's resolver cannot see it; Metro resolves it.
jest.mock('expo-asset', () => jest.requireActual('expo/node_modules/expo-asset'), { virtual: true });
// The hearts are VENUE-2's store; here a heart only has to draw.
jest.mock('../../../favourites', () => ({
  useFavourite: () => ({ isFavourite: false, loading: false, toggle: async () => undefined }),
}));
jest.mock('../../dayPlan/wizard', () => ({
  ...jest.requireActual('../../dayPlan/wizard'),
  refineDayPlan: jest.fn(async () => undefined),
  restartDayPlan: jest.fn(),
  bookPlanClass: jest.fn(async () => undefined),
  openPlanVenue: jest.fn(),
  openPlanSight: jest.fn(),
}));

const wizard = jest.requireMock('../../dayPlan/wizard') as {
  refineDayPlan: jest.Mock;
  restartDayPlan: jest.Mock;
  bookPlanClass: jest.Mock;
  openPlanVenue: jest.Mock;
  openPlanSight: jest.Mock;
};

/** Icons and pictures are decorative (hidden from TalkBack); queried anyway. */
const HIDDEN = { includeHiddenElements: true } as const;

const en = (key: string, params?: Params) => translate(key, 'en', params);
const is = (key: string, params?: Params) => translate(key, 'is', params);

const ACTIVITY = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

const WIRE_PLAN = {
  id: 'plan_abc',
  intro: 'A calm evening by the water.',
  steps: [
    {
      slot: 'after',
      kind: 'sight',
      note: 'Catch the falls before dark.',
      sight: {
        slug: 'seljalandsfoss',
        name: 'Seljalandsfoss',
        kind: 'waterfall',
        region: 'south',
        imageUrl: 'https://upload.example/falls.jpg',
        imageCredit: 'Jane Doe',
        driveFromReykjavik: { minutes: 95, km: 125 },
        roadAccess: 'road',
      },
    },
    {
      slot: 'main',
      kind: 'venue',
      note: 'Soak for an hour.',
      venue: { slug: 'sky-lagoon', name: 'Sky Lagoon', city: 'Kópavogur', imageUrl: null, category: 'Lagoon', priceLabel: 'Included' },
      distance: { basis: 'straight_line', km: 4.2, minutes: 9 },
    },
    {
      slot: 'before',
      kind: 'class',
      note: '',
      class: {
        id: 'cls_1',
        title: null,
        startsAt: '2030-03-02T17:00:00Z',
        endsAt: '2030-03-02T18:00:00Z',
        venueSlug: 'hress',
        venueName: 'Hress',
        booking: { kind: 'class', activityId: ACTIVITY, eventId: 4242 },
      },
      distance: { basis: 'drive', minutes: 12 },
    },
  ],
  chips: ['closer', 'Push harder'],
  refinements: [],
};

const SKY_LAGOON = decodeVenue({
  id: '00000000-0000-4000-8000-000000000012',
  slug: 'sky-lagoon',
  name: 'Sky Lagoon',
  city: 'Kópavogur',
  address: 'Vesturvör 44',
  categories: ['Lagoon'],
});

function planMessage(wire: object = WIRE_PLAN, venues: PlanMessagePayload['venues'] = {}): CoachFlowBubble {
  const plan = decodeCoachPlan(wire);
  const payload: PlanMessagePayload = { plan, venues };
  return { id: '201', role: 'assistant', text: plan.intro, flow: 'dayPlan', kind: PLAN_MESSAGE_KIND, payload, anchorTop: true };
}

async function draw(message: CoachFlowBubble, busy = false) {
  await render(<PlanMessage message={message} busy={busy} />);
  await act(async () => undefined);
}

beforeEach(() => {
  setCurrentLanguage('en');
  for (const action of [wizard.refineDayPlan, wizard.restartDayPlan, wizard.bookPlanClass, wizard.openPlanVenue, wizard.openPlanSight]) {
    action.mockClear();
  }
});

afterEach(() => setCurrentLanguage('en'));

it('draws the intro, then the steps before, main, after, each with its slot label and note', async () => {
  await draw(planMessage());
  expect(screen.getByText('A calm evening by the water.')).toBeOnTheScreen();
  const labels = screen.getAllByText(/^(BEFORE|MAIN|AFTER)$/).map((node) => node.props.children);
  expect(labels).toEqual([en('coach.plan.slot.before'), en('coach.plan.slot.main'), en('coach.plan.slot.after')].map((label) => label.toUpperCase()));
  expect(screen.getByText('Soak for an hour.')).toBeOnTheScreen();
  expect(screen.getByText('Catch the falls before dark.')).toBeOnTheScreen();
  const steps = screen.getAllByTestId(/^coach\.plan\.step\./).map((node) => node.props.testID);
  expect(steps).toEqual(['coach.plan.step.before-class-cls_1', 'coach.plan.step.main-venue-sky-lagoon', 'coach.plan.step.after-sight-seljalandsfoss']);
});

it('an Icelandic member reads Icelandic labels', async () => {
  setCurrentLanguage('is');
  await draw(planMessage());
  expect(screen.getByText(is('coach.plan.slot.main').toUpperCase())).toBeOnTheScreen();
  expect(screen.getByText(is('coach.plan.refine.closer'))).toBeOnTheScreen();
  expect(screen.getByText(is('coach.plan.new'))).toBeOnTheScreen();
  expect(screen.getByText(is('coach.plan.distance.straight', { km: '4,2' }))).toBeOnTheScreen();
});

describe('the venue step', () => {
  it('before its row loads: the plan’s own name, city, distance and price label, and Book it by slug', async () => {
    await draw(planMessage());
    expect(screen.getByTestId('coach.plan.venue.sky-lagoon')).toBeOnTheScreen();
    expect(screen.getByText('Kópavogur')).toBeOnTheScreen();
    expect(screen.getByText('Included')).toBeOnTheScreen();
    // A straight line, never a drive time, even with minutes on the wire.
    expect(screen.getByText(en('coach.plan.distance.straight', { km: '4.2' }))).toBeOnTheScreen();
    expect(screen.queryByText(en('coach.plan.distance.drive', { minutes: '9' }))).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: `${en('coach.venue.book_it')}, Sky Lagoon` }));
    expect(wizard.openPlanVenue).toHaveBeenCalledWith('sky-lagoon');
  });

  it('once its row is in: the carousel’s card, with the heart and the distance line', async () => {
    await draw(planMessage(WIRE_PLAN, { 'sky-lagoon': SKY_LAGOON }));
    expect(screen.queryByTestId('coach.plan.venue.sky-lagoon')).toBeNull();
    expect(screen.getByTestId('coach.venue.sky-lagoon')).toBeOnTheScreen();
    expect(screen.getByTestId('coach.venue.sky-lagoon.heart')).toBeOnTheScreen();
    expect(screen.getByText('Kópavogur · Vesturvör 44')).toBeOnTheScreen();
    expect(screen.getByText(en('coach.plan.distance.straight', { km: '4.2' }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('coach.venue.sky-lagoon.book'));
    expect(wizard.openPlanVenue).toHaveBeenCalledWith('sky-lagoon');
  });
});

describe('the class step', () => {
  it('when, an unnamed class in words, where, a measured drive with a car, and Book', async () => {
    await draw(planMessage());
    expect(screen.getByText('Sat 2 Mar · 17:00–18:00')).toBeOnTheScreen();
    expect(screen.getByText(en('classes.unnamed'))).toBeOnTheScreen();
    expect(screen.getByText('Hress')).toBeOnTheScreen();
    expect(screen.getByText(en('coach.plan.distance.drive', { minutes: '12' }))).toBeOnTheScreen();
    expect(screen.getByTestId('coach.plan.class.cls_1.distance.car', HIDDEN)).toBeOnTheScreen();
  });

  it('Book hands the session to the class sheet’s lookup, spins meanwhile and ignores a second tap', async () => {
    let finish: () => void = () => undefined;
    wizard.bookPlanClass.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    await draw(planMessage());
    const book = screen.getByRole('button', { name: `${en('coach.plan.class.book')}, ${en('classes.unnamed')}` });
    await fireEvent.press(book);
    expect(screen.getByTestId('coach.plan.class.cls_1.spinner')).toBeOnTheScreen();
    expect(book).toBeBusy();
    await fireEvent.press(book);
    expect(wizard.bookPlanClass).toHaveBeenCalledTimes(1);
    expect(wizard.bookPlanClass.mock.calls[0]![0]).toMatchObject({ id: 'cls_1', venueSlug: 'hress', booking: { eventId: 4242 } });
    await act(async () => finish());
    expect(screen.queryByTestId('coach.plan.class.cls_1.spinner')).toBeNull();
  });
});

describe('the sight step', () => {
  it('a credited photo, its credit, kind and region, the drive from Reykjavík, and See the place', async () => {
    await draw(planMessage());
    expect(screen.getByTestId('coach.plan.sight.seljalandsfoss.image', HIDDEN)).toBeOnTheScreen();
    expect(screen.getByText(`${en('attraction.photo')}: Jane Doe`)).toBeOnTheScreen();
    expect(screen.getByText(`${en('attraction.kind.waterfall')} · ${en('attraction.region.south')}`)).toBeOnTheScreen();
    expect(screen.getByText(en('coach.plan.sight.from_reykjavik', { duration: '1 h 35 min' }))).toBeOnTheScreen();
    expect(screen.getByTestId('coach.plan.sight.seljalandsfoss.travel.car', HIDDEN)).toBeOnTheScreen();
    await fireEvent.press(screen.getByText(en('coach.plan.sight.open')));
    expect(wizard.openPlanSight).toHaveBeenCalledWith('seljalandsfoss');
  });

  it('a photo without its photographer is not drawn: the ring, and no credit', async () => {
    const wire = { ...WIRE_PLAN, steps: [{ ...WIRE_PLAN.steps[0], sight: { ...WIRE_PLAN.steps[0]!.sight, imageCredit: null } }] };
    await draw(planMessage(wire));
    expect(screen.getByTestId('coach.plan.sight.seljalandsfoss.ring', HIDDEN)).toBeOnTheScreen();
    expect(screen.queryByTestId('coach.plan.sight.seljalandsfoss.credit')).toBeNull();
  });

  it('the plate is drawn, never credited', async () => {
    const plate = { imageUrl: 'https://www.lifepass.is/attractions/plate/seljalandsfoss.png', imageCredit: 'Someone' };
    const wire = { ...WIRE_PLAN, steps: [{ ...WIRE_PLAN.steps[0], sight: { ...WIRE_PLAN.steps[0]!.sight, ...plate } }] };
    await draw(planMessage(wire));
    expect(screen.getByTestId('coach.plan.sight.seljalandsfoss.image', HIDDEN)).toBeOnTheScreen();
    expect(screen.queryByTestId('coach.plan.sight.seljalandsfoss.credit')).toBeNull();
  });

  it('a step’s straight line is a pin and "about N km away", never a drive', async () => {
    const wire = {
      ...WIRE_PLAN,
      steps: [{ ...WIRE_PLAN.steps[0], distance: { basis: 'straight_line', km: 31.6 } }],
    };
    await draw(planMessage(wire));
    expect(screen.getByText(en('coach.plan.distance.straight', { km: '32' }))).toBeOnTheScreen();
    expect(screen.getByTestId('coach.plan.sight.seljalandsfoss.travel.pin', HIDDEN)).toBeOnTheScreen();
    expect(screen.queryByTestId('coach.plan.sight.seljalandsfoss.travel.car', HIDDEN)).toBeNull();
  });

  it('a ferry sight says so, with no drive', async () => {
    const wire = { ...WIRE_PLAN, steps: [{ ...WIRE_PLAN.steps[0], sight: { ...WIRE_PLAN.steps[0]!.sight, roadAccess: 'ferry' } }] };
    await draw(planMessage(wire));
    expect(screen.getByText(en('attraction.ferry_no_port'))).toBeOnTheScreen();
    expect(screen.queryByText(en('coach.plan.sight.from_reykjavik', { duration: '1 h 35 min' }))).toBeNull();
  });
});

describe('the chips', () => {
  it('a bare change name is worded by the app; a label is the server’s; each refines this plan', async () => {
    await draw(planMessage());
    await fireEvent.press(screen.getByRole('button', { name: en('coach.plan.refine.closer') }));
    expect(wizard.refineDayPlan).toHaveBeenCalledWith('201', 'closer');
    await fireEvent.press(screen.getByRole('button', { name: 'Push harder' }));
    expect(wizard.refineDayPlan).toHaveBeenCalledWith('201', 'Push harder');
    await fireEvent.press(screen.getByRole('button', { name: en('coach.plan.new') }));
    expect(wizard.restartDayPlan).toHaveBeenCalledTimes(1);
  });

  it('wait while a reply is in flight', async () => {
    await draw(planMessage(), true);
    const chip = screen.getByRole('button', { name: en('coach.plan.refine.closer') });
    expect(chip).toBeDisabled();
    expect(screen.getByRole('button', { name: en('coach.plan.new') })).toBeDisabled();
    await fireEvent.press(chip);
    expect(wizard.refineDayPlan).not.toHaveBeenCalled();
  });
});

it('a message without a plan payload draws as a plain bubble', async () => {
  await draw({ id: '9', role: 'assistant', text: 'Saved intro.', flow: 'dayPlan', kind: PLAN_MESSAGE_KIND });
  expect(screen.getByText('Saved intro.')).toBeOnTheScreen();
  expect(screen.queryByTestId('coach.plan.9')).toBeNull();
});
