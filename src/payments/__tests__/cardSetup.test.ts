/**
 * The card setup page's calls: the F8 port of iOS
 * ContractFixtureTests.testCardSetupReturnsToTheApp, and the verified pull
 * that decides what the page did.
 */
import { api, Reply } from '@test/server';

import { TransportError } from '../../api';
import { expectSentToMatchContract, stubApiClientPerTest } from '../../api/testing';
import { confirmCardSetup, startCardSetup } from '../cardSetup';

stubApiClientPerTest();

it('returns to the app, not to a website sign-in (testCardSetupReturnsToTheApp)', async () => {
  api.on('POST', '/billing/payment-methods/setup-session', Reply.ok({ url: 'https://pay.kling.is/setup/s_1' }));
  await expect(startCardSetup()).resolves.toBe('https://pay.kling.is/setup/s_1');
  const request = expectSentToMatchContract('POST', '/billing/payment-methods/setup-session');
  expect(request.body).toEqual({
    successUrl: 'lifepass://card-setup-success',
    cancelUrl: 'lifepass://card-setup-canceled',
  });
  expect(request.headers['idempotency-key']).toBeDefined();
});

it('a setup session with no page is a failure to open', async () => {
  api.on('POST', '/billing/payment-methods/setup-session', Reply.ok({}));
  await expect(startCardSetup()).rejects.toBeInstanceOf(TransportError);
});

it('the verified pull answers the card it found, or none', async () => {
  api.on('POST', '/billing/payment-methods/confirm', Reply.ok({ card: { brand: 'visa', last4: '4242' } }));
  await expect(confirmCardSetup()).resolves.toEqual({ brand: 'visa', last4: '4242' });
  const sent = expectSentToMatchContract('POST', '/billing/payment-methods/confirm');
  expect(sent.body).toBeUndefined();

  api.on('POST', '/billing/payment-methods/confirm', Reply.ok({ card: null }));
  await expect(confirmCardSetup()).resolves.toBeNull();

  api.on('POST', '/billing/payment-methods/confirm', Reply.ok({ card: { brand: null, last4: null } }));
  await expect(confirmCardSetup()).resolves.toEqual({ brand: null, last4: null });
});
