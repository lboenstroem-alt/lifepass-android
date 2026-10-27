// Must run before any screen's StyleSheet.create — installs the app-wide
// Inter Tight default font. Keep this as the first import.
import './src/theme/installFontDefaults';

// Defines the one WorkManager task (the monthly feedback's background
// refresh). A headless run evaluates only what this file imports, so the
// definition has to come from here, before registerRootComponent, and not
// from whatever screen happens to import it (src/background/task.ts says
// why). iOS registers its refresh handler at launch in AppDelegate the same
// way. src/background/__tests__/entry.test.ts holds the line.
import './src/background/task';

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
