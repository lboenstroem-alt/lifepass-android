/**
 * Home's Today row, branch by branch (iOS `HomeTodayRow.state`, `ios-ux.md`
 * 2.4): who sees it at all, then the first matching state.
 */
import { decodeProfile, type ProfileProgramSummary, type ProfileTodaySession } from '../../../../api/profile';
import { translate, type Lang } from '../../../../i18n';
import { homeTodayKicker, homeTodayRowState, type HomeTodayRowInput } from '../homeTodayRowState';

const tIn = (lang: Lang) => (key: string, params?: Record<string, string | number>) => translate(key, lang, params);

function today(overrides: Partial<ProfileTodaySession> = {}): ProfileTodaySession {
  return {
    sessionId: 's-1',
    kind: 'strength',
    title: 'Full body strength',
    minutes: 40,
    status: 'planned',
    bookingId: null,
    hasBooking: null,
    bookingTitle: null,
    bookingStartsAt: null,
    movedAway: null,
    ...overrides,
  };
}

function program(session: ProfileTodaySession | null = today(), overrides: Partial<ProfileProgramSummary> = {}): ProfileProgramSummary {
  return { id: 'p-1', status: 'active', weekNo: 2, weeks: 4, summaryTitle: null, today: session, ...overrides };
}

function input(overrides: Partial<HomeTodayRowInput> = {}): HomeTodayRowInput {
  return {
    access: 'entitled',
    hasConsent: true,
    program: program(),
    outboxPending: () => false,
    localTodaySession: null,
    upcomingBookingId: null,
    t: tIn('en'),
    language: 'en',
    ...overrides,
  };
}

const state = (overrides: Partial<HomeTodayRowInput> = {}) => homeTodayRowState(input(overrides));

describe('who sees the row', () => {
  it('an entitled member with consent and a live programme', () => {
    expect(state().kind).toBe('startable');
    expect(state({ program: program(today(), { status: 'paused' }) }).kind).toBe('startable');
  });

  it.each(['past_due', 'pass_only', 'not_member', 'company_inactive', 'minor', 'unknown'] as const)('nobody with %s access', (access) => {
    expect(state({ access }).kind).toBe('hidden');
  });

  it('nobody without consent, a programme or a session today', () => {
    expect(state({ hasConsent: false }).kind).toBe('hidden');
    expect(state({ program: null }).kind).toBe('hidden');
    expect(state({ program: program(null) }).kind).toBe('hidden');
  });

  it.each(['proposed', 'completed', 'abandoned', 'discarded', 'unknown'] as const)('not over a %s programme', (status) => {
    expect(state({ program: program(today(), { status }) }).kind).toBe('hidden');
  });
});

