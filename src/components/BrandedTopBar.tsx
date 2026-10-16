// The legacy screens' top bar, now drawn by the UI kit's TopBar (with the
// 36 pt buttons and TalkBack labels iOS has). Its trailing button still
// opens Account, as it always has on Android, and says so ("Open account"),
// so the label never promises a place it does not go. New screens use
// `TopBar` from src/components/ui with their own destination (Profile on
// Explore, Scan and Saved, plan 3.0.2); this wrapper goes when the last
// legacy screen does.
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';

import TopBar from './ui/TopBar';

type Props = {
  title: string;
  subtitle?: string;
  /** A person button everywhere, or a settings gear on the Library screen (iOS BrandedTopBar). */
  trailing?: 'person' | 'settings';
};

export default function BrandedTopBar({ title, subtitle, trailing = 'person' }: Props) {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const openAccount = () => navigation.navigate('Account');
  return (
    <TopBar
      title={title}
      subtitle={subtitle}
      trailing={trailing === 'settings' ? { kind: 'gear', onPress: openAccount } : { kind: 'person', onPress: openAccount }}
    />
  );
}
