import { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { setAudioModeAsync } from 'expo-audio';
import { SurahListScreen } from './src/screens/SurahListScreen';
import { ReaderScreen, type Script } from './src/screens/ReaderScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { PlayerProvider, usePlayer } from './src/player/PlayerProvider';
import { PlayerBar } from './src/player/PlayerBar';
import { useQuranFonts } from './src/reader/fonts';
import { ThemeProvider, useTheme } from './src/theme/theme';
import { refreshFromDisk } from './src/offline/downloadManager';

// The splash is hidden by us, not by the library's "first frame" heuristic:
// on a Galaxy A51 the auto-hide never fired and the splash covered a fully
// working app indefinitely, while the emulator hid it fine. Holding it until
// the fonts are in also means the first frame the user sees is the real
// list, not an unstyled flash — see the effect in `AppShell`.
SplashScreen.preventAutoHideAsync().catch(() => { /* already hidden or never shown */ });
SplashScreen.setOptions({ fade: true, duration: 250 });

// app.json's `expo-audio` plugin is configured with `enableBackgroundPlayback`,
// which only changes the Android manifest (a foreground service + the
// permissions it needs). That native change is inert until the audio
// session is actually told to behave this way, once, at startup.
void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });

/**
 * When recitation runs on from one surah into the next (the end of a surah,
 * or "next" on its last ayah) and the reader was following along in the
 * surah that just finished, take the reader with it. If the user was on the
 * list, or reading some other surah, leave them where they are.
 */
function FollowPlayingSurah({ viewed, onFollow }: { viewed: number | null; onFollow: (id: number) => void }) {
  const { surahId } = usePlayer();
  const previous = useRef<number | null>(null);
  useEffect(() => {
    const prev = previous.current;
    previous.current = surahId;
    if (surahId !== null && prev !== null && prev !== surahId && viewed === prev) onFollow(surahId);
    // `viewed`/`onFollow` are deliberately read, not depended on: this must
    // fire only when the PLAYING surah changes, never when navigation does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surahId]);
  return null;
}

/**
 * Everything below the providers: the screen switch, the player bar and the
 * chrome that has to know the current scheme. Separate from `App` because it
 * reads `useTheme()`, which needs the `ThemeProvider` `App` renders.
 */
function AppShell() {
  const [surahId, setSurahId] = useState<number | null>(null);
  // Which top-level screen is showing. The reader also needs `surahId` set —
  // `goToSurah` always sets both together — so this and `surahId` never
  // disagree about whether a surah is open.
  const [screen, setScreen] = useState<'list' | 'reader' | 'settings'>('list');
  // Tapping the bar while already reading the playing surah re-centres on
  // the recitation instead of doing nothing; a counter the reader watches.
  const [focusRequest, setFocusRequest] = useState(0);
  const goToSurah = (id: number) => {
    if (id === surahId) setFocusRequest(n => n + 1);
    else setSurahId(id);
    // Opening a surah — from the list, the player bar, or Settings — always
    // switches to the reader, even one already loaded while Settings was open.
    setScreen('reader');
  };
  const [script, setScript] = useState<Script>('tajweed');
  const fontsReady = useQuranFonts();
  const { palette, scheme } = useTheme();
  useEffect(() => {
    if (fontsReady) SplashScreen.hideAsync().catch(() => { /* nothing to hide */ });
  }, [fontsReady]);

  /**
   * Android's hardware back button. Without this every press went to the
   * OS, which closed the app — from Settings, and from the reader, where
   * back plainly means "the screen I came from". Returning `false` on the
   * list is deliberate: there is nowhere further back to go, so the OS
   * should do what it does at the top of an app's stack and leave it.
   *
   * The reader also forgets its surah, exactly as its own "All surahs"
   * button does, so nothing later reopens a reader nobody asked for.
   *
   * Depends on `screen` alone — one live subscription, re-armed only when
   * the screen it has to decide about actually changes.
   */
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'settings') { setScreen('list'); return true; }
      if (screen === 'reader') { setSurahId(null); setScreen('list'); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [screen]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: palette.background }]}>
      <View style={styles.content}>
        {!fontsReady
          ? null
          : screen === 'settings'
          ? <SettingsScreen onBack={() => setScreen('list')} onOpenSurah={goToSurah} />
          : screen === 'reader' && surahId !== null
          ? (
            <ReaderScreen
              surahId={surahId}
              script={script}
              onScriptChange={setScript}
              onBack={() => { setSurahId(null); setScreen('list'); }}
              focusRequest={focusRequest}
            />
          )
          : <SurahListScreen onSelect={goToSurah} script={script} onOpenSettings={() => setScreen('settings')} />}
      </View>
      <PlayerBar onNavigate={goToSurah} />
      <FollowPlayingSurah viewed={surahId} onFollow={setSurahId} />
      {/*
        Follows the app's OWN scheme, not the system's: `auto` would draw
        white icons over a light app whenever the phone was in dark mode
        while the user had asked this app for light — an invisible status
        bar. `scheme` is the resolved one, so the icons are always readable
        against `palette.background`.
      */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaView>
  );
}

export default function App() {
  // Once, at launch: makes "done" reflect what is actually on disk before
  // anything is tapped (a surah downloaded in a previous session, or one
  // whose files were removed outside the app).
  useEffect(() => { refreshFromDisk(); }, []);

  return (
    <SafeAreaProvider>
      {/*
        Outside the player: the theme is read by the bar and by every screen,
        and a scheme change must not disturb playback.
      */}
      <ThemeProvider>
        {/*
          Mounted once, above the screen switch inside `AppShell`, so
          navigating between the list and the reader never unmounts it —
          that's what lets recitation (and the bar showing it) survive
          navigation.
        */}
        <PlayerProvider>
          <AppShell />
        </PlayerProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
});
