import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SurahText } from '@quran/core';
import { textLoaders } from '../data/textIndex.generated';
import { TajweedText } from '../reader/TajweedText';
import { getSurahMeta } from '../data/surahs';

type Script = 'tajweed' | 'indopak';

export function ReaderScreen({
  surahId, script, onScriptChange, onBack,
}: {
  surahId: number;
  script: Script;
  onScriptChange: (script: Script) => void;
  onBack: () => void;
}) {
  // The generated loader parses this surah's JSON on first access and the
  // require cache keeps it thereafter, so this is cheap on re-render.
  const text: SurahText = useMemo(() => textLoaders[surahId](), [surahId]);
  const meta = getSurahMeta(surahId);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button">
          <Text style={styles.back}>All surahs</Text>
        </Pressable>
        <Text style={styles.title}>{meta?.nameSimple ?? `Surah ${surahId}`}</Text>
        <Pressable
          style={styles.toggle}
          onPress={() => onScriptChange(script === 'tajweed' ? 'indopak' : 'tajweed')}
          accessibilityRole="button"
        >
          <Text style={styles.toggleText}>{script === 'tajweed' ? 'Tajweed' : 'IndoPak'}</Text>
        </Pressable>
      </View>

      <FlatList
        data={text.ayahs}
        keyExtractor={a => String(a.ayah)}
        initialNumToRender={8}
        windowSize={5}
        renderItem={({ item }) => (
          <View style={styles.ayah}>
            <Text style={styles.arabic}>
              {item.words.map((w, i) => (
                <Text key={w.id}>
                  {script === 'tajweed'
                    ? <TajweedText markup={w.tajweed} />
                    : <Text>{w.indopak}</Text>}
                  {i < item.words.length - 1 ? <Text> </Text> : null}
                </Text>
              ))}
              <Text style={styles.ayahNumber}>  ﴿{item.ayah}﴾</Text>
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: '#666', fontSize: 14 },
  title: { fontSize: 16, fontWeight: '600', flex: 1 },
  toggle: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: '#eee' },
  toggleText: { fontSize: 13, fontWeight: '500', color: '#333' },
  ayah: { paddingHorizontal: 16, paddingVertical: 10 },
  arabic: { fontSize: 26, lineHeight: 52, textAlign: 'right', writingDirection: 'rtl' },
  ayahNumber: { fontSize: 16, color: '#999' },
});
