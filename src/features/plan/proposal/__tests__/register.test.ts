/**
 * What PLAN-4 holds in memory goes at sign-out and with a health wipe: the
 * workouts the history list read, and the proposal card's reminder choice
 * (and, at sign-out, every card's outcome listener).
 */
import { loadRegistrations, registeredHookIds, runSignOutCleaners } from '../../../../app/signOut';
import { decodeSessionHistoryItem } from '../../../../health';
import { registeredHealthWipeHookIds, runHealthWipeHooks } from '../../../../health/wipe';
import { historyItem, rememberHistoryItems, resetHistoryItemsForTests, retainHistoryItems } from '../../history/historyCache';
import { forgetReminderDraft, noteReminderDraft, onProposalOutcome, reminderDraft, reportProposalOutcome, resetProposalBridges } from '../proposalActions';

const workout = decodeSessionHistoryItem({ id: 'h-1', date: '2026-10-15', title: 'Legs' }, 'item');

beforeEach(() => {
  resetHistoryItemsForTests();
  resetProposalBridges();
});

it('registers its cleaner and its wipe hook when the register files load', () => {
  loadRegistrations();
  expect(registeredHookIds().signOut).toEqual(expect.arrayContaining(['plan.programs']));
  expect(registeredHealthWipeHookIds()).toEqual(expect.arrayContaining(['plan.programs']));
});

it('a sign-out forgets the history workouts, the reminder choice and the listeners', async () => {
  loadRegistrations();
  const release = retainHistoryItems();
  rememberHistoryItems([workout]);
  noteReminderDraft('p-1', { remindersOn: false, minutes: 480 }, {});
  const heard = jest.fn();
  onProposalOutcome('p-1', heard);

  await runSignOutCleaners({ memberId: 'member-1' });

  expect(historyItem('h-1')).toBeNull();
  expect(reminderDraft('p-1')).toBeNull();
  reportProposalOutcome('p-1', 'started');
  expect(heard).not.toHaveBeenCalled();
  release();
});

it('a health wipe forgets the workouts and the reminder choice', async () => {
  loadRegistrations();
  const release = retainHistoryItems();
  rememberHistoryItems([workout]);
  noteReminderDraft('p-1', { remindersOn: true, minutes: 420 }, {});

  await runHealthWipeHooks({ profileId: 'member-1', reason: 'withdrawn' });

  expect(historyItem('h-1')).toBeNull();
  expect(reminderDraft('p-1')).toBeNull();
  release();
});

it("a card's reminder choice goes with that card, never with another's", () => {
  const coachCard = {};
  const planCard = {};
  noteReminderDraft('p-1', { remindersOn: false, minutes: 480 }, coachCard);
  noteReminderDraft('p-1', { remindersOn: true, minutes: 450 }, planCard);
  forgetReminderDraft('p-1', coachCard);
  expect(reminderDraft('p-1')).toEqual({ remindersOn: true, minutes: 450 });
  forgetReminderDraft('p-1', planCard);
  expect(reminderDraft('p-1')).toBeNull();
});

it('the history list holds its workouts only while one is mounted', () => {
  rememberHistoryItems([workout]);
  expect(historyItem('h-1')).toBeNull();
  const release = retainHistoryItems();
  rememberHistoryItems([workout]);
  expect(historyItem('h-1')).not.toBeNull();
  release();
  expect(historyItem('h-1')).toBeNull();
});
