/**
 * A stand-in for a first-build screen in navigation tests: its name and its
 * route's params, nothing that reads the network. Kept apart from the shell
 * harness so a `jest.mock` factory can require it without loading the
 * navigators it is replacing a screen of.
 */
import { useRoute } from '@react-navigation/native';
import { Text, View } from 'react-native';

/** A legacy screen's stand-in: its name and its route's params. */
export function standInScreen(name: string) {
  function StandIn() {
    const route = useRoute();
    return (
      <View testID={`screen.${name}`}>
        <Text>{`${name} screen`}</Text>
        <Text testID={`params.${name}`}>{JSON.stringify(route.params ?? null)}</Text>
      </View>
    );
  }
  return { __esModule: true, default: StandIn };
}
