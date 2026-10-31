/**
 * Log a workout on any day (API 0.34.0): the port of iOS LogWorkoutTests
 * (LifePassTests/LogWorkoutTests.swift, release/2.5.6 at 161a0a8), same cases
 * and vectors: the body the app sends, what it reads back from servers with
 * and without the release, the sheet's rules and its copy. Stubbed
 * throughout: nothing here talks to a server.
 *
 * Android splits iOS's types across modules: the body is the health API's
 * `SessionAction`, the decoders the health models', the gate and the pull
 * candidate the Today card's rules (PLAN-2), the extra's line its copy; the
 * form and the sheet's own copy are this package's.
 */
import { encodeBody } from '../../../../api';
import {
  decodeCachedHealthDay,
  decodeHealthDay,
  decodeSessionHistoryItem,
  decodeSessionView,
  encodeHealthDay,
  EXTRA_WORKOUT_CHIPS,
  EXTRA_WORKOUT_KINDS,
  extraWorkoutLabelKey,
  SessionAction,
  useHealthStore,
  type ExtraWorkoutView,
  type HealthDay,
  type SessionActionBody,
  type SessionView,
} from '../../../../health';
import { resetHealthStoreForTests } from '../../../../health/store';
import { lookup, translate, type Params } from '../../../../i18n';
import { shortDay } from '../../../../i18n/format';
import { refusedParams } from '../../../../lib/analytics';
import en from '../../../../i18n/strings.en.json';
import is from '../../../../i18n/strings.is.json';
import { extraLine, extraRemoveLabel } from '../../today/copy';
import { offersLogWorkout, restPullCandidate } from '../../today/rules';
import { alreadyLoggedKey, dateLine, pullLine, type Translate } from '../copy';
import {
  beginSave,
  canSave,
  chooseDuration,
  chooseKind,
  cleanNote,
  CUSTOM_DURATION,
  customMinutesInvalid,
  formMinutes,
  logWorkoutBody,
  newLogWorkoutForm,
  noteLength,
  presetDuration,
  saveFailed,
  saveSucceeded,
  setCustomMinutes,
  setNote,
  showsNoteCounter,
  type LogWorkoutForm,
} from '../form';

// MARK: Helpers

/** The body as the API client sends it (ISO 8601 dates, undefined left out). */
function wire(body: SessionActionBody): Record<string, unknown> {
  return JSON.parse(encodeBody(body)) as Record<string, unknown>;
}

function session(extra: Record<string, unknown> = {}): SessionView {
  return decodeSessionView(
    { id: 's-rest', programId: 'prog-1', scheduledFor: '2026-10-16', kind: 'rest', title: null, minutes: 0, status: 'rest', ...extra },
    'session',
  );
}

function decodeSession(json: Record<string, unknown>): SessionView {
  return decodeSessionView(json, 'session');
}

/** One extra, read the way the app reads it: inside a session's `extras`. */
function decodeExtra(json: Record<string, unknown>): ExtraWorkoutView {
  return decodeSessionView({ id: 's-1', extras: [json] }, 'session').extras![0]!;
}

function day(options: { date: string; session: Record<string, unknown>; upcoming?: unknown[]; weekStartsOn?: string }): HealthDay {
  const { date, upcoming = [], weekStartsOn = '2026-10-12' } = options;
  return decodeHealthDay({
    contractVersion: '2026-09-v1',
    date,
    today: date,
    locale: 'en',
    access: 'entitled',
    program: null,
    proposal: null,
    week: { programId: 'prog-1', weekNo: 2, weeks: 4, weekStartsOn, days: [] },
    day: { date, relative: 'today', programId: 'prog-1', session: options.session },
    note: null,
    meals: null,
    scores: null,
    review: null,
    weighIn: null,
    checkIn: null,
    upcoming,
    pendingDrafts: [],
    history: null,
    libraryVersion: '2026-09-v1',
  });
}

const english: Translate = (key: string, params?: Params) => translate(key, 'en', params);
const icelandic: Translate = (key: string, params?: Params) => translate(key, 'is', params);

// MARK: The body

