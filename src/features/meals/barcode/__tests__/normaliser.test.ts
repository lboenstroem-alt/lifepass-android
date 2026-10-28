/**
 * UPC-E expansion and the lengths a barcode may have (iOS
 * BarcodeNormaliserTests, ios-ux.md 12.5, api-contract.md 5.1, F11), plus
 * the Android-only UPC-A rule: ML Kit reads a UPC-A symbol as 12 digits,
 * iOS reads the same symbol as EAN-13, and both must save the same code.
 */
import {
  barcodeDigits,
  checkDigitFor,
  expandUPCE,
  hasValidCheckDigit,
  isValidTypedBarcode,
  normaliseBarcode,
  symbologyOf,
} from '../normaliser';
import { BarcodeReadLock, BARCODE_CONFIRM_MS } from '../readLock';

describe('BarcodeNormaliser', () => {
  // The four branches of the rule, by the last of the six middle digits.
  it('expands the published UPC-E examples', () => {
    // d6 in 0...2: NS d1 d2 d6 0000 d3 d4 d5
    expect(expandUPCE('04252614')).toBe('042100005264');
    // d6 == 3: NS d1 d2 d3 00000 d4 d5
    expect(expandUPCE('01234531')).toBe('012300000451');
    // d6 == 4: NS d1 d2 d3 d4 00000 d5
    expect(expandUPCE('01234543')).toBe('012340000053');
    // d6 in 5...9: NS d1 d2 d3 d4 d5 0000 d6
    expect(expandUPCE('01234565')).toBe('012345000065');
  });

  it('gives the expanded code a valid check digit', () => {
    for (const code of ['04252614', '01234565', '01234543', '01234531']) {
      const expanded = expandUPCE(code);
      expect(expanded).not.toBeNull();
      expect(hasValidCheckDigit(expanded ?? '')).toBe(true);
    }
  });

  // A reader that drops the number system or the check digit is completed before expanding.
  it('completes six and seven digit reads', () => {
    expect(expandUPCE('425261')).toBe('042100005264');
    expect(expandUPCE('0425261')).toBe('042100005264');
  });

  it('turns a UPC-E read into EAN-13 with a leading zero', () => {
    expect(normaliseBarcode('04252614', 'upce')).toBe('0042100005264');
    expect(normaliseBarcode('04252614', 'upce')).toHaveLength(13);
  });

  // UPC-E exists for number systems 0 and 1 only.
  it('refuses other number systems', () => {
    expect(expandUPCE('24252614')).toBeNull();
    expect(expandUPCE('0425A614')).toBeNull();
  });

  // EAN-8 is its own code, not a compressed one.
  it('uses EAN-8 and EAN-13 as read', () => {
    expect(normaliseBarcode('96385074', 'ean8')).toBe('96385074');
    expect(normaliseBarcode('5690527282050', 'ean13')).toBe('5690527282050');
  });

  it('wants 8, 12, 13 or 14 typed digits', () => {
    for (const valid of ['96385074', '042100005264', '5690527282050', '05690527282050', '5690 5272 8205 0']) {
      expect(isValidTypedBarcode(valid)).toBe(true);
    }
    for (const invalid of ['', '1234567', '123456789', '12345678901', '123456789012345', '56905272820a0', '-5690527282050']) {
      expect(isValidTypedBarcode(invalid)).toBe(false);
    }
    expect(normaliseBarcode('5690 5272 8205 0', 'typed')).toBe('5690527282050');
    expect(normaliseBarcode('12345', 'typed')).toBeNull();
  });

  it('computes check digits', () => {
    expect(checkDigitFor('569052728205')).toBe('5');
    expect(hasValidCheckDigit('96385074')).toBe(true);
    expect(hasValidCheckDigit('96385075')).toBe(false);
  });

  it('keeps digits only', () => {
    expect(barcodeDigits(' 5690-5272 8205 0 ')).toBe('5690527282050');
    // Non-ASCII digits are not barcode digits.
    expect(barcodeDigits('٥٦٩٠')).toBe('');
  });
});

describe('ML Kit reads on Android', () => {
  // The same packet, read on iOS as EAN-13 and on Android as UPC-A, is ONE code.
  it('normalises a 12-digit UPC-A read to the 13 digits iOS saves', () => {
    const iosRead = normaliseBarcode('0042100005264', 'ean13');
    const androidRead = normaliseBarcode('042100005264', 'upca');
    expect(androidRead).toBe('0042100005264');
    expect(androidRead).toBe(iosRead);
    expect(hasValidCheckDigit(androidRead ?? '')).toBe(true);
  });

  it('takes a UPC-E that ML Kit already expanded the same way', () => {
    expect(normaliseBarcode('042100005264', 'upce')).toBe(normaliseBarcode('04252614', 'upce'));
  });

  it('maps the four formats the meal camera reads, and nothing else', () => {
    expect(symbologyOf('ean13')).toBe('ean13');
    expect(symbologyOf('ean8')).toBe('ean8');
    expect(symbologyOf('upc_e')).toBe('upce');
    expect(symbologyOf('upc_a')).toBe('upca');
    expect(symbologyOf('qr')).toBeNull();
    expect(symbologyOf('code128')).toBeNull();
  });
});

describe('the read lock', () => {
  it('needs the same value in two frames within a second', () => {
    const lock = new BarcodeReadLock();
    expect(lock.frame('ean13', '5690527282050', 0)).toBeNull();
    expect(lock.frame('ean13', '5690527282050', BARCODE_CONFIRM_MS + 1)).toBeNull();
    expect(lock.frame('ean13', '5690527282050', BARCODE_CONFIRM_MS + 500)).toEqual({ value: '5690527282050', symbology: 'ean13' });
    expect(lock.isLocked).toBe(true);
  });

  it('starts over on a different value (a smudge half-decoded as the phone moves)', () => {
    const lock = new BarcodeReadLock();
    lock.frame('ean13', '5690527282050', 0);
    expect(lock.frame('ean13', '5690527282051', 100)).toBeNull();
    expect(lock.frame('ean13', '5690527282051', 200)).not.toBeNull();
  });

  it('reads nothing while locked, and again after resume', () => {
    const lock = new BarcodeReadLock();
    lock.frame('ean8', '96385074', 0);
    lock.frame('ean8', '96385074', 10);
    expect(lock.frame('ean8', '96385074', 20)).toBeNull();
    expect(lock.frame('ean8', '96385074', 30)).toBeNull();
    lock.resume();
    expect(lock.frame('ean8', '96385074', 40)).toBeNull();
    expect(lock.frame('ean8', '96385074', 50)).toEqual({ value: '96385074', symbology: 'ean8' });
  });

  it('ignores a QR code in view', () => {
    const lock = new BarcodeReadLock();
    lock.frame('qr', 'https://www.lifepass.is/scan?v=1', 0);
    expect(lock.frame('qr', 'https://www.lifepass.is/scan?v=1', 10)).toBeNull();
    expect(lock.isLocked).toBe(false);
  });
});
