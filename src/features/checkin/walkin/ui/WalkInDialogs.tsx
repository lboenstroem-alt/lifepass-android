/* eslint lifepass/no-literal-copy: "error" */
/**
 * The walk-in's alerts (iOS `CheckInView`'s `.alert`s), one at a time:
 *
 * - CHARGE CONSENT, before the first POST: the reason-aware title, message
 *   and button (./consentCopy). Cancel, back, and a tap outside all decline,
 *   which sends nothing and drops the attempt's key.
 * - "Check in at <venue>?" for an attempt that came by link: what covers the
 *   visit, then the link's note. Nothing is recorded without this tap.
 * - The pay rail's outcome: "Confirming your payment" with Check again (the
 *   same key) and Cancel; every other outcome with OK.
 * - The safety net "Add a payment method" (Go to profile on the web).
 * - A refusal, in the member's words, with its next step when the Scan tab
 *   can take it (iOS `offersRefusalStep`): My bookings and Refresh open
 *   Profile on Bookings, Try again scans the same venue again, the shared
 *   steps go through the refusal-step presenter. Never the server's words.
 */
import { Linking } from 'react-native';

import { ctaLabelKey, REFUSAL_WEB_PROFILE_URL, type RefusalCta } from '../../../../api';
import { Dialog, type DialogButton } from '../../../../components/ui';
import { coverageLine } from '../../../../copy/passCopy';
import { useT } from '../../../../i18n';
import { presentsRefusalStep, useRefusalStep } from '../../../../navigation/refusalSteps';
import { payOutcomeMessage, payOutcomeTitle } from '../../../../payments';
import { walkInConsentButtonLabel, walkInConsentMessage, walkInConsentTitle } from '../consentCopy';
import { consentContext, type WalkInState } from '../store';
import { useWalkIn, walkInActions } from '../useWalkIn';

type Showing = 'consent' | 'link' | 'payOutcome' | 'noCard' | 'error' | null;

/** Which alert is up: one at a time, the money question first. */
export function currentDialog(state: WalkInState): Showing {
  if (state.showSuccess) return null;
  if (state.showChargeConsent) return 'consent';
  if (state.showLinkConfirm) return 'link';
  if (state.payOutcome) return 'payOutcome';
  if (state.needsPaymentMethod) return 'noCard';
  if (state.error !== null) return 'error';
  return null;
}

/**
 * The steps the Scan tab offers on a refusal (iOS `offersRefusalStep`): its
 * own (bookings; Try again when it knows the venue) and the shared ones.
 */
export function scanOffersRefusalStep(cta: RefusalCta, venueId: string | null, venueSlug: string | null): boolean {
  switch (cta) {
    case 'myBookings':
    case 'refreshBookings':
      return true;
    case 'tryAgain':
      return venueId !== null;
    case 'openScanner':
    case 'chooseAnotherTime':
    case 'editGuests':
      return false;
    default:
      return presentsRefusalStep(cta, venueSlug);
  }
}

const NOOP = () => undefined;

export default function WalkInDialogs() {
  const { t, language } = useT();
  const showing = useWalkIn(currentDialog);
  const state = useWalkIn((s) => s);
  const refusalStep = useRefusalStep({
    venueSlug: state.refusalVenueSlug,
    local: (cta) => {
      switch (cta) {
        case 'tryAgain':
          void walkInActions().retryAfterRefusal();
          return true;
        case 'openScanner':
          return true; // already here
        default:
          return false;
      }
    },
  });

  let title = '';
  let message: string | undefined;
  let buttons: DialogButton[] = [];
  switch (showing) {
    case 'consent': {
      const context = consentContext(state);
      title = walkInConsentTitle(context, language);
      message = walkInConsentMessage(context, language);
      buttons = [
        { label: walkInConsentButtonLabel(context, language), onPress: () => void walkInActions().acceptWalkInCharge(), testID: 'walkin.consent.accept' },
        { label: t('common.cancel'), role: 'cancel', onPress: () => walkInActions().declineWalkInCharge(), testID: 'walkin.consent.cancel' },
      ];
      break;
    }
    case 'link': {
      const venueName = state.preview?.venue.name;
      title = venueName ? t('checkin.link.confirm_title', { venue: venueName }) : t('checkin.link.confirm_title_plain');
      const note = t('checkin.link.confirm_body');
      const line = coverageLine(state.preview?.coveredBy, language);
      message = line ? `${line}\n\n${note}` : note;
      buttons = [
        { label: t('checkin.link.confirm_cta'), onPress: () => void walkInActions().confirmLinkedWalkIn(), testID: 'walkin.link.confirm' },
        { label: t('common.cancel'), role: 'cancel', onPress: () => walkInActions().declineLinkedWalkIn(), testID: 'walkin.link.cancel' },
      ];
      break;
    }
    case 'payOutcome': {
      const outcome = state.payOutcome!;
      title = payOutcomeTitle(outcome, language);
      message = payOutcomeMessage(outcome, 'walkIn', language);
      buttons =
        outcome.kind === 'processing'
          ? [
              { label: t('booking.pay.check_again'), onPress: () => void walkInActions().checkPaymentAgain(), testID: 'walkin.pay.checkAgain' },
              { label: t('common.cancel'), role: 'cancel', onPress: () => walkInActions().dismissPayOutcome(), testID: 'walkin.pay.cancel' },
            ]
          : [{ label: t('common.ok'), onPress: () => walkInActions().dismissPayOutcome(), testID: 'walkin.pay.ok' }];
      break;
    }
    case 'noCard':
      title = t('checkin.err.no_card_title');
      message = t('checkin.err.no_card_body');
      buttons = [
        {
          label: t('checkin.err.no_card_cta'),
          onPress: () => {
            walkInActions().dismissNeedsPaymentMethod();
            void Linking.openURL(REFUSAL_WEB_PROFILE_URL).catch(() => undefined);
          },
        },
        { label: t('common.cancel'), role: 'cancel', onPress: () => walkInActions().dismissNeedsPaymentMethod() },
      ];
      break;
    case 'error': {
      title = t('common.error_title');
      message = state.error ?? t('common.error_body');
      const cta = state.errorCTA;
      buttons = [];
      if (cta && scanOffersRefusalStep(cta, state.refusalVenueId, state.refusalVenueSlug)) {
        buttons.push({
          label: t(ctaLabelKey(cta)),
          onPress: () => {
            walkInActions().dismissError();
            refusalStep.take(cta);
          },
          testID: 'walkin.error.step',
        });
      }
      buttons.push({ label: t('common.ok'), role: 'cancel', onPress: () => walkInActions().dismissError(), testID: 'walkin.error.ok' });
      break;
    }
    case null:
      break;
  }

  return (
    <Dialog
      visible={showing !== null}
      onClose={NOOP}
      title={title}
      message={message}
      buttons={buttons}
      testID={showing ? `walkin.dialog.${showing}` : undefined}
    />
  );
}