describe('the first matching state', () => {
  it('a strength session is startable, named with its duration', () => {
    expect(state()).toEqual({
      kind: 'startable',
      title: 'Full body strength, 40 min',
      glyph: 'strength',
      analyticsKind: 'strength',
      isDone: false,
      startSessionId: 's-1',
    });
    const icelandic = state({ t: tIn('is'), language: 'is', program: program(today({ minutes: 75 })) });
    expect(icelandic.kind === 'startable' && icelandic.title).toBe('Full body strength, 1 klst 15 mín');
    const noMinutes = state({ program: program(today({ minutes: null })) });
    expect(noMinutes.kind === 'startable' && noMinutes.title).toBe('Full body strength');
  });

  it('moved away outranks everything', () => {
    const moved = state({ program: program(today({ movedAway: true, status: 'done' })) });
    expect(moved).toMatchObject({ kind: 'plain', title: "Today's plan changed. See Plan.", glyph: 'strength', isDone: true });
  });

  it('done on this phone: the outbox holds it, or the Plan read says done', () => {
    const queued = state({ outboxPending: (id) => id === 's-1' });
    expect(queued).toMatchObject({ kind: 'plain', title: 'Done today. Nice work.', glyph: 'rest', isDone: true });
    const readDone = state({ localTodaySession: { id: 's-1', status: 'done' } });
    expect(readDone).toMatchObject({ kind: 'plain', title: 'Done today. Nice work.' });
    // A Plan read about another session says nothing about this one.
    expect(state({ localTodaySession: { id: 's-2', status: 'done' } }).kind).toBe('startable');
    expect(state({ localTodaySession: { id: 's-1', status: 'planned' } }).kind).toBe('startable');
  });

  it('done, skipped and rest', () => {
    expect(state({ program: program(today({ status: 'done' })) })).toMatchObject({ kind: 'plain', title: 'Done today. Nice work.', isDone: true });
    expect(state({ program: program(today({ status: 'skipped' })) })).toMatchObject({ kind: 'plain', title: "Today's plan changed. See Plan." });
    expect(state({ program: program(today({ status: 'rest', kind: 'rest' })) })).toMatchObject({ kind: 'plain', title: 'Rest day. A soak or a walk?', glyph: 'rest' });
    expect(
      state({ t: tIn('is'), language: 'is', program: program(today({ status: 'rest', kind: 'rest' })) }),
    ).toMatchObject({ title: 'Hvíldardagur. Laug eða göngutúr?' });
  });

  it('missed and unknown are hidden', () => {
    expect(state({ program: program(today({ status: 'missed' })) }).kind).toBe('hidden');
    expect(state({ program: program(today({ status: 'unknown' })) }).kind).toBe('hidden');
    expect(state({ program: program(today({ status: null })) }).kind).toBe('hidden');
  });

  it('swim, hike and walk are plain rows: the runner does not run them', () => {
    for (const kind of ['swim', 'hike', 'walk'] as const) {
      expect(state({ program: program(today({ kind, title: 'Pool', minutes: 30 })) })).toMatchObject({
        kind: 'plain',
        title: 'Pool, 30 min',
        glyph: kind,
        startSessionId: null,
      });
    }
    expect(state({ program: program(today({ kind: 'cardio' })) }).kind).toBe('startable');
    expect(state({ program: program(today({ kind: 'mobility' })) }).kind).toBe('startable');
  });

  it('a class: the title, the booked line, or nothing when Home already shows the booking', () => {
    const unbooked = state({ program: program(today({ kind: 'class', title: 'Yoga', hasBooking: false })) });
    expect(unbooked).toMatchObject({ kind: 'plain', title: 'Yoga', glyph: 'class' });

    const startsAt = new Date(2026, 9, 16, 18, 0);
    const booked = today({ kind: 'class', title: 'Yoga', hasBooking: true, bookingId: 'b-1', bookingTitle: 'Hot yoga', bookingStartsAt: startsAt });
    expect(state({ program: program(booked) })).toMatchObject({ kind: 'plain', title: 'Booked: Hot yoga, 18:00' });
    expect(state({ program: program(booked), t: tIn('is'), language: 'is' })).toMatchObject({ title: 'Bókað: Hot yoga kl. 18:00' });
    expect(state({ program: program(booked), upcomingBookingId: 'b-1' }).kind).toBe('hidden');
    expect(state({ program: program({ ...booked, bookingTitle: null }) })).toMatchObject({ title: 'Booked: Yoga, 18:00' });
  });

  it('a planned rest or unknown kind is hidden', () => {
    expect(state({ program: program(today({ kind: 'rest' })) }).kind).toBe('hidden');
    expect(state({ program: program(today({ kind: null })) }).kind).toBe('hidden');
  });
});

describe('the kicker', () => {
  it('says the week, defaulting to 1 of 4', () => {
    expect(homeTodayKicker(program(), tIn('en'))).toBe('Today · week 2 of 4');
    expect(homeTodayKicker(null, tIn('is'))).toBe('Í dag · vika 1 af 4');
  });

  it('reads the profile block the server sends', () => {
    const profile = decodeProfile({
      id: '8c2c1b36-2a7e-4b1f-9e0e-2f1c4f0a9c11',
      email: 'member@example.com',
      locale: 'en',
      kennitalaVerified: true,
      marketingConsent: false,
      health: {
        access: 'entitled',
        consent: { version: '2026-09-v1', consentedAt: '2026-09-20T10:00:00Z' },
        program: {
          id: 'p-1',
          status: 'active',
          weekNo: 3,
          weeks: 4,
          today: { sessionId: 's-9', kind: 'mobility', title: 'Mobility flow', minutes: 20, status: 'planned' },
        },
      },
    });
    const row = homeTodayRowState(input({ program: profile.health?.program }));
    expect(row).toMatchObject({ kind: 'startable', title: 'Mobility flow, 20 min', startSessionId: 's-9' });
    expect(homeTodayKicker(profile.health?.program, tIn('en'))).toBe('Today · week 3 of 4');
  });
});