describe('the body', () => {
  it('logging an extra sends the kind, the minutes and the note, and nothing else', () => {
    const json = wire(SessionAction.logExtra({ kind: 'strength', minutes: 45, note: '  Leg day  ', clientCompletedAt: null }));
    expect(Object.keys(json).sort()).toEqual(['action', 'asExtra', 'kind', 'minutes', 'note']);
    expect(json.action).toBe('done');
    expect(json.asExtra).toBe(true);
    expect(json.kind).toBe('strength');
    expect(json.minutes).toBe(45);
    expect(json.note).toBe('Leg day');
  });

  it('a class is sent by its wire name', () => {
    const json = wire(SessionAction.logExtra({ kind: 'class', minutes: 60, note: null, clientCompletedAt: null }));
    expect(json.kind).toBe('class');
    expect('note' in json).toBe(false); // no note is no key, not null
  });

  it('an empty note is left out', () => {
    const json = wire(SessionAction.logExtra({ kind: 'swim', minutes: 30, note: '   ', clientCompletedAt: null }));
    expect('note' in json).toBe(false);
  });

  it('a past card names its day at noon UTC', () => {
    const form = filledForm('cardio', 30);
    const body = logWorkoutBody(form, '2026-10-15', '2026-10-16')!;
    expect(wire(body).clientCompletedAt).toBe('2026-10-15T12:00:00Z');

    const todayBody = logWorkoutBody(form, '2026-10-16', '2026-10-16')!;
    expect('clientCompletedAt' in wire(todayBody)).toBe(false); // today's card lets the server stamp it
  });

  it('removing sends the action and the id only', () => {
    const json = wire(SessionAction.removeExtra('AbC123_-xyz09876'));
    expect(Object.keys(json).sort()).toEqual(['action', 'extraId']);
    expect(json.action).toBe('remove_extra');
    expect(json.extraId).toBe('AbC123_-xyz09876');
  });

  /**
   * The fields added at the end of the body must not leak into the actions
   * that were there before: the route's strict objects refuse a key an
   * action does not take.
   */
  it('the older actions send what they always sent', () => {
    expect(Object.keys(wire(SessionAction.done({ minutes: 40, feeling: null, clientCompletedAt: null, asExtra: null }))).sort()).toEqual([
      'action',
      'minutes',
    ]);
    expect(Object.keys(wire(SessionAction.undo))).toEqual(['action']);
    expect(Object.keys(wire(SessionAction.skip('time'))).sort()).toEqual(['action', 'skipReason']);
  });
});

// MARK: Reading servers with and without the release

