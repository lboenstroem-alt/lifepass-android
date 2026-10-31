// The Coach, as other features reach it (plan 3.0: another feature only
// through this index or a published slot).
//
// Added by ACCT-4 (a barrel line, BUILD_RULES' exception) so an account
// deletion can forget the saved chats the way iOS does by name
// (`AccountDeletionSheet.finishDeletionIfNeeded` calls
// `CoachViewModel.forgetSavedSessions()` right after the health wipe).
// COACH-1 owns the Coach and may add to this file.
//
// NOTHING LOADS AT IMPORT. ./register.ts registers the Coach's sign-in and
// sign-out hooks as it loads, and must load through
// src/app/registrations.ts, after every module has finished loading (that
// file says why). So this index requires it at call time, when it has long
// been loaded, and importing the index costs nothing.
/* eslint-disable @typescript-eslint/no-require-imports -- loaded at call time (see above) */
import type * as CoachRegister from './register';

/**
 * Sign-out and an account deletion: the saved chats and their owner go, on
 * disk and in any Coach screen still holding them (iOS `forgetSavedSessions`).
 */
export function forgetSavedCoachSessions(): Promise<void> {
  const { forgetSavedCoachSessions: forget } = require('./register') as typeof CoachRegister;
  return forget();
}
