/**
 * The company-plan context the Account screen reads on every appearance:
 * a failure of any kind is "failed" (the dashboard fallback row), the newest
 * read wins, and a sign-out forgets it, dropping a read still on its way.
 */
import { api, Reply } from '@test/server';

import { stubApiClientPerTest } from '../../../api/testing';
import { runSignOutCleaners } from '../../../app/signOut';
import { loadCompanyContext, resetCompanyContext, useCompanyContext } from '../companyContext';

stubApiClientPerTest();

beforeEach(() => resetCompanyContext());

const invite = { pendingInvite: { companyName: 'Acme ehf.' }, pendingActivation: null };

it('starts with nothing read and nothing failed', () => {
  expect(useCompanyContext.getState()).toEqual({ context: null, failed: false });
});

it('keeps what the server answered', async () => {
  api.on('GET', '/company-plans/context', Reply.ok(invite));
  await loadCompanyContext();
  expect(useCompanyContext.getState()).toEqual({ context: invite, failed: false });
});

it.each([
  ['a 404 (a server without the route)', Reply.problem(404, 'not_found')],
  ['a 500', Reply.problem(500, 'internal_error')],
  ['no connection', Reply.fail()],
])('counts %s as failed, and forgets the old context', async (_name, reply) => {
  api.on('GET', '/company-plans/context', Reply.ok(invite));
  await loadCompanyContext();
  api.on('GET', '/company-plans/context', reply);
  await loadCompanyContext();
  expect(useCompanyContext.getState()).toEqual({ context: null, failed: true });
});

it('a read that answers after a failure clears it', async () => {
  api.on('GET', '/company-plans/context', Reply.fail());
  await loadCompanyContext();
  api.on('GET', '/company-plans/context', Reply.ok({}));
  await loadCompanyContext();
  expect(useCompanyContext.getState().failed).toBe(false);
});

it('the newest read wins over a slower older one', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  api.once('GET', '/company-plans/context', async () => {
    await gate;
    return Reply.ok(invite);
  });
  const older = loadCompanyContext();
  api.on('GET', '/company-plans/context', Reply.problem(404, 'not_found'));
  await loadCompanyContext();
  release();
  await older;
  expect(useCompanyContext.getState()).toEqual({ context: null, failed: true });
});

it('a sign-out forgets the context and drops a read still on its way', async () => {
  api.on('GET', '/company-plans/context', Reply.ok(invite));
  await loadCompanyContext();

  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  api.on('GET', '/company-plans/context', async () => {
    await gate;
    return Reply.ok(invite);
  });
  const inFlight = loadCompanyContext();
  await runSignOutCleaners({ memberId: 'member-a' });
  expect(useCompanyContext.getState()).toEqual({ context: null, failed: false });

  release();
  await inFlight;
  expect(useCompanyContext.getState()).toEqual({ context: null, failed: false });
});