describe('reading servers with and without the release', () => {
  it("an older server's extra still decodes", () => {
    const extra = decodeExtra({ index: 0, loggedAt: '2026-10-16T08:00:00Z', minutes: 30, feeling: null, performed: null });
    expect(extra.minutes).toBe(30);
    expect(extra.id).toBeNull();
    expect(extra.kind).toBeNull();
    expect(extra.note).toBeNull();
    expect(extra.canRemove).toBeNull();
  });

  it("a new server's extra decodes", () => {
    const extra = decodeExtra({
      index: 0,
      loggedAt: '2026-10-16T08:00:00Z',
      minutes: 45,
      feeling: null,
      performed: null,
      id: 'Zm9vYmFyYmF6cXV4',
      kind: 'strength',
      note: 'Leg day',
      title: 'Gym',
      canRemove: true,
    });
    expect(extra.id).toBe('Zm9vYmFyYmF6cXV4');
    expect(extra.kind).toBe('strength');
    expect(extra.note).toBe('Leg day');
    expect(extra.title).toBe('Gym');
    expect(extra.canRemove).toBe(true);
  });

  it('an unknown kind or an odd value costs only that value', () => {
    const extra = decodeExtra({ index: 0, minutes: 20, id: 42, kind: 'paddleboard', note: ['x'], title: null, canRemove: 'yes' });
    expect(extra.minutes).toBe(20);
    expect(extra.kind).toBe('unknown');
    expect(extra.id).toBeNull();
    expect(extra.note).toBeNull();
    expect(extra.canRemove).toBeNull();
  });

  it('an extra survives the cache round trip', () => {
    const json = { index: 0, minutes: 45, id: 'abcdefgh12345678', kind: 'class', note: 'Spin', title: 'Class', canRemove: false };
    const cached = day({ date: '2026-10-16', session: { id: 's-rest', kind: 'rest', status: 'rest', extras: [json] } });
    const again = decodeCachedHealthDay(encodeHealthDay(cached));
    expect(again?.day?.session?.extras).toEqual(cached.day?.session?.extras);
    expect(again?.day?.session?.extras?.[0]).toEqual(decodeExtra(json));
  });

  it('without canLogExtra the card offers nothing', () => {
    const old = session();
    expect(old.canLogExtra).toBeNull();
    expect(offersLogWorkout(old, { readOnly: false, isFuture: false, outboxPending: false })).toBe(false);

    const fresh = session({ canLogExtra: true });
    expect(offersLogWorkout(fresh, { readOnly: false, isFuture: false, outboxPending: false })).toBe(true);
    expect(offersLogWorkout(fresh, { readOnly: true, isFuture: false, outboxPending: false })).toBe(false);
    expect(offersLogWorkout(fresh, { readOnly: false, isFuture: true, outboxPending: false })).toBe(false);
    expect(offersLogWorkout(fresh, { readOnly: false, isFuture: false, outboxPending: true })).toBe(false);

    const refused = session({ canLogExtra: false });
    expect(offersLogWorkout(refused, { readOnly: false, isFuture: false, outboxPending: false })).toBe(false);
  });

  it('a history extra says what it was', () => {
    const items = [
      {
        id: 's-rest:extra:0',
        sessionId: 's-rest',
        date: '2026-10-16',
        kind: 'rest',
        title: 'Gym',
        status: 'done',
        minutes: 45,
        isExtra: true,
        extraKind: 'strength',
        note: 'Leg day',
      },
      { id: 's-1', sessionId: 's-1', date: '2026-10-15', kind: 'strength', title: 'Full body', status: 'done', minutes: 40, isExtra: false },
      {
        id: 's-2:extra:0',
        sessionId: 's-2',
        date: '2026-10-14',
        kind: 'rest',
        title: 'Extra workout',
        status: 'done',
        minutes: 30,
        isExtra: true,
        extraKind: 'surfing',
      },
    ].map((json, index) => decodeSessionHistoryItem(json, `items[${index}]`));
    expect(items[0]!.extraKind).toBe('strength');
    // Dormant: API 0.34.0 sends no note on history items. Should the server
    // add one, it decodes and the detail shows it.
    expect(items[0]!.note).toBe('Leg day');
    expect(items[2]!.note).toBeNull();
    expect(items[1]!.extraKind).toBeNull();
    expect(items[2]!.extraKind).toBe('unknown');
  });
});

// MARK: The form

function filledForm(kind: Parameters<typeof chooseKind>[1] = 'strength', minutes = 45): LogWorkoutForm {
  return chooseDuration(chooseKind(newLogWorkoutForm(), kind), presetDuration(minutes));
}

