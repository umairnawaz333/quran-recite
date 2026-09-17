import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { SurahMeta } from '@quran/core';
import { getSurahList } from '../data/surahs';

// Mirrors the web's `max-w-3xl` (48rem = 768px) cap on the home page's list
// column (apps/web/app/page.tsx) — on a tablet-width screen the list would
// otherwise stretch into unreadably long rows.
const MAX_CONTENT_WIDTH = 768;

export function SurahListScreen({ onSelect }: { onSelect: (id: number) => void }) {
  const surahs = getSurahList();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width, MAX_CONTENT_WIDTH);

  const renderItem = ({ item }: { item: SurahMeta }) => (
    <Pressable style={styles.row} onPress={() => onSelect(item.id)} accessibilityRole="button">
      <Text style={styles.number}>{item.id}</Text>
      <View style={styles.names}>
        <Text style={styles.simple}>{item.nameSimple}</Text>
        <Text style={styles.english}>{item.nameEnglish} · {item.ayahCount} ayahs</Text>
      </View>
      <Text style={styles.arabic}>{item.nameArabic}</Text>
    </Pressable>
  );

  return (
    <FlatList
      data={surahs}
      renderItem={renderItem}
      keyExtractor={item => String(item.id)}
      contentContainerStyle={[styles.list, { maxWidth: contentWidth, width: '100%', alignSelf: 'center' }]}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 12 },
  number: { width: 28, textAlign: 'center', color: '#888', fontVariant: ['tabular-nums'] },
  names: { flex: 1 },
  simple: { fontSize: 16, fontWeight: '500' },
  english: { fontSize: 13, color: '#777', marginTop: 2 },
  arabic: { fontSize: 18 },
});
