import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './App';
import { registerCarEngine } from './src/car/carEngine';
import { engine } from './src/player/PlaybackEngine';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

/** True while a `QuranCarEngine` task is already holding the process open. */
let carEngineTaskRunning = false;

// Started by CarEngineService when the car asks to play and no JS runtime
// exists (spec §4). Registers the car bridge and then lives as long as the
// engine has a surah; when it has been idle for ten minutes the task returns
// and Android may reclaim the process.
AppRegistry.registerHeadlessTask('QuranCarEngine', () => async () => {
  // Every instance registers (which re-announces the engine and flushes
  // whatever the car queued behind this boot)…
  registerCarEngine();
  // …but only the first keeps the keep-alive loop. A second service start
  // while the first task is still running would otherwise add a second loop
  // for the same one engine, doubling the timers for the life of the process.
  if (carEngineTaskRunning) return;
  carEngineTaskRunning = true;
  try {
    let idleSince = Date.now();
    for (;;) {
      await new Promise(r => setTimeout(r, 30_000));
      const s = engine.getState();
      if (s.isPlaying || s.isLoading) idleSince = Date.now();
      else if (Date.now() - idleSince > 10 * 60_000) return;
    }
  } finally {
    carEngineTaskRunning = false;
  }
});
