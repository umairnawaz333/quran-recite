import { useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { SurahMeta } from '@quran/core';
import { getSurahList } from '../data/surahs';
import { SCRIPT_FONTS } from '../reader/fonts';
import type { Script } from './ReaderScreen';
import { useTheme } from '../theme/theme';

// Where the list was scrolled to when the user last left it, and how tall
// its (uniform) rows are. The screen unmounts while a surah is open, so
// these live at module scope: coming back from a surah lands where you
// left, not at Al-Fatihah again. Uniform rows let `getItemLayout` place
// `initialScrollIndex` exactly, before any row has rendered.
let lastOffset = 0;
let rowHeight = 0;

// Mirrors the web's `max-w-3xl` (48rem = 768px) cap on the home page's list
// column (apps/web/app/page.tsx) — on a tablet-width screen the list would
// otherwise stretch into unreadably long rows.
const MAX_CONTENT_WIDTH = 768;

export function SurahListScreen({ onSelect, script }: { onSelect: (id: number) => void; script: Script }) {
  const { palette } = useTheme();
  const surahs = getSurahList();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width, MAX_CONTENT_WIDTH);
  const listRef = useRef<FlatList<SurahMeta>>(null);

  const renderItem = ({ item }: { item: SurahMeta }) => (
    <Pressable
      style={styles.row}
      onPress={() => onSelect(item.id)}
      accessibilityRole="button"
      onLayout={e => { rowHeight = e.nativeEvent.layout.height; }}
    >
      <Text style={[styles.number, { color: palette.textMuted }]}>{item.id}</Text>
      <View style={styles.names}>
        <Text style={[styles.simple, { color: palette.text }]}>{item.nameSimple}</Text>
        <Text style={[styles.english, { color: palette.textMuted }]}>{item.nameEnglish} · {item.ayahCount} ayahs</Text>
      </View>
      {/* The same face the reader uses for the chosen script — the script
          choice is app-wide, so the names on the home page follow it. */}
      <Text
        style={[styles.arabic, { fontFamily: SCRIPT_FONTS[script], color: palette.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {item.nameArabic}
      </Text>
    </Pressable>
  );

  return (
    <FlatList
      ref={listRef}
      data={surahs}
      renderItem={renderItem}
      keyExtractor={item => String(item.id)}
      contentContainerStyle={[styles.list, { maxWidth: contentWidth, width: '100%', alignSelf: 'center' }]}
      onScroll={e => { lastOffset = e.nativeEvent.contentOffset.y; }}
      // The throttled stream can miss the final position of a fling; these
      // two fire once it has actually come to rest.
      onMomentumScrollEnd={e => { lastOffset = e.nativeEvent.contentOffset.y; }}
      onScrollEndDrag={e => { lastOffset = e.nativeEvent.contentOffset.y; }}
      scrollEventThrottle={100}
      getItemLayout={rowHeight ? (_, index) => ({ length: rowHeight, offset: rowHeight * index, index }) : undefined}
      initialScrollIndex={rowHeight && lastOffset > 0 ? Math.min(surahs.length - 1, Math.floor(lastOffset / rowHeight)) : undefined}
    />
  );
}

// Layout only — every colour comes from the palette at the call site, so the
// list follows the scheme (see `theme.tsx`).
const styles = StyleSheet.create({
  list: { paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 12 },
  number: { width: 28, textAlign: 'center', fontVariant: ['tabular-nums'] },
  names: { flex: 1 },
  simple: { fontSize: 16, fontWeight: '500' },
  english: { fontSize: 13, marginTop: 2 },
  // A fixed column: RN under-measures the Quran faces' width, so an
  // intrinsically-sized Text wrapped two-word names ("آل عمران") onto a
  // clipped second line. Wide enough for the longest name at this size.
  arabic: { fontSize: 18, width: 150, textAlign: 'right' },
});
