/**
 * The iOS WorkoutRunnerTests fixtures (LifePassTests/PlanSectionTests.swift),
 * verbatim: the five-block session, the intervals, the holds dosed each
 * side. Shared by the model, codec, persistence and outbox tests.
 */
import { translate } from '../../../../i18n';
import { decodeSessionView, type SessionView } from '../../../../health/models';
import { startRunnerState } from '../state';
import type { RunnerState } from '../types';

/** 2027-01-15T08:00:00Z, the iOS tests' `t0`. */
export const t0 = new Date(1_800_000_000_000);

/** `t0` plus `seconds`. */
export function at(seconds: number): Date {
  return new Date(t0.getTime() + seconds * 1000);
}

export const blocksJSON = `
[
  { "blockNo": 1, "exerciseId": "goblet_squat", "name": "Goblet squat", "pattern": "squat",
    "patternLabel": "Squat", "equipment": "dumbbell", "equipmentLabel": "Dumbbell",
    "sets": 3, "reps": 10, "perSide": false, "seconds": null, "minutes": null, "meters": null,
    "restSec": 90, "loadHint": "moderate", "lastLoadKg": 12.5, "cues": ["a", "b", "c", "d"],
    "alternatives": [
      { "exerciseId": "box_squat", "name": "Box squat", "equipment": "bodyweight",
        "equipmentLabel": "Bodyweight", "level": "easier", "unit": "reps", "reps": 10 },
      { "exerciseId": "leg_press", "name": "Leg press", "equipment": "machine",
        "equipmentLabel": "Machine", "level": "harder", "unit": "reps", "reps": 12 },
      { "exerciseId": "wall_sit", "name": "Wall sit", "equipment": "bodyweight",
        "equipmentLabel": "Bodyweight", "level": "easier" },
      { "exerciseId": "plank", "name": "Plank", "equipment": "bodyweight",
        "equipmentLabel": "Bodyweight", "level": "same", "unit": "seconds", "seconds": 30 },
      { "exerciseId": "goblet_squat", "name": "Goblet squat", "equipment": "dumbbell",
        "equipmentLabel": "Dumbbell", "level": "same", "unit": "reps", "reps": 10 }
    ] },
  { "blockNo": 2, "exerciseId": "reverse_lunge", "name": "Reverse lunge", "pattern": "lunge",
    "patternLabel": "Legs", "equipment": "bodyweight", "equipmentLabel": "Bodyweight",
    "sets": 2, "reps": 8, "perSide": true, "restSec": 0, "loadHint": "bodyweight",
    "cues": [], "alternatives": [] },
  { "blockNo": 3, "exerciseId": "plank", "name": "Plank", "pattern": "core",
    "patternLabel": "Core", "equipment": "bodyweight", "equipmentLabel": "Bodyweight",
    "sets": 2, "reps": null, "seconds": 40, "minutes": null, "restSec": 45,
    "loadHint": "bodyweight", "cues": ["ribs down"],
    "alternatives": [
      { "exerciseId": "dead_bug", "name": "Dead bug", "equipment": "bodyweight",
        "equipmentLabel": "Bodyweight", "level": "easier", "unit": "reps", "reps": 10, "perSide": true }
    ] },
  { "blockNo": 4, "exerciseId": "rower", "name": "Rower", "pattern": "cardio",
    "patternLabel": "Cardio", "equipment": "machine", "equipmentLabel": "Machine",
    "sets": 1, "reps": null, "seconds": 1200, "minutes": 20, "restSec": 30,
    "loadHint": "light", "cues": [], "alternatives": [] },
  { "blockNo": 5, "exerciseId": "easy_swim", "name": "Easy swim", "pattern": "swim",
    "patternLabel": "Swim", "equipment": "pool", "equipmentLabel": "Pool",
    "sets": 4, "reps": null, "seconds": null, "minutes": null, "meters": 100, "restSec": 30,
    "loadHint": "light", "cues": [],
    "alternatives": [
      { "exerciseId": "pool_walking", "name": "Pool walking", "equipment": "pool",
        "equipmentLabel": "Pool", "level": "easier", "unit": "seconds", "seconds": 120 }
    ] }
]
`;

