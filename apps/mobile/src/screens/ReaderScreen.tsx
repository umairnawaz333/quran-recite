import { useEffect, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SurahText } from '@quran/core';
import { textLoaders } from '../data/textIndex.generated';
import { TajweedLine } from '../reader/TajweedLine';
import { useIsActiveWord } from '../reader/activeWordStore';
import { SCRIPT_FONTS } from '../reader/fonts';
import { usePlayer } from '../player/PlayerProvider';
import { getSurahMeta } from '../data/surahs';
import { PauseIcon, PlayIcon, Spinner } from '../components/PlayerIcons';

export type Script = 'tajweed' | 'indopak';

// Shared by both scripts' arabic text so the tajweed (native-view, Android;
// RN <Text>, iOS) and IndoPak (RN <Text> on both) renderings stay the same
// size — only their word-joining mechanism differs.
const ARABIC_FONT_SIZE = 26;
const ARABIC_LINE_HEIGHT = 52;
const ARABIC_COLOR = '#000000';

/**
 * A single IndoPak word. Pulled out to its own component (rather than
 * rendered inline in `ReaderScreen`'s `.map`) so `useIsActiveWord` is called
 * once per word component instance, not a variable number of times inside
 * `ReaderScreen` itself — the latter would violate the rules of hooks.
 * Tajweed words get the equivalent treatment inside `TajweedLine`.
 */
function IndopakWord({ wordId, text }: { wordId: string; text: string }) {
  const isActive = useIsActiveWord(wordId);
  return <Text style={isActive ? styles.highlight : undefined}>{text}</Text>;
}

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
  const player = usePlayer();
  // Destructure the specific actions this screen calls and depend on those
  // stable references, not on `player` itself — the provider rebuilds that
  // whole object on every playback tick (every ayah change, every
  // isPlaying/isLoading flip), so an effect that closed over it would
  // re-run on that same cadence. See PlayerProvider.tsx.
  const { play, toggle, attachViewer } = player;

  // Tell the provider this surah is the one on screen, so it knows whether
  // it may paint into the (single, global) active-word store — otherwise
  // browsing to a different surah while another plays would highlight text
  // here that belongs to that other surah.
  useEffect(() => attachViewer(surahId), [surahId, attachViewer]);

  // This screen's own transport state only applies while it is actually
  // showing the surah that's playing; otherwise it should read as idle,
  // not as whatever surah is playing somewhere else (e.g. via the bar).
  const isCurrent = player.surahId === surahId;
  const isPlaying = isCurrent && player.isPlaying;
  const ayah = isCurrent ? player.ayah : 1;

  // `isLoading`/`error` are attributed via `pendingSurahId`, not `surahId`:
  // while a *different* surah is still live, loading or failing to load
  // this one leaves `surahId` correctly naming that other surah, so gating
  // on `isCurrent` here would show this screen as idle throughout its own
  // fetch, and would show its failure on whichever screen happens to be
  // `isCurrent` instead of on this one. See PlayerProvider's `PlayerState`.
  const isPending = player.pendingSurahId === surahId;
  const isLoading = isPending && player.isLoading;
  const error = isPending ? player.error : null;

  const toggleLabel = isLoading ? 'Loading' : isPlaying ? 'Pause' : 'Play';

  const handleToggle = () => {
    if (isCurrent) toggle();
    else void play(surahId);
  };

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

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={text.ayahs}
        keyExtractor={a => String(a.ayah)}
        initialNumToRender={8}
        windowSize={5}
        renderItem={({ item }) => (
          <View style={styles.ayah}>
            {script === 'tajweed' ? (
              <TajweedLine
                words={item.words}
                ayahNumber={item.ayah}
                fontFamily={SCRIPT_FONTS[script]}
                fontSize={ARABIC_FONT_SIZE}
                lineHeight={ARABIC_LINE_HEIGHT}
                color={ARABIC_COLOR}
              />
            ) : (
              <Text style={[styles.arabic, { fontFamily: SCRIPT_FONTS[script] }]}>
                {item.words.map((w, i) => (
                  <Text key={w.id}>
                    <IndopakWord wordId={w.id} text={w.indopak} />
                    {i < item.words.length - 1 ? <Text> </Text> : null}
                  </Text>
                ))}
                <Text style={styles.ayahNumber}>  ﴿{item.ayah}﴾</Text>
              </Text>
            )}

            <View style={styles.ayahFooter}>
              <Pressable
                onPress={() => void play(surahId, item.ayah)}
                accessibilityRole="button"
                accessibilityLabel={`Play ayah ${item.ayah}`}
                style={styles.ayahPlayButton}
              >
                <PlayIcon size={12} color="#888" />
                <Text style={styles.ayahPlay}>{surahId}:{item.ayah}</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <View style={styles.controls}>
        <Text style={styles.ayahIndicator}>Ayah {ayah}</Text>
        <Pressable
          style={styles.playButton}
          onPress={handleToggle}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel={toggleLabel}
        >
          {isLoading
            ? <Spinner size={20} color="#fff" />
            : isPlaying ? <PauseIcon size={20} color="#fff" /> : <PlayIcon size={20} color="#fff" />}
        </Pressable>
      </View>
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
  arabic: { fontSize: ARABIC_FONT_SIZE, lineHeight: ARABIC_LINE_HEIGHT, textAlign: 'right', writingDirection: 'rtl' },
  ayahNumber: { fontSize: 16, color: '#999' },
  ayahFooter: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  ayahPlayButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ayahPlay: { fontSize: 13, color: '#888', fontVariant: ['tabular-nums'] },
  // Matches the web's `.word--active` tint (#fde68a) — a background colour
  // only, never a text-colour change, so tajweed colours stay visible.
  highlight: { backgroundColor: '#fde68a' },
  errorBanner: { backgroundColor: '#fee2e2', paddingVertical: 8, paddingHorizontal: 16 },
  errorText: { color: '#991b1b', fontSize: 13, textAlign: 'center' },
  controls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ddd',
  },
  ayahIndicator: { fontSize: 14, color: '#555', fontVariant: ['tabular-nums'] },
  playButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#1a1a1a',
    alignItems: 'center', justifyContent: 'center',
  },
});
