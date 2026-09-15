import { useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SurahListScreen } from './src/screens/SurahListScreen';

export default function App() {
  const [surahId, setSurahId] = useState<number | null>(null);

  return (
    <SafeAreaView style={styles.root}>
      {surahId === null
        ? <SurahListScreen onSelect={setSurahId} />
        : null /* ReaderScreen arrives in Task 6 */}
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#fff' } });
