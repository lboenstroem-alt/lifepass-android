/**
 * `GET /referrals/me`: read strictly (iOS `ReferralInfo: Decodable`), checked
 * against the contract, and the link the Account row may share.
 */
import { api, Reply } from '@test/server';
import { sampleResponse } from '@test/contract';

import { DecodingError } from '../errors';
import { decodeReferral, fetchReferral, shareableReferralLink } from '../referrals';
import { expectSentToMatchContract, replyFromContract, stubApiClientPerTest } from '../testing';

stubApiClientPerTest();

const answer = {
  code: 'ANNA7K',
  link: 'https://www.lifepass.is/r/ANNA7K',
  referredCount: 3,
  rewardsEarned: 1,
};

describe('decodeReferral', () => {
  it('reads the four members', () => {
    expect(decodeReferral(answer)).toEqual(answer);
  });

  it.each([
    ['code', { ...answer, code: undefined }],
    ['link', { ...answer, link: 42 }],
    ['referredCount', { ...answer, referredCount: '3' }],
    ['rewardsEarned', { ...answer, rewardsEarned: 1.5 }],
    ['rewardsEarned', { ...answer, rewardsEarned: null }],
  ])('refuses a missing or mistyped %s, as the Swift decoder does', (_member, data) => {
    expect(() => decodeReferral(data)).toThrow();
  });

  it('refuses something that is not an object', () => {
    expect(() => decodeReferral(null)).toThrow();
    expect(() => decodeReferral([answer])).toThrow();
  });
});

describe('fetchReferral', () => {
  it('sends the contract request and reads the contract answer', async () => {
    api.on('GET', '/referrals/me', replyFromContract('GET', '/referrals/me', 200, 'full'));
    const referral = await fetchReferral();
    expectSentToMatchContract('GET', '/referrals/me');
    expect(referral).toEqual(decodeReferral(sampleResponse('GET', '/referrals/me', 200, 'full')));
  });

  it('turns an unreadable answer into a decoding error', async () => {
    api.on('GET', '/referrals/me', Reply.ok({ code: 'X' }));
    await expect(fetchReferral()).rejects.toBeInstanceOf(DecodingError);
  });

  it('passes a refusal on (the Account row then stays hidden)', async () => {
    api.on('GET', '/referrals/me', Reply.problem(404, 'not_found'));
    await expect(fetchReferral()).rejects.toThrow();
  });
});

describe('shareableReferralLink', () => {
  it('shares a web link a friend can open', () => {
    expect(shareableReferralLink(answer)).toBe('https://www.lifepass.is/r/ANNA7K');
    expect(shareableReferralLink({ link: '  https://lifepass.is/r/X  ' })).toBe('https://lifepass.is/r/X');
  });

  it('has nothing to share without a real URL', () => {
    expect(shareableReferralLink(null)).toBeNull();
    expect(shareableReferralLink({ link: '' })).toBeNull();
    expect(shareableReferralLink({ link: 'ANNA7K' })).toBeNull();
    expect(shareableReferralLink({ link: 'https://' })).toBeNull();
    expect(shareableReferralLink({ link: 'javascript:alert(1)' })).toBeNull();
  });
});
