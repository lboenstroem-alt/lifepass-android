/**
 * The meal request bodies as the server takes them: iOS's `encode(to:)` for
 * each type, written out because JSON.stringify cannot tell "not sent" from
 * "sent as null" the way the schema needs.
 *
 * - A field Swift encodes with `encodeIfPresent` (every synthesized optional)
 *   is LEFT OUT when null. The schema's item and override objects are strict
 *   and refuse a `null` where they expect a number.
 * - A serving in grams is `{ unit: 'g' }` alone. A named serving always
 *   carries `label` (1 to 40 characters, `1` when empty) and `grams`, as
 *   `null` when unknown: a nullable, not optional, field.
 * - A per-serving set always carries all four keys, an unknown macro as
 *   `null` (the server counts it 0 and marks the item's macros incomplete).
 *
 * Dates stay `Date` here: src/api/wire.ts `encodeBody` writes them as ISO
 * 8601 without fractions, as the iOS encoder does. `expectedUpdatedAt` is the
 * raw string the server sent and is never re-encoded.
 */
import { toWireDate } from '../../../api/wire';

import { isGramsServing, type MealCopyBody, type MealCreateBody, type MealDescribeBody, type MealItemInput, type MealPatchBody, type MealScanBody, type MealServing, type NutrientOverrides, type OFFSnapshot, type Per100g, type PerServing } from './models';
import { characterPrefix, trimWhitespace } from './text';

type WireObject = Record<string, unknown>;

/** Sets `key` only when `value` is not null (Swift `encodeIfPresent`). */
function putIfPresent(target: WireObject, key: string, value: unknown): void {
  if (value !== null && value !== undefined) target[key] = value;
}

/** `MealServing.encode(to:)`. */
export function encodeServing(serving: MealServing): WireObject {
  if (isGramsServing(serving)) return { unit: 'g' };
  // `label` is 1 to 40 characters on the wire.
  const trimmed = trimWhitespace(serving.label ?? '');
  return {
    unit: 'serving',
    label: characterPrefix(trimmed === '' ? '1' : trimmed, 40),
    grams: serving.grams ?? null,
  };
}

/** Synthesized `Per100g`: all four, always. */
export function encodePer100g(values: Per100g): WireObject {
  return { kcal: values.kcal, proteinG: values.proteinG, carbsG: values.carbsG, fatG: values.fatG };
}

/** `PerServing.encode(to:)`: the macros' keys are always there, null when unknown. */
export function encodePerServing(values: PerServing): WireObject {
  return {
    kcal: values.kcal,
    proteinG: values.proteinG ?? null,
    carbsG: values.carbsG ?? null,
    fatG: values.fatG ?? null,
  };
}

/** Synthesized `NutrientOverrides`: only the fields the member set. */
export function encodeOverrides(overrides: NutrientOverrides): WireObject {
  const out: WireObject = {};
  putIfPresent(out, 'kcal', overrides.kcal);
  putIfPresent(out, 'proteinG', overrides.proteinG);
  putIfPresent(out, 'carbsG', overrides.carbsG);
  putIfPresent(out, 'fatG', overrides.fatG);
  return out;
}

/** Synthesized `OFFSnapshot`: an unknown value is left out. */
export function encodeOffSnapshot(snapshot: OFFSnapshot): WireObject {
  const values = snapshot.per100g;
  const per100g: WireObject = { kcal: values.kcal };
  putIfPresent(per100g, 'proteinG', values.proteinG);
  putIfPresent(per100g, 'carbsG', values.carbsG);
  putIfPresent(per100g, 'fatG', values.fatG);
  putIfPresent(per100g, 'fibreG', values.fibreG);
  putIfPresent(per100g, 'sugarsG', values.sugarsG);
  putIfPresent(per100g, 'saturatedFatG', values.saturatedFatG);
  putIfPresent(per100g, 'saltG', values.saltG);
  const out: WireObject = {
    barcode: snapshot.barcode,
    productName: snapshot.productName,
    productNameLang: snapshot.productNameLang,
  };
  putIfPresent(out, 'brand', snapshot.brand);
  out.per100g = per100g;
  out.energyFromKj = snapshot.energyFromKj;
  putIfPresent(out, 'servingLabel', snapshot.servingLabel);
  putIfPresent(out, 'servingQuantityG', snapshot.servingQuantityG);
  out.retrievedAt = snapshot.retrievedAt;
  return out;
}

/** Synthesized `MealItemInput`. */
export function encodeItemInput(input: MealItemInput): WireObject {
  const out: WireObject = {};
  putIfPresent(out, 'id', input.id);
  out.source = input.source;
  out.label = input.label;
  putIfPresent(out, 'brand', input.brand);
  putIfPresent(out, 'foodId', input.foodId);
  putIfPresent(out, 'barcode', input.barcode);
  if (input.off) out.off = encodeOffSnapshot(input.off);
  out.serving = encodeServing(input.serving);
  out.amount = input.amount;
  if (input.per100g) out.per100g = encodePer100g(input.per100g);
  if (input.perServing) out.perServing = encodePerServing(input.perServing);
  if (input.overrides) out.overrides = encodeOverrides(input.overrides);
  out.confirmed = input.confirmed;
  return out;
}

/** OP-34. `loggedAt` stays a Date for `encodeBody`. */
export function encodeMealCreateBody(body: MealCreateBody): WireObject {
  return {
    slot: body.slot,
    loggedAt: body.loggedAt,
    logDate: body.logDate,
    source: body.source,
    items: body.items.map(encodeItemInput),
  };
}

/** OP-35: only what is set. */
export function encodeMealPatchBody(body: MealPatchBody): WireObject {
  const out: WireObject = {};
  putIfPresent(out, 'slot', body.slot);
  putIfPresent(out, 'loggedAt', body.loggedAt);
  putIfPresent(out, 'logDate', body.logDate);
  if (body.items) out.items = body.items.map(encodeItemInput);
  putIfPresent(out, 'confirmed', body.confirmed);
  putIfPresent(out, 'expectedUpdatedAt', body.expectedUpdatedAt);
  return out;
}

/** OP-46. */
export function encodeMealCopyBody(body: MealCopyBody): WireObject {
  return { logDate: body.logDate, loggedAt: body.loggedAt, slot: body.slot };
}

/** OP-32. */
export function encodeMealScanBody(body: MealScanBody): WireObject {
  return {
    image: { mediaType: 'image/jpeg', dataBase64: body.image.dataBase64 },
    slot: body.slot,
    logDate: body.logDate,
    loggedAt: body.loggedAt,
  };
}

/** OP-56: exactly these five keys. */
export function encodeMealDescribeBody(body: MealDescribeBody): WireObject {
  return { text: body.text, slot: body.slot, logDate: body.logDate, loggedAt: body.loggedAt, locale: body.locale };
}

/**
 * The create body as it is kept on disk (the outbox file): the wire shape,
 * with `loggedAt` as its wire string, so the queued request is the request.
 */
export function encodeMealCreateBodyForDisk(body: MealCreateBody): WireObject {
  return { ...encodeMealCreateBody(body), loggedAt: toWireDate(body.loggedAt) };
}
