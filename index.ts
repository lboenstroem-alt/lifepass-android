// Must run before any screen's StyleSheet.create — installs the app-wide
// Inter Tight default font. Keep this as the first import.
import './src/theme/installFontDefaults';
// The background task's definition, before the app itself loads:
// WorkManager starts the bundle with no screen and runs only what the
// entry's imports evaluate (src/background/task.ts says why).
import './src/background/task';

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
