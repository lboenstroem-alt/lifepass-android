/**
 * Open Food Facts answers, decoded leniently (iOS OpenFoodFactsDecodeTests,
 * api-contract.md 5.2, F11). One odd field must never turn a good product
 * into "lookup failed", and an impossible label must never be sent.
 */
import { encodeOffSnapshot } from '../../types/encode';
import type { OFFSnapshot } from '../../types/models';
import { isLiquidQuantity, parseOffProduct, type OFFLookupOutcome } from '../parse';

const NOW = new Date(1_790_000_000 * 1000);

function parse(json: string, language = 'en', barcode = '5690527282050'): OFFLookupOutcome {
  return parseOffProduct(json, barcode, language, NOW);
}

function snapshot(outcome: OFFLookupOutcome): OFFSnapshot {
  if (outcome.kind !== 'found') throw new Error(`expected a product, got ${outcome.kind}`);
  return outcome.snapshot;
}

describe('Open Food Facts decoding', () => {
  it('decodes a plain product', () => {
    const product = snapshot(
      parse(`{"status":1,"product":{"product_name":"Skyr vanilla","brands":"Ísey, MS","serving_size":"200 g","serving_quantity":200,
        "nutriments":{"energy-kcal_100g":76,"proteins_100g":9.6,"carbohydrates_100g":8.1,"fat_100g":0.2,"sugars_100g":7.9,"salt_100g":0.1}}}`),
    );
    // The normalised code, not whatever the answer says.
    expect(product.barcode).toBe('5690527282050');
    expect(product.productName).toBe('Skyr vanilla');
    expect(product.productNameLang).toBe('other');
    // The first entry of brands.
    expect(product.brand).toBe('Ísey');
    expect(product.per100g.kcal).toBe(76);
    expect(product.per100g.proteinG).toBe(9.6);
    expect(product.servingLabel).toBe('200 g');
    expect(product.servingQuantityG).toBe(200);
    expect(product.energyFromKj).toBe(false);
    expect(product.retrievedAt).toBe(NOW.toISOString());
    expect(product.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  // "30", "30.5" and "30,5" are all numbers; anything else is absent.
  it('decodes numeric strings', () => {
    const product = snapshot(
      parse(`{"status":1,"product":{"product_name":"Rye bread","serving_quantity":"30",
        "nutriments":{"energy-kcal_100g":"215","proteins_100g":"6,5","carbohydrates_100g":"43.2","fat_100g":"abc"}}}`),
    );
    expect(product.per100g.kcal).toBe(215);
    expect(product.per100g.proteinG).toBe(6.5);
    expect(product.per100g.carbsG).toBe(43.2);
    // A value that is not a number reads as absent.
    expect(product.per100g.fatG).toBeNull();
    expect(product.servingQuantityG).toBe(30);
  });

  it('never reads a boolean as a number', () => {
    const product = snapshot(parse('{"status":1,"product":{"product_name":"X","nutriments":{"energy-kcal_100g":50,"fat_100g":true}}}'));
    expect(product.per100g.fatG).toBeNull();
  });

  // Only kJ: converted at 4.184 and flagged.
  it('converts kilojoules and says so', () => {
    const product = snapshot(parse('{"status":1,"product":{"product_name":"Oat drink","nutriments":{"energy_100g":197}}}'));
    expect(product.per100g.kcal).toBe(47);
    expect(product.energyFromKj).toBe(true);
  });

  // Only per-serving values and a serving weight: scaled to 100 g.
  it('scales per-serving values to one hundred grams', () => {
    const product = snapshot(
      parse(`{"status":1,"product":{"product_name":"Protein bar","serving_size":"1 bar (60 g)","serving_quantity":60,
        "nutriments":{"energy-kcal_serving":210,"proteins_serving":20,"carbohydrates_serving":18,"fat_serving":6}}}`),
    );
    expect(product.per100g.kcal).toBe(350);
    expect(product.per100g.proteinG).toBeCloseTo(33.3, 2);
    expect(product.per100g.fatG).toBeCloseTo(10, 2);
  });

  it('scales per-serving kilojoules too, and flags them', () => {
    const product = snapshot(parse('{"status":1,"product":{"product_name":"Bar","serving_quantity":50,"nutriments":{"energy_serving":836.8}}}'));
    expect(product.per100g.kcal).toBe(400);
    expect(product.energyFromKj).toBe(true);
  });

  // Impossible values are "No nutrition facts", never sent.
  it('treats impossible values as no nutrition', () => {
    expect(parse('{"status":1,"product":{"product_name":"X","brands":"Y","nutriments":{"energy-kcal_100g":1200}}}')).toEqual({
      kind: 'noNutrition',
      name: 'X',
      brand: 'Y',
    });
    expect(parse('{"status":1,"product":{"product_name":"X","nutriments":{"energy-kcal_100g":300,"fat_100g":120}}}')).toEqual({
      kind: 'noNutrition',
      name: 'X',
      brand: null,
    });
    expect(
      parse('{"status":1,"product":{"product_name":"X","nutriments":{"energy-kcal_100g":400,"proteins_100g":40,"carbohydrates_100g":50,"fat_100g":20}}}'),
    ).toEqual({ kind: 'noNutrition', name: 'X', brand: null });
    expect(parse('{"status":1,"product":{"product_name":"X","nutriments":{"energy-kcal_100g":40,"salt_100g":101}}}')).toEqual({
      kind: 'noNutrition',
      name: 'X',
      brand: null,
    });
  });

  it('keeps the name when there is no energy at all', () => {
    expect(parse('{"status":1,"product":{"product_name":"Harðfiskur","brands":"Eyjabiti","nutriments":{}}}')).toEqual({
      kind: 'noNutrition',
      name: 'Harðfiskur',
      brand: 'Eyjabiti',
    });
  });

  it('is not found without a product or a name, and failed for what is not JSON', () => {
    expect(parse('{"status":0,"status_verbose":"product not found"}')).toEqual({ kind: 'notFound' });
    // No name at all is nothing a member could recognise.
    expect(parse('{"status":1,"product":{"nutriments":{"energy-kcal_100g":100}}}')).toEqual({ kind: 'notFound' });
    expect(parse('not json')).toEqual({ kind: 'failed' });
  });

  // The name follows the ACCOUNT language: Icelandic first for an Icelandic account, never for an English one.
  it('names the product in the account language', () => {
    const json =
      '{"status":1,"product":{"product_name":"Skyr","product_name_is":"Skyr með vanillu","product_name_en":"Vanilla skyr","nutriments":{"energy-kcal_100g":76}}}';
    const icelandic = snapshot(parse(json, 'is'));
    expect(icelandic.productName).toBe('Skyr með vanillu');
    expect(icelandic.productNameLang).toBe('is');
    const english = snapshot(parse(json, 'en'));
    expect(english.productName).toBe('Skyr');
    expect(english.productNameLang).toBe('other');
    const onlyEnglish = snapshot(parse('{"status":1,"product":{"product_name_en":"Vanilla skyr","nutriments":{"energy-kcal_100g":76}}}'));
    expect(onlyEnglish.productNameLang).toBe('en');
    const onlyIcelandic = snapshot(parse('{"status":1,"product":{"product_name_is":"Skyr","nutriments":{"energy-kcal_100g":76}}}', 'en'));
    expect(onlyIcelandic.productNameLang).toBe('is');
  });

  // Over-long names and brands are cut, whitespace collapsed.
  it('cuts and tidies long names', () => {
    const long = 'a'.repeat(200);
    const product = snapshot(
      parse(`{"status":1,"product":{"product_name":"  ${long}  ","brands":"${'b'.repeat(100)}, other","serving_size":"${'c'.repeat(60)}","nutriments":{"energy-kcal_100g":100}}}`),
    );
    expect(product.productName).toHaveLength(120);
    expect(product.brand).toHaveLength(80);
    expect(product.servingLabel).toHaveLength(40);
    const tidy = snapshot(parse('{"status":1,"product":{"product_name":"Skyr \\n   plain","nutriments":{"energy-kcal_100g":62}}}'));
    expect(tidy.productName).toBe('Skyr plain');
  });

  it('never cuts a character in half', () => {
    const product = snapshot(parse(`{"status":1,"product":{"product_name":"${'a'.repeat(119)}🇮🇸 skyr","nutriments":{"energy-kcal_100g":62}}}`));
    expect(product.productName).toBe(`${'a'.repeat(119)}🇮🇸`);
  });

  // A serving weight outside 1 to 2,000 g is ignored rather than trusted.
  it('ignores implausible serving weights', () => {
    const product = snapshot(parse('{"status":1,"product":{"product_name":"Water","serving_quantity":5000,"nutriments":{"energy-kcal_100g":0}}}'));
    expect(product.servingQuantityG).toBeNull();
  });

  it('recognises liquids by volume', () => {
    expect(isLiquidQuantity('330 ml')).toBe(true);
    expect(isLiquidQuantity('1 L')).toBe(true);
    expect(isLiquidQuantity('33cl')).toBe(true);
    expect(isLiquidQuantity('2 dl')).toBe(true);
    expect(isLiquidQuantity('200 g')).toBe(false);
    expect(isLiquidQuantity('1 bottle')).toBe(false);
    expect(isLiquidQuantity(null)).toBe(false);
    const outcome = parse('{"status":1,"product":{"product_name":"Cola","quantity":"330 ml","nutriments":{"energy-kcal_100g":42}}}');
    expect(outcome.kind === 'found' && outcome.liquid).toBe(true);
  });

  // Exactly what the server's offSnapshotSchema accepts: no unknown key, optional keys absent rather than null.
  it('encodes the snapshot to the server schema', () => {
    const product = snapshot(parse('{"status":1,"product":{"product_name":"Skyr","nutriments":{"energy-kcal_100g":62,"proteins_100g":10}}}'));
    const object = JSON.parse(JSON.stringify(encodeOffSnapshot(product))) as Record<string, unknown>;
    expect(new Set(Object.keys(object))).toEqual(new Set(['barcode', 'productName', 'productNameLang', 'per100g', 'energyFromKj', 'retrievedAt']));
    expect(new Set(Object.keys(object.per100g as object))).toEqual(new Set(['kcal', 'proteinG']));
  });
});
