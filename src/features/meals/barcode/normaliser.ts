/**
 * Turns a scanned or typed barcode into the code every lookup uses: the
 * port of iOS `BarcodeNormaliser` (Services/BarcodeNormaliser.swift,
 * ios-ux.md 12.5, api-contract.md 5.1, F11).
 *
 * WHY. A UPC-E symbol is 8 compressed digits, while Open Food Facts files
 * the product under the expanded code. Looking up the 8 digits finds nothing
 * and the member is told a product on the shelf does not exist. So a UPC-E
 * read is expanded to UPC-A by the standard rule and then to EAN-13 with a
 * leading 0, and that one code is used for Open Food Facts, for the member's
 * own foods (OP-31) and for the saved item, so a second scan of the same
 * packet always finds the first.
 *
 * UPC-A ON ANDROID. iOS's camera reads a UPC-A symbol as EAN-13 (13 digits
 * with a leading 0). ML Kit reports it as `upc_a` with its own 12 digits, so
 * those become '0' + code here: the code a member saves on Android is the
 * one the same packet gets on iOS, and either phone finds the other's food.
 * A `upc_e` that ML Kit already expanded to 12 digits is taken the same way.
 *
 * EAN-8 is used as read: it is its own code, not a compressed one.
 */

/** How the digits were obtained. */
export type BarcodeSymbology =
  | 'ean13'
  | 'ean8'
  | 'upce'
  /** Android (ML Kit) only: iOS reads these as EAN-13. */
  | 'upca'
  /** Typed by hand in the "Type the number" sheet. */
  | 'typed';

/** The lengths `barcodeSchema` accepts. */
export const VALID_BARCODE_LENGTHS: ReadonlySet<number> = new Set([8, 12, 13, 14]);

/** The ML Kit formats the meal camera reads (expo-camera `BarcodeType`). */
export const MEAL_BARCODE_TYPES = ['ean13', 'ean8', 'upc_e', 'upc_a'] as const;

/** expo-camera's `type` for a read, as a symbology (null: not one the meal camera reads). */
export function symbologyOf(type: string): BarcodeSymbology | null {
  switch (type) {
    case 'ean13':
      return 'ean13';
    case 'ean8':
      return 'ean8';
    case 'upc_e':
      return 'upce';
    case 'upc_a':
      return 'upca';
    default:
      return null;
  }
}

function isAsciiDigit(character: string): boolean {
  return character >= '0' && character <= '9' && character.length === 1;
}

/** Digits only, no spaces. */
export function barcodeDigits(raw: string): string {
  let out = '';
  for (const character of raw) if (isAsciiDigit(character)) out += character;
  return out;
}

/**
 * True when the typed text is a barcode the server and Open Food Facts will
 * look up: only digits (spaces allowed while typing) and 8, 12, 13 or 14 of
 * them.
 */
export function isValidTypedBarcode(raw: string): boolean {
  const trimmed = raw.split(' ').join('');
  if (trimmed.length === 0) return false;
  for (const character of trimmed) if (!isAsciiDigit(character)) return false;
  return VALID_BARCODE_LENGTHS.has(trimmed.length);
}

/**
 * The GS1 check digit for a code without its check digit: from the right,
 * weights 3 and 1 alternately.
 */
export function checkDigitFor(body: string): string | null {
  if (body.length === 0) return null;
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[body.length - 1 - index]!;
    if (!isAsciiDigit(character)) return null;
    sum += Number(character) * (index % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

/** True when the last digit is the right check digit for the rest. */
export function hasValidCheckDigit(code: string): boolean {
  if (code.length < 2) return false;
  return checkDigitFor(code.slice(0, -1)) === code.slice(-1);
}

/**
 * UPC-E (6, 7 or 8 digits) to the 12-digit UPC-A.
 *
 * The rule by the last of the six middle digits (d6):
 * - 0, 1, 2: NS d1 d2 d6 0000 d3 d4 d5
 * - 3:       NS d1 d2 d3 00000 d4 d5
 * - 4:       NS d1 d2 d3 d4 00000 d5
 * - 5 to 9:  NS d1 d2 d3 d4 d5 0000 d6
 * followed by the check digit (the one read when present, else computed).
 */
export function expandUPCE(code: string): string | null {
  for (const character of code) if (!isAsciiDigit(character)) return null;
  let numberSystem: string;
  let middle: string;
  let checkDigit: string | null = null;
  switch (code.length) {
    case 6:
      numberSystem = '0';
      middle = code;
      break;
    case 7:
      numberSystem = code[0]!;
      middle = code.slice(1);
      break;
    case 8:
      numberSystem = code[0]!;
      middle = code.slice(1, 7);
      checkDigit = code[7]!;
      break;
    default:
      return null;
  }
  // UPC-E exists for number systems 0 and 1 only.
  if ((numberSystem !== '0' && numberSystem !== '1') || middle.length !== 6) return null;
  const d = middle.split('');
  let body: string;
  switch (d[5]) {
    case '0':
    case '1':
    case '2':
      body = `${d[0]}${d[1]}${d[5]}0000${d[2]}${d[3]}${d[4]}`;
      break;
    case '3':
      body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`;
      break;
    case '4':
      body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`;
      break;
    default:
      body = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${d[5]}`;
  }
  const eleven = numberSystem + body;
  const computed = eleven.length === 11 ? checkDigitFor(eleven) : null;
  if (computed === null) return null;
  return eleven + (checkDigit ?? computed);
}

/** The code to look up and save, or null when the value cannot be one. */
export function normaliseBarcode(raw: string, symbology: BarcodeSymbology): string | null {
  const code = barcodeDigits(raw);
  switch (symbology) {
    case 'upce': {
      // ML Kit may hand an expanded UPC-E over as its 12-digit UPC-A.
      if (code.length === 12) return `0${code}`;
      const upcA = expandUPCE(code);
      return upcA === null ? null : `0${upcA}`;
    }
    case 'upca':
      // The 12 digits of a UPC-A are the EAN-13 with its leading 0 dropped.
      if (code.length === 12) return `0${code}`;
      return VALID_BARCODE_LENGTHS.has(code.length) ? code : null;
    case 'ean8':
    case 'ean13':
      return VALID_BARCODE_LENGTHS.has(code.length) ? code : null;
    case 'typed':
      return isValidTypedBarcode(raw) ? code : null;
  }
}
