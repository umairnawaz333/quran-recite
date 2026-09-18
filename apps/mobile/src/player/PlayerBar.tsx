import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePlayer } from './PlayerProvider';
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, Spinner } from '../components/PlayerIcons';
import { useTheme } from '../theme/theme';

/**
 * The player, visible on every screen — rendered once from `App.tsx`,
 * beneath whichever screen is current, so it survives navigation between
 * the surah list and the reader. Mirrors the web's `PlayerBar`
 * (apps/web/components/player/PlayerBar.tsx), prev/next included.
 */
export function PlayerBar({ onNavigate }: { onNavigate: (surahId: number) => void }) {
  const {
    surahId, surahName, ayah, isPlaying, isLoading, pendingSurahId, toggle, next, prev,
  } = usePlayer();
  const { palette } = useTheme();

  // Nothing has ever played — show no chrome at all.
  if (surahId === null) return null;

  // `isLoading` is attributed via `pendingSurahId`: while a *different*
  // surah is loading in the background, `surahId`/`ayah` here still
  // correctly name the surah that's actually live, and that surah is not
  // loading — so the bar must not show its spinner (or disable its own
  // toggle) for a fetch that belongs to some other, not-yet-live surah.
  // Any load the recitation is waiting on shows here — the bar is the one
  // transport, whichever surah the load belongs to. (`pendingSurahId` still
  // decides which SCREEN shows its loading strip; the bar just says
  // "loading".) Without this, tapping the next surah from the bar while one
  // played gave no feedback at all until the switch-over.
  void pendingSurahId;
  const isLoadingForThis = isLoading;
  const toggleLabel = isLoadingForThis ? 'Loading' : isPlaying ? 'Pause' : 'Play';

  // The web disables prev/next with `disabled={!p.hasPlaylist}` — true only
  // once a sequencer actually exists for the live surah, so a bare resume
  // restore (surah known, nothing built yet) can't be tapped into a no-op.
  // Mobile keeps no separate `hasPlaylist` flag, but `sequencerRef` in
  // PlayerProvider is only ever unset during exactly this same window
  // (`isLoadingForThis`), so it's the equivalent proxy here.
  const transportDisabled = isLoadingForThis;

  return (
    <View style={[styles.root, { backgroundColor: palette.background, borderTopColor: palette.border }]}>
      <Pressable
        style={styles.info}
        onPress={() => onNavigate(surahId)}
        accessibilityRole="button"
        accessibilityLabel={`Go to ${surahName ?? 'playing surah'}`}
      >
        <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>{surahName}</Text>
        <Text style={[styles.ayah, { color: palette.textMuted }]}>Ayah {ayah}</Text>
      </Pressable>

      <View style={styles.transport}>
        <Pressable
          style={styles.side}
          onPress={() => void prev()}
          disabled={transportDisabled}
          accessibilityRole="button"
          accessibilityLabel="Previous ayah"
        >
          <PrevIcon size={18} color={transportDisabled ? palette.disabled : palette.textMuted} />
        </Pressable>

        <Pressable
          style={[styles.toggle, { backgroundColor: palette.accent }]}
          onPress={toggle}
          disabled={isLoadingForThis}
          accessibilityRole="button"
          accessibilityLabel={toggleLabel}
        >
          {isLoadingForThis
            ? <Spinner size={20} color={palette.accentText} />
            : isPlaying ? <PauseIcon size={20} color={palette.accentText} /> : <PlayIcon size={20} color={palette.accentText} />}
        </Pressable>

        <Pressable
          style={styles.side}
          onPress={() => void next()}
          disabled={transportDisabled}
          accessibilityRole="button"
          accessibilityLabel="Next ayah"
        >
          <NextIcon size={18} color={transportDisabled ? palette.disabled : palette.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

// Layout only — the bar's colours come from the palette at the call site, so
// it follows the scheme (see `theme.tsx`).
const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  info: { flex: 1, marginRight: 12 },
  name: { fontSize: 14, fontWeight: '600' },
  ayah: { fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  side: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  toggle: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
});
