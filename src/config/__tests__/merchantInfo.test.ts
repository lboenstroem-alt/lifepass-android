/**
 * The legal versions this build stamps on every checkout and co-pay
 * activation: the port of iOS MerchantInfoTests.
 *
 * Privacy 2026-09-v12 adds the monthly feedback (v11 was served before that
 * text merged, so it is the next version). The health CONSENT text is
 * deliberately untouched: a new consent version would cancel every member's
 * consent at once.
 */
import { lookup } from '../../i18n';
import { MerchantInfo, webCheckoutURL } from '../merchantInfo';

describe('MerchantInfo', () => {
  it('the privacy policy version is the monthly feedback edition', () => {
    expect(MerchantInfo.privacyVersion).toBe('2026-09-v12');
  });

  it('the terms are unchanged', () => {
    expect(MerchantInfo.termsVersion).toBe('2026-09-v6');
  });

  it('the consent text still promises what the target weight relies on', () => {
    expect(lookup('healthconsent.store.goals', 'en')).toBe('Your goals and plan answers');
    expect(lookup('healthconsent.ai.never_numbers', 'en')).toBe(
      'Never your exact weight, height or age, only ranges such as 25 to 34',
    );
  });

  it('names the merchant as the registry and the receipts do', () => {
    expect(MerchantInfo.legalName).toBe('Sporta ehf.');
    expect(MerchantInfo.email).toBe('Contact@sport-a.com');
    expect(MerchantInfo.fullAddress).toBe(`${MerchantInfo.streetAddress}, ${MerchantInfo.cityLine}`);
    expect(MerchantInfo.termsURL).toBe('https://lifepass.is/terms');
    expect(MerchantInfo.privacyURL).toBe('https://lifepass.is/privacy');
    expect(MerchantInfo.accountDeletionURL).toBe('https://www.lifepass.is/profile');
    expect(MerchantInfo.currency).toBe('ISK');
    expect(MerchantInfo.inAppKlingCheckout).toBe(true);
  });

  it('the web checkout carries ?promo only when there is a code', () => {
    expect(webCheckoutURL('plan-plus')).toBe('https://www.lifepass.is/plans?completePurchase=plan-plus');
    expect(webCheckoutURL('plan-plus', '')).toBe('https://www.lifepass.is/plans?completePurchase=plan-plus');
    expect(webCheckoutURL('plan-plus', null)).toBe('https://www.lifepass.is/plans?completePurchase=plan-plus');
    expect(webCheckoutURL('pass-explorer', 'PARTNER10')).toBe(
      'https://www.lifepass.is/plans?completePurchase=pass-explorer&promo=PARTNER10',
    );
  });
});
