/**
 * The shared sheet (root route `SharedSheet`): a shared route opened where it
 * cannot be pushed, in its own stack over everything. iOS presents a
 * refusal's Account, Profile or venue page as a sheet with its own
 * NavigationStack over whatever refused (Plans, the class sheet), and the
 * member lands back there when it closes; this is that sheet.
 *
 * Every shared route is registered here too, so the page can go on as it
 * would in a tab (Account to Receipts, Profile to a venue). Back on its first
 * page closes the sheet. Opened by `openSharedRoute` / `navigateInCurrentTab`
 * (./sharedSheet.ts), never by name.
 */
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { registerSharedRoutes } from './sharedRoutes';
import type { SharedSheetProps, TabStackRoutes } from './types';

// The tab stacks' param list: the sheet registers only its shared routes, and
// its screens navigate with the same `AppNavigation` type as in a tab.
const Stack = createNativeStackNavigator<TabStackRoutes>();

export default function SharedSheetNavigator(_props: SharedSheetProps) {
  return <Stack.Navigator screenOptions={{ headerShown: false }}>{registerSharedRoutes(Stack)}</Stack.Navigator>;
}
