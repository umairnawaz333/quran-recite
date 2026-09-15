import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SurahMeta } from '@quran/core';
import { getSurahList } from '../data/surahs';

export function SurahListScreen({ onSelect }: { onSelect: (id: number) => void }) {
  const surahs = getSurahList();

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
      contentContainerStyle={styles.list}
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
