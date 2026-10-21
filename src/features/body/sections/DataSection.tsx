/**
 * 7. Your data (iOS `dataSection`): "Download my data" (a spinner in its
 * place while the export is read, and its error line under it), and, with
 * consent, "Delete all health data". Both stay for a lapsed member: consent,
 * not membership, is what the data is held on, so taking it out or deleting
 * it can never depend on paying.
 */
import { AccountRowButton, AccountSection } from '../../account';
import { useT } from '../../../i18n';

import { DELETE_BODY_KEY } from '../model';
import { CardBusyRow, CardErrorLine } from '../ui/parts';

export type DataSectionProps = {
  readonly hasConsent: boolean;
  readonly isExporting: boolean;
  readonly exportErrorKey: string | null;
  readonly isWithdrawing: boolean;
  readonly onExport: () => void;
  readonly onDeleteAll: () => void;
};

export default function DataSection({ hasConsent, isExporting, exportErrorKey, isWithdrawing, onExport, onDeleteAll }: DataSectionProps) {
  const { t } = useT();
  return (
    <AccountSection kicker={t('bodygoals.sec.data')} testID="bodygoals.data">
      {isExporting ? (
        <CardBusyRow title={t('bodygoals.export')} testID="bodygoals.export.busy" />
      ) : (
        <AccountRowButton title={t('bodygoals.export')} subtitle={t('bodygoals.export_sub')} onPress={onExport} testID="bodygoals.export" />
      )}
      {exportErrorKey ? <CardErrorLine text={t(exportErrorKey)} testID="bodygoals.export.error" /> : null}
      {hasConsent ? (
        <AccountRowButton
          title={t('bodygoals.delete_all')}
          destructive
          showsChevron={false}
          isEnabled={!isWithdrawing}
          onPress={onDeleteAll}
          accessibilityHint={t(DELETE_BODY_KEY)}
          testID="bodygoals.deleteAll"
        />
      ) : null}
    </AccountSection>
  );
}
