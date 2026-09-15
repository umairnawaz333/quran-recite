import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { countBaseLetters } from '@quran/core';

export default function App() {
  // Proves @quran/core resolves and runs under Metro, which is the whole
  // point of this task. Replaced by the surah list in the next task.
  const letters = countBaseLetters('بِسْمِ ٱللَّهِ');

  return (
    <View style={styles.container}>
      <Text style={styles.text}>@quran/core reachable — {letters} base letters</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  text: { fontSize: 16 },
});