describe('the form', () => {
  it('Save waits for a type and a duration', () => {
    let form = newLogWorkoutForm();
    expect(canSave(form)).toBe(false);
    form = chooseKind(form, 'swim');
    expect(canSave(form)).toBe(false);
    form = chooseDuration(form, presetDuration(30));
    expect(canSave(form)).toBe(true);
    expect(formMinutes(form)).toBe(30);
  });

  it('one Save at a time', () => {
    const first = beginSave(filledForm());
    expect(first).not.toBeNull();
    expect(canSave(first!.form)).toBe(false); // Save is off while the request is in flight
    expect(beginSave(first!.form)).toBeNull(); // a double tap posts once
  });

  it('a retry reuses the key and a change or a success mints a new one', () => {
    let form = filledForm();
    const first = beginSave(form)!;
    form = saveFailed(first.form);
    const retry = beginSave(form)!;
    expect(retry.key).toBe(first.key); // a retry of the same Save is the same request
    form = saveFailed(retry.form);

    form = chooseDuration(form, presetDuration(60));
    const changed = beginSave(form)!;
    expect(changed.key).not.toBe(first.key); // a different workout is a different request
    form = saveSucceeded(changed.form);
    expect(form.idempotencyKey).not.toBe(changed.key); // the next workout gets its own key
    expect(form.isSaving).toBe(false);
  });

  it('choosing the same chip again keeps the key', () => {
    let form = filledForm();
    const key = form.idempotencyKey;
    form = chooseKind(form, 'strength');
    form = chooseDuration(form, presetDuration(45));
    form = setNote(form, '');
    expect(form.idempotencyKey).toBe(key);
  });

  it('nothing changes while saving', () => {
    let form = beginSave(filledForm())!.form;
    form = chooseKind(form, 'swim');
    form = chooseDuration(form, presetDuration(90));
    form = setNote(form, 'late edit');
    form = setCustomMinutes(form, '12');
    expect(form.kind).toBe('strength');
    expect(formMinutes(form)).toBe(45);
    expect(form.note).toBe('');
    expect(form.customMinutesText).toBe('');
  });

  it('custom minutes are one to three hundred', () => {
    let form = chooseDuration(chooseKind(newLogWorkoutForm(), 'other'), CUSTOM_DURATION);
    expect(formMinutes(form)).toBeNull();
    expect(customMinutesInvalid(form)).toBe(false); // an empty field is not an error yet

    form = setCustomMinutes(form, '0');
    expect(formMinutes(form)).toBeNull();
    expect(customMinutesInvalid(form)).toBe(true);
    expect(canSave(form)).toBe(false);

    form = setCustomMinutes(form, '1');
    expect(formMinutes(form)).toBe(1);
    form = setCustomMinutes(form, '300');
    expect(formMinutes(form)).toBe(300);
    expect(canSave(form)).toBe(true);

    form = setCustomMinutes(form, '301');
    expect(formMinutes(form)).toBeNull();
    expect(customMinutesInvalid(form)).toBe(true);
  });

  it('the minutes field takes digits only', () => {
    let form = chooseDuration(newLogWorkoutForm(), CUSTOM_DURATION);
    form = setCustomMinutes(form, '4 5a');
    expect(form.customMinutesText).toBe('45');
    form = setCustomMinutes(form, '12345');
    expect(form.customMinutesText).toBe('123');
    form = setCustomMinutes(form, '٤٥');
    expect(form.customMinutesText).toBe(''); // only ASCII digits parse as minutes
  });

  it('the note stops at 140', () => {
    let form = setNote(newLogWorkoutForm(), 'a'.repeat(200));
    expect(noteLength(form)).toBe(140);
    expect(showsNoteCounter(form)).toBe(true);

    form = setNote(form, 'a'.repeat(119));
    expect(showsNoteCounter(form)).toBe(false); // the counter shows from 120
    form = setNote(form, 'a'.repeat(120));
    expect(showsNoteCounter(form)).toBe(true);
  });

  it('the cap counts like the server and never splits a character', () => {
    // 139 units, then an emoji of two UTF-16 units: it does not fit.
    const note = `${'a'.repeat(139)}💪`;
    expect(cleanNote(note)).toBe('a'.repeat(139));
    expect(cleanNote('Sund 💪')).toBe('Sund 💪');
  });

  it('the note loses control and format characters', () => {
    expect(cleanNote('Leg\nday')).toBe('Leg day');
    expect(cleanNote('a\u{202E}b')).toBe('ab'); // a bidi override goes
    expect(cleanNote('a\u{200B}b')).toBe('ab'); // a zero-width space goes
    expect(cleanNote('a\u0007b')).toBe('ab');
    expect(cleanNote('Þórsmörk með Ásu')).toBe('Þórsmörk með Ásu');
    expect(cleanNote('a\u{FEFF}b')).toBe('ab'); // the BOM goes
    expect(cleanNote('a\u{E0041}b')).toBe('ab'); // a stray tag goes
  });

  it('the note keeps the emoji it is made of', () => {
    // The server keeps the joiner and a whole subdivision flag's tags
    // (`stripFormatCharacters`); so does the field, or the family below
    // would reach the server as three people.
    const family = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}';
    expect(cleanNote(`Sund með ${family}`)).toBe(`Sund með ${family}`);
    const rainbow = '\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}';
    expect(cleanNote(rainbow)).toBe(rainbow);
    const swimmer = '\u{1F3CA}\u{200D}\u{2640}\u{FE0F}';
    expect(cleanNote(swimmer)).toBe(swimmer);
    const england = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
    expect(cleanNote(`Gym ${england}`)).toBe(`Gym ${england}`);
    expect(cleanNote('a\u{200D}b')).toBe('a\u{200D}b'); // a joiner hides nothing
    // A black flag whose tags never close is a black flag and stray tags.
    expect(cleanNote('\u{1F3F4}\u{E0067}\u{E0062}x')).toBe('\u{1F3F4}x');
    // A whole family counts by its UTF-16 units and is never split.
    const note = 'a'.repeat(135) + family;
    expect(cleanNote(note)).toBe('a'.repeat(135));
  });
});

