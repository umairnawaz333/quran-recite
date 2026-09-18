import { useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SettingsIcon } from '../components/NavIcons';
import type { SurahMeta } from '@quran/core';
import { getSurahList } from '../data/surahs';
import { SCRIPT_FONTS } from '../reader/fonts';
import type { Script } from './ReaderScreen';
import { useTheme } from '../theme/theme';

// Where the list was scrolled to when the user last left it. The screen
// unmounts while a surah or Settings is open, so this lives at module scope:
// coming back lands exactly where you left, not at Al-Fatihah again.
//
// Rows are a FIXED height and the whole list renders at once (114 rows is
// nothing), so `contentOffset` can restore the exact pixel position at mount
// with no jump: measuring one row and estimating the rest put the list two or
// three surahs short of the bottom on a phone, because the rows whose English
// name wraps to a second line were taller than the one that was measured.
let lastOffset = 0;
const ROW_HEIGHT = 72;
const LIST_PADDING = 8;

// Mirrors the web's `max-w-3xl` (48rem = 768px) cap on the home page's list
// column (apps/web/app/page.tsx) — on a tablet-width screen the list would
// otherwise stretch into unreadably long rows.
const MAX_CONTENT_WIDTH = 768;

export function SurahListScreen({ onSelect, script, onOpenSettings }: { onSelect: (id: number) => void; script: Script; onOpenSettings: () => void }) {
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
    >
      <Text style={[styles.number, { color: palette.textMuted }]}>{item.id}</Text>
      <View style={styles.names}>
        <Text style={[styles.simple, { color: palette.text }]}>{item.nameSimple}</Text>
        <Text style={[styles.english, { color: palette.textMuted }]} numberOfLines={2}>{item.nameEnglish} · {item.ayahCount} ayahs</Text>
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
    <View style={styles.root}>
      {/*
        Outside the FlatList (not a `ListHeaderComponent`) so its height
        never has to be accounted for in `getItemLayout`'s row math — the
        list still starts its own rows at offset 0.
      */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: palette.text }]}>Quran</Text>
        <Pressable
          onPress={onOpenSettings}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          style={styles.settingsButton}
        >
          <SettingsIcon size={24} color={palette.text} />
        </Pressable>
      </View>
      <FlatList
        ref={listRef}
        style={styles.flatList}
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
        contentOffset={{ x: 0, y: lastOffset }}
        initialNumToRender={surahs.length}
        getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: LIST_PADDING + ROW_HEIGHT * index, index })}
      />
    </View>
  );
}

// Layout only — every colour comes from the palette at the call site, so the
// list follows the scheme (see `theme.tsx`).
const styles = StyleSheet.create({
  root: { flex: 1 },
  flatList: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  settingsButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  list: { paddingVertical: LIST_PADDING },
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
  number: { width: 28, textAlign: 'center', fontVariant: ['tabular-nums'] },
  names: { flex: 1 },
  simple: { fontSize: 16, fontWeight: '500' },
  english: { fontSize: 13, marginTop: 2 },
  // A fixed column: RN under-measures the Quran faces' width, so an
  // intrinsically-sized Text wrapped two-word names ("آل عمران") onto a
  // clipped second line. Wide enough for the longest name at this size.
  arabic: { fontSize: 18, width: 150, textAlign: 'right' },
});
