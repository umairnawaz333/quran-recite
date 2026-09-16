import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePlayer } from './PlayerProvider';

/**
 * The player, visible on every screen — rendered once from `App.tsx`,
 * beneath whichever screen is current, so it survives navigation between
 * the surah list and the reader. Mirrors the web's `PlayerBar`.
 */
export function PlayerBar({ onNavigate }: { onNavigate: (surahId: number) => void }) {
  const { surahId, surahName, ayah, isPlaying, isLoading, toggle } = usePlayer();

  // Nothing has ever played — show no chrome at all.
  if (surahId === null) return null;

  const toggleLabel = isLoading ? 'Loading' : isPlaying ? 'Pause' : 'Play';

  return (
    <View style={styles.root}>
      <Pressable
        style={styles.info}
        onPress={() => onNavigate(surahId)}
        accessibilityRole="button"
        accessibilityLabel={`Go to ${surahName ?? 'playing surah'}`}
      >
        <Text style={styles.name} numberOfLines={1}>{surahName}</Text>
        <Text style={styles.ayah}>Ayah {ayah}</Text>
      </Pressable>

      <Pressable
        style={styles.toggle}
        onPress={toggle}
        disabled={isLoading}
        accessibilityRole="button"
        accessibilityLabel={toggleLabel}
      >
        <Text style={styles.toggleText}>{toggleLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
    backgroundColor: '#fff',
  },
  info: { flex: 1, marginRight: 12 },
  name: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  ayah: { fontSize: 12, color: '#777', marginTop: 2, fontVariant: ['tabular-nums'] },
  toggle: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1a1a1a' },
  toggleText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