// MARK: Copy

describe('copy', () => {
  it('the extra line says the type only when there is one', () => {
    const gym = decodeExtra({ minutes: 45, kind: 'strength', title: 'Gym' });
    expect(extraLine(gym, english, 'en')).toBe('Extra workout · Gym · 45 min');
    expect(extraRemoveLabel(gym, english, 'en')).toBe('Remove extra workout: Gym, 45 minutes');

    const other = decodeExtra({ minutes: 30, kind: 'other', title: null });
    expect(extraLine(other, english, 'en')).toBe('Extra workout · 30 min');
    expect(extraRemoveLabel(other, english, 'en')).toBe('Remove extra workout: 30 minutes');

    const legacy = decodeExtra({ minutes: 20 });
    expect(extraLine(legacy, icelandic, 'is')).toBe('Aukaæfing · 20 mín');

    const swim = decodeExtra({ minutes: 21, kind: 'swim' });
    expect(extraLine(swim, icelandic, 'is')).toBe('Aukaæfing · Sund · 21 mín');
    // 21 takes the singular in Icelandic.
    expect(extraRemoveLabel(swim, icelandic, 'is')).toBe('Fjarlægja aukaæfingu: Sund, 21 mínúta');
  });

  it('the date line', () => {
    expect(dateLine('2026-10-16', '2026-10-16', english, 'en')).toBe('Today');
    expect(dateLine('2026-10-15', '2026-10-16', icelandic, 'is')).toBe('Í gær');
    expect(dateLine('2026-10-01', '2026-10-02', english, 'en')).toBe('Yesterday');
    expect(dateLine('2026-10-13', '2026-10-16', english, 'en')).toBe(shortDay('2026-10-13', 'en'));
  });

  it('the pull line names the day in each language', () => {
    // 2026-10-17 is a Saturday.
    expect(pullLine('2026-10-17', english)).toBe("Was it Saturday's session? Do it today instead");
    expect(pullLine('2026-10-17', icelandic)).toBe('Var þetta æfing laugardagsins? Taktu hana í dag í staðinn');
    expect(pullLine('2026-10-18', icelandic)).toBe('Var þetta æfing sunnudagsins? Taktu hana í dag í staðinn');
  });

  it('the already-logged line is for the watch and the door only', () => {
    const rest = session({ doneSource: 'wearable' });
    expect(alreadyLoggedKey(rest)).toBeNull(); // a rest row is not done

    const doneWatch = decodeSession({ id: 's-1', kind: 'strength', status: 'done', doneSource: 'wearable' });
    expect(alreadyLoggedKey(doneWatch)).toBe('logworkout.already_watch');
    const doneDoor = decodeSession({ id: 's-1', kind: 'strength', status: 'done', doneSource: 'check_in' });
    expect(alreadyLoggedKey(doneDoor)).toBe('logworkout.already_visit');
    const doneByHand = decodeSession({ id: 's-1', kind: 'strength', status: 'done', doneSource: 'member' });
    expect(alreadyLoggedKey(doneByHand)).toBeNull();
  });

  it('every logworkout key is in both languages', () => {
    const englishKeys = Object.keys(en).filter((key) => key.startsWith('logworkout.')).sort();
    const icelandicKeys = Object.keys(is).filter((key) => key.startsWith('logworkout.')).sort();
    expect(englishKeys.length).toBeGreaterThan(0);
    expect(icelandicKeys).toEqual(englishKeys);
    for (const kind of EXTRA_WORKOUT_KINDS) {
      expect((en as Record<string, string>)[extraWorkoutLabelKey(kind)]).toBeTruthy();
      expect((is as Record<string, string>)[extraWorkoutLabelKey(kind)]).toBeTruthy();
    }
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      expect((is as Record<string, string>)[`logworkout.weekday_gen.${weekday}`]).toBeTruthy();
    }
  });

  it('the chips are the six of the plan', () => {
    expect(EXTRA_WORKOUT_CHIPS).toEqual(['strength', 'class', 'swim', 'cardio', 'hike', 'other']);
    expect(EXTRA_WORKOUT_CHIPS.map((kind) => lookup(extraWorkoutLabelKey(kind), 'en'))).toEqual([
      'Gym',
      'Class',
      'Swim',
      'Run or walk',
      'Outdoors',
      'Other',
    ]);
    expect(EXTRA_WORKOUT_CHIPS.map((kind) => lookup(extraWorkoutLabelKey(kind), 'is'))).toEqual([
      'Ræktin',
      'Hóptími',
      'Sund',
      'Hlaup eða ganga',
      'Útivist',
      'Annað',
    ]);
  });
});

