import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { setAudioModeAsync } from 'expo-audio';
import { SurahListScreen } from './src/screens/SurahListScreen';
import { ReaderScreen, type Script } from './src/screens/ReaderScreen';
import { PlayerProvider, usePlayer } from './src/player/PlayerProvider';
import { PlayerBar } from './src/player/PlayerBar';
import { useQuranFonts } from './src/reader/fonts';

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

export default function App() {
  const [surahId, setSurahId] = useState<number | null>(null);
  // Tapping the bar while already reading the playing surah re-centres on
  // the recitation instead of doing nothing; a counter the reader watches.
  const [focusRequest, setFocusRequest] = useState(0);
  const goToSurah = (id: number) => {
    if (id === surahId) setFocusRequest(n => n + 1);
    else setSurahId(id);
  };
  const [script, setScript] = useState<Script>('tajweed');
  const fontsReady = useQuranFonts();

  return (
    <SafeAreaProvider>
      {/*
        Mounted once, above the screen switch below, so navigating between
        the list and the reader never unmounts it — that's what lets
        recitation (and the bar showing it) survive navigation.
      */}
      <PlayerProvider>
        <SafeAreaView style={styles.root}>
          <View style={styles.content}>
            {!fontsReady
              ? null
              : surahId === null
              ? <SurahListScreen onSelect={setSurahId} script={script} />
              : (
                <ReaderScreen
                  surahId={surahId}
                  script={script}
                  onScriptChange={setScript}
                  onBack={() => setSurahId(null)}
                  focusRequest={focusRequest}
                />
              )}
          </View>
          <PlayerBar onNavigate={goToSurah} />
          <FollowPlayingSurah viewed={surahId} onFollow={setSurahId} />
          {/*
            "dark" (icons), not "auto": `auto` follows the SYSTEM colour
            scheme, so on a phone set to dark mode it drew white icons over
            this app's always-white background — an invisible status bar.
            The app is light-only until Stage 2's theme work; revisit there.
          */}
          <StatusBar style="dark" />
        </SafeAreaView>
      </PlayerProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  content: { flex: 1 },
});
