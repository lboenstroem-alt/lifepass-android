/**
 * The pending state's words (iOS `AccountDeletionSheet` `erasureDate` and
 * `obligationLines`), and iOS AccountDeletionLinkTests: the web link and
 * the row subtitle an app reviewer reads.
 */
import type { AccountDeletionState } from '../../../../api/accountDeletion';
import { MerchantInfo } from '../../../../config/merchantInfo';
import { lookup, translate } from '../../../../i18n';
import { erasureDateText, obligationLines, pendingSentence } from '../obligations';

function pendingWith(obligations: AccountDeletionState['obligations'], erasure = '2026-11-10T00:00:00.000Z'): AccountDeletionState {
  return {
    accountStatus: 'deletion_pending',
    deletionRequestedAt: new Date('2026-10-17T09:00:00Z'),
    erasureScheduledAt: new Date(erasure),
    obligations,
  };
}

describe('AccountDeletionLinkTests', () => {
  it('the web link opens the account page, not the sign-in form', () => {
    const url = new URL(MerchantInfo.accountDeletionURL);
    expect(url.host).toBe('www.lifepass.is');
    expect(url.pathname).toBe('/profile');
    expect(url.pathname.startsWith('/auth')).toBe(false);
  });

  it('the row subtitle describes the in-app deletion, in both languages', () => {
    for (const language of ['en', 'is'] as const) {
      const subtitle = lookup('account.delete_sub', language);
      expect(subtitle).not.toBe('account.delete_sub');
      expect(subtitle).not.toBe(lookup('account.delete_gdpr', language));
      for (const word of ['website', 'web', 'vefnum', 'Log in', 'Skráðu']) {
        expect(subtitle.includes(word)).toBe(false);
      }
    }
  });
});

describe('the erasure date', () => {
  it('is a long day in the account language, on the server calendar', () => {
    const state = pendingWith([]);
    expect(erasureDateText(state, 'en')).toBe('10 November');
    expect(erasureDateText(state, 'is')).toBe('10. nóvember');
    expect(pendingSentence(state, 'en')).toBe('Your account will be erased on 10 November.');
    expect(pendingSentence(state, 'is')).toBe('Aðganginum verður eytt þann 10. nóvember.');
  });

  it('reads Reykjavík time (UTC): late evening is still that day', () => {
    expect(erasureDateText(pendingWith([], '2026-11-10T23:30:00.000Z'), 'en')).toBe('10 November');
  });

  it('is empty when the server named no date, as iOS fills the sentence with ""', () => {
    const state: AccountDeletionState = { ...pendingWith([]), erasureScheduledAt: null };
    expect(erasureDateText(state, 'en')).toBe('');
    expect(erasureDateText(null, 'en')).toBe('');
  });
});

describe('obligation lines', () => {
  it('one line per known kind, in the server order', () => {
    const state = pendingWith([
      { kind: 'subscription', count: 1, clearsAt: null },
      { kind: 'future_booking', count: 2, clearsAt: null },
      { kind: 'pending_charge', count: 1, clearsAt: null },
      { kind: 'pending_order', count: 1, clearsAt: null },
      { kind: 'checkout_session', count: 1, clearsAt: null },
    ]);
    expect(obligationLines(state, 'en')).toEqual([
      translate('deletion.obligation.subscription', 'en'),
      '2 upcoming bookings are cancelled',
      translate('deletion.obligation.pending_charge', 'en'),
      translate('deletion.obligation.pending_order', 'en'),
      translate('deletion.obligation.checkout_session', 'en'),
    ]);
  });

  it('an unknown kind, or none at all, draws no line: never a machine word', () => {
    const state = pendingWith([
      { kind: 'gift_card', count: 1, clearsAt: null },
      { kind: null, count: 1, clearsAt: null },
      { kind: 'subscription', count: 1, clearsAt: null },
    ]);
    const lines = obligationLines(state, 'en');
    expect(lines).toEqual([translate('deletion.obligation.subscription', 'en')]);
    expect(lines.join(' ')).not.toMatch(/gift_card|future_booking/);
  });

  it('future bookings take the plural key: English one and many', () => {
    const line = (count: number | null) => obligationLines(pendingWith([{ kind: 'future_booking', count, clearsAt: null }]), 'en')[0];
    expect(line(1)).toBe('1 upcoming booking is cancelled');
    expect(line(2)).toBe('2 upcoming bookings are cancelled');
    expect(line(21)).toBe('21 upcoming bookings are cancelled');
  });

  it('future bookings take the Icelandic rule: 21 is singular, 11 is not', () => {
    const line = (count: number) => obligationLines(pendingWith([{ kind: 'future_booking', count, clearsAt: null }]), 'is')[0];
    expect(line(1)).toBe('1 bókun fram í tímann er aflýst');
    expect(line(21)).toBe('21 bókun fram í tímann er aflýst');
    expect(line(11)).toBe('11 bókunum fram í tímann er aflýst');
    expect(line(3)).toBe('3 bókunum fram í tímann er aflýst');
  });

  it('a missing or zero count reads as one (iOS max(count ?? 1, 1))', () => {
    const line = (count: number | null) => obligationLines(pendingWith([{ kind: 'future_booking', count, clearsAt: null }]), 'en')[0];
    expect(line(null)).toBe('1 upcoming booking is cancelled');
    expect(line(0)).toBe('1 upcoming booking is cancelled');
  });

  it('the count is written in the account language’s digits', () => {
    const state = pendingWith([{ kind: 'future_booking', count: 1200, clearsAt: null }]);
    expect(obligationLines(state, 'en')[0]).toBe('1,200 upcoming bookings are cancelled');
    expect(obligationLines(state, 'is')[0]).toBe('1.200 bókunum fram í tímann er aflýst');
  });

  it('no obligations, no lines', () => {
    expect(obligationLines(pendingWith([]), 'en')).toEqual([]);
    expect(obligationLines(pendingWith(null), 'en')).toEqual([]);
  });
});