// MARK: Pull

describe('pulling a later session forward', () => {
  const restSession = { id: 's-rest', kind: 'rest', status: 'rest' };

  it('the pull candidate stays in this week', () => {
    // Friday 16 October; the week runs Monday 12 to Sunday 18.
    const upcoming = [
      { id: 'sat', scheduledFor: '2026-10-17', kind: 'strength', status: 'planned' },
      { id: 'mon', scheduledFor: '2026-10-19', kind: 'strength', status: 'planned' },
    ];
    expect(restPullCandidate(day({ date: '2026-10-16', session: restSession, upcoming }))?.id).toBe('sat');

    const onlyNextWeek = day({
      date: '2026-10-16',
      session: restSession,
      upcoming: [{ id: 'mon', scheduledFor: '2026-10-19', kind: 'strength', status: 'planned' }],
    });
    expect(restPullCandidate(onlyNextWeek)).toBeNull();

    const restOrDone = day({
      date: '2026-10-16',
      session: restSession,
      upcoming: [
        { id: 'a', scheduledFor: '2026-10-17', kind: 'rest', status: 'rest' },
        { id: 'b', scheduledFor: '2026-10-18', kind: 'swim', status: 'done' },
      ],
    });
    expect(restPullCandidate(restOrDone)).toBeNull();
  });

  it('a rest day that carries an extra offers no pull', () => {
    // A pull swaps the two rows whole: the workout logged on the rest day
    // would go with it to Saturday.
    const upcoming = [{ id: 'sat', scheduledFor: '2026-10-17', kind: 'strength', status: 'planned' }];
    const logged = day({
      date: '2026-10-16',
      session: { ...restSession, extras: [{ id: 'x-1', index: 0, minutes: 45, kind: 'strength' }] },
      upcoming,
    });
    expect(restPullCandidate(logged)).toBeNull();

    const empty = day({ date: '2026-10-16', session: { ...restSession, extras: [] }, upcoming });
    expect(restPullCandidate(empty)?.id).toBe('sat');
  });
});

// MARK: A past card updates in place

describe('a past card updates in place', () => {
  beforeEach(() => resetHealthStoreForTests());

  it("an answer about another date updates that date's read", () => {
    const yesterday = day({
      date: '2026-10-15',
      session: { id: 's-yday', scheduledFor: '2026-10-15', kind: 'rest', status: 'rest', canLogExtra: true },
    });
    useHealthStore.setState({ days: { '2026-10-15': yesterday }, profileId: 'test-profile' });

    const answered = decodeSession({
      id: 's-yday',
      scheduledFor: '2026-10-15',
      kind: 'rest',
      status: 'rest',
      canLogExtra: true,
      extras: [{ index: 0, minutes: 45, id: 'abcdefgh12345678', kind: 'strength', title: 'Gym', canRemove: true }],
    });
    const stranger = decodeSession({ id: 's-other', scheduledFor: '2026-10-15', kind: 'strength', status: 'done' });
    useHealthStore.getState().applySessionsToOtherDays([stranger, answered]);

    const shown = useHealthStore.getState().days['2026-10-15']?.day?.session;
    expect(shown?.id).toBe('s-yday');
    expect(shown?.extras).toHaveLength(1);
    expect(shown?.extras?.[0]?.title).toBe('Gym');
  });

  it('a date the store never read is left alone', () => {
    const answered = decodeSession({ id: 's-x', scheduledFor: '2026-10-10', kind: 'rest', status: 'rest' });
    useHealthStore.getState().applySessionsToOtherDays([answered]);
    expect(useHealthStore.getState().days['2026-10-10']).toBeUndefined();
  });
});

// MARK: Analytics

describe('analytics', () => {
  it('the analytics params are allowed', () => {
    for (const kind of EXTRA_WORKOUT_CHIPS) {
      expect(refusedParams({ kind, entry: 'rest', relative: 'past' })).toEqual([]);
    }
    for (const entry of ['done', 'skipped', 'missed', 'rest']) {
      expect(refusedParams({ kind: 'strength', entry, relative: 'today' })).toEqual([]);
    }
  });
});
