import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SurahListScreen } from './src/screens/SurahListScreen';
import { ReaderScreen } from './src/screens/ReaderScreen';

type Script = 'tajweed' | 'indopak';

export default function App() {
  const [surahId, setSurahId] = useState<number | null>(null);
  const [script, setScript] = useState<Script>('tajweed');

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        {surahId === null
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
