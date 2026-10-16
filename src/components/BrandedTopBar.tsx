// The legacy screens' top bar, now drawn by the UI kit's TopBar (with the
// 36 pt buttons and TalkBack labels iOS has). New screens use `TopBar` from
// src/components/ui with their own destination (plan 3.0.2); this wrapper
// goes when the last legacy screen does.
//
// THE PERSON BUTTON opens Account by default, and says so ("Open account"),
// so the label never promises a place it does not go. It finds Account from
// wherever it is drawn: a stack that registers Account pushes it there; a
// screen that sits directly in the tab bar (the legacy Check-in tab) goes to
// the Account of a tab that hosts one, above that tab's own first screen. A
// caller that wants iOS's Scan behaviour passes `onPersonPress` (open
// Profile), `personLabelKey: 'a11y.open_profile'` and `personDisabled` while
// the camera is live (iOS BrandedTopBar `personLabelKey`, `isPersonDisabled`).
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';

import TopBar from './ui/TopBar';

type Props = {
  title: string;
  subtitle?: string;
  /** A person button everywhere, or a settings gear on the Library screen (iOS BrandedTopBar). */
  trailing?: 'person' | 'settings';
  /** Where the person button goes; default Account. */
  onPersonPress?: () => void;
  /** The person button's label; `a11y.open_profile` where it opens Profile. Default `a11y.open_account`. */
  personLabelKey?: string;
  /** Disabled without being removed (Scan while the camera is live). */
  personDisabled?: boolean;
};

/**
 * Tabs whose stack registers Account, tried in order when no navigator above
 * the calling screen does: the legacy Library tab, then Home (which every
 * tab layout has).
 */
export const ACCOUNT_HOST_TABS = ['Bookings', 'Home'] as const;

/** Opens Account from any screen, whichever navigator it sits in. */
export function openAccount(navigation: NavigationProp<ParamListBase>): void {
  // A navigator above this screen registers Account: navigate bubbles up to it.
  for (let nav: NavigationProp<ParamListBase> | undefined = navigation; nav; nav = nav.getParent()) {
    if (nav.getState()?.routeNames.includes('Account')) {
      navigation.navigate('Account');
      return;
    }
  }
  // None does (a screen directly in the tab bar): through a tab that hosts it,
  // keeping that tab's first screen underneath so back has somewhere to go.
  for (let nav: NavigationProp<ParamListBase> | undefined = navigation; nav; nav = nav.getParent()) {
    const names = nav.getState()?.routeNames ?? [];
    const host = ACCOUNT_HOST_TABS.find((name) => names.includes(name));
    if (host) {
      nav.navigate(host, { screen: 'Account', initial: false });
      return;
    }
  }
}

export default function BrandedTopBar({ title, subtitle, trailing = 'person', onPersonPress, personLabelKey, personDisabled }: Props) {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const toAccount = () => openAccount(navigation);
  return (
    <TopBar
      title={title}
      subtitle={subtitle}
      trailing={
        trailing === 'settings'
          ? { kind: 'gear', onPress: toAccount }
          : { kind: 'person', onPress: onPersonPress ?? toAccount, labelKey: personLabelKey, disabled: personDisabled }
      }
    />
  );
}
