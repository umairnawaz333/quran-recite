import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { setAudioModeAsync } from 'expo-audio';
import { SurahListScreen } from './src/screens/SurahListScreen';
import { ReaderScreen, type Script } from './src/screens/ReaderScreen';
import { useQuranFonts } from './src/reader/fonts';

// app.json's `expo-audio` plugin is configured with `enableBackgroundPlayback`,
// which only changes the Android manifest (a foreground service + the
// permissions it needs). That native change is inert until the audio
// session is actually told to behave this way, once, at startup.
void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true });

export default function App() {
  const [surahId, setSurahId] = useState<number | null>(null);
  const [script, setScript] = useState<Script>('tajweed');
  const fontsReady = useQuranFonts();

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        {!fontsReady
          ? null
          : surahId === null
          ? <SurahListScreen onSelect={setSurahId} />
          : (
            <ReaderScreen
              surahId={surahId}
              script={script}
              onScriptChange={setScript}
              onBack={() => setSurahId(null)}
            />
          )}
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#fff' } });