/** What the server's engine sends for intervals: `minutes` is set on every cardio block, 6 × 45 s included. */
export const intervalsJSON = `
[
  { "blockNo": 1, "exerciseId": "rowing_intervals", "name": "Rowing intervals", "pattern": "cardio",
    "patternLabel": "Cardio", "equipment": "machine", "equipmentLabel": "Machine",
    "sets": 6, "reps": null, "perSide": false, "seconds": 45, "minutes": 1, "meters": null,
    "restSec": 75, "loadHint": "moderate", "cues": [], "alternatives": [] },
  { "blockNo": 2, "exerciseId": "long_rowing", "name": "Rowing, long", "pattern": "cardio",
    "patternLabel": "Cardio", "equipment": "machine", "equipmentLabel": "Machine",
    "sets": 3, "reps": null, "seconds": 120, "minutes": 2, "restSec": 60,
    "loadHint": "moderate", "cues": [], "alternatives": [] },
  { "blockNo": 3, "exerciseId": "marching", "name": "Marching in place", "pattern": "cardio",
    "patternLabel": "Cardio", "equipment": "bodyweight", "equipmentLabel": "Bodyweight",
    "sets": 3, "reps": null, "seconds": 500, "minutes": 8, "restSec": 60,
    "loadHint": "light", "cues": [], "alternatives": [] }
]
`;

/** What `hydrateBlock` sends for a half-kneeling hip flexor stretch (unit seconds, perSide true), and a plank beside it. */
export const perSideHoldJSON = `
[ { "blockNo": 1, "exerciseId": "half-kneeling-hip-flexor-stretch", "name": "Half-kneeling hip flexor stretch",
    "pattern": "core", "patternLabel": "Core", "equipment": "bodyweight", "equipmentLabel": "Bodyweight",
    "sets": 2, "reps": null, "perSide": true, "seconds": 20, "minutes": null, "meters": null,
    "restSec": 15, "loadHint": "bodyweight", "cues": [], "alternatives": [] },
  { "blockNo": 2, "exerciseId": "plank", "name": "Plank", "pattern": "core", "patternLabel": "Core",
    "equipment": "bodyweight", "equipmentLabel": "Bodyweight",
    "sets": 2, "reps": null, "perSide": false, "seconds": 40, "restSec": 45, "loadHint": "bodyweight",
    "cues": [], "alternatives": [] } ]
`;

export function session(
  options: {
    readonly blocks?: string;
    readonly scheduledFor?: string;
    readonly canSkip?: boolean;
    readonly id?: string;
    readonly minutes?: number;
  } = {},
): SessionView {
  const json = `
  { "id": "${options.id ?? 'sess-1'}", "programId": "prog-1", "weekNo": 2, "weekday": 3,
    "scheduledFor": "${options.scheduledFor ?? '2026-09-16'}", "kind": "strength", "title": "Full body strength",
    "minutes": ${options.minutes ?? 40}, "intensity": "moderate", "status": "planned", "canSkip": ${options.canSkip ?? true},
    "canLogDone": true, "blocks": ${options.blocks ?? blocksJSON} }`;
  return decodeSessionView(JSON.parse(json), 'session');
}

/** A runner opened on today's session at `t0`. */
export function fresh(blocks?: string): RunnerState {
  return startRunnerState({ session: session({ blocks }), origin: 'today', now: t0, today: '2026-09-16' });
}

/** The English translator the Swift tests pass as `t`. */
export function tEn(key: string, params: Readonly<Record<string, string>> = {}): string {
  return translate(key, 'en', params);
}

/** The Icelandic one. */
export function tIs(key: string, params: Readonly<Record<string, string>> = {}): string {
  return translate(key, 'is', params);
}
