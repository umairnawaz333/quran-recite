import { useEffect, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { SurahText } from '@quran/core';
import { textLoaders } from '../data/textIndex.generated';
import { TajweedLine } from '../reader/TajweedLine';
import { useIsActiveWord } from '../reader/activeWordStore';
import { SCRIPT_FONTS } from '../reader/fonts';
import { usePlayer } from '../player/PlayerProvider';
import { getSurahMeta } from '../data/surahs';
import { PlayIcon } from '../components/PlayerIcons';

export type Script = 'tajweed' | 'indopak';

const ARABIC_COLOR = '#000000';

// Mirrors the web's `.quran-text` rule exactly (apps/web/app/globals.css):
//   font-size: clamp(1.75rem, 5vw, 2.75rem); line-height: 2.4;
//   @media (max-width: 640px) { font-size: clamp(1.5rem, 7vw, 2rem); line-height: 2.2; }
// (1rem = 16px there; RN's dp is the same "layout pixel" unit CSS px is, so
// the numbers translate directly.) `useWindowDimensions()` stands in for
// `vw`, so a fold, unfold or rotation reflows the same way resizing a
// browser window would. `width` — not the capped content width below — is
// used for the "vw" term, since CSS `vw` is always relative to the full
// viewport, not to a `max-width` container inside it.
const NARROW_BREAKPOINT = 640;
function clampSize(min: number, preferred: number, max: number): number {
  return Math.max(min, Math.min(preferred, max));
}
function arabicTypeForWidth(width: number): { fontSize: number; lineHeight: number } {
  const narrow = width <= NARROW_BREAKPOINT;
  const fontSize = narrow
    ? clampSize(24, width * 0.07, 32)
    : clampSize(28, width * 0.05, 44);
  return { fontSize, lineHeight: fontSize * (narrow ? 2.2 : 2.4) };
}
// Mirrors the web's `max-w-3xl` (48rem = 768px) cap on the reading column —
// unbounded lines of Arabic on a tablet are technically fine and genuinely
// hard to read.
const MAX_CONTENT_WIDTH = 768;

/**
 * A single IndoPak word. Pulled out to its own component (rather than
 * rendered inline in `ReaderScreen`'s `.map`) so `useIsActiveWord` is called
 * once per word component instance, not a variable number of times inside
 * `ReaderScreen` itself — the latter would violate the rules of hooks.
 * Tajweed words get the equivalent treatment inside `TajweedLine`.
 */
function IndopakWord({ wordId, text, onPress }: { wordId: string; text: string; onPress: () => void }) {
  const isActive = useIsActiveWord(wordId);
  return <Text style={isActive ? styles.highlight : undefined} onPress={onPress}>{text}</Text>;
}

export function ReaderScreen({
  surahId, script, onScriptChange, onBack, focusRequest = 0,
}: {
  surahId: number;
  script: Script;
  onScriptChange: (script: Script) => void;
  onBack: () => void;
  /** Bumped to ask the reader to re-centre on the playing ayah (bar tapped while already here). */
  focusRequest?: number;
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
  const { play, attachViewer } = player;

  // Tell the provider this surah is the one on screen, so it knows whether
  // it may paint into the (single, global) active-word store — otherwise
  // browsing to a different surah while another plays would highlight text
  // here that belongs to that other surah.
  useEffect(() => attachViewer(surahId), [surahId, attachViewer]);

  // Follow the recitation: keep the playing ayah in view while this surah
  // is the one playing, as the web's auto-scroll does. `playingAyah` is null
  // whenever another surah (or nothing) is playing, so browsing here while
  // something else recites is never yanked around.
  const listRef = useRef<FlatList<SurahText['ayahs'][number]>>(null);
  const playingAyah = player.surahId === surahId ? player.ayah : null;

  // `useWindowDimensions()` re-renders this component on every dimension
  // change (fold, unfold, rotation) — exactly what's wanted here, since
  // both derived values below are pure functions of `width` alone. Nothing
  // derived from it is allowed into an effect/memo dependency array that
  // also depends on player actions (see PlayerProvider.tsx) — it isn't
  // here; it only ever feeds render output.
  const { width } = useWindowDimensions();
  const { fontSize: arabicFontSize, lineHeight: arabicLineHeight } = arabicTypeForWidth(width);
  const contentWidth = Math.min(width, MAX_CONTENT_WIDTH);

  // Precise, centred following.
  //
  // FlatList knows the real frame of every row it has rendered and only
  // estimates the rest, so centring is done in two phases. Phase one gets
  // the target row rendered: `scrollToIndex` on an unrendered row fails
  // into `onScrollToIndexFailed`, which jumps near FlatList's own estimate
  // and retries once rows there have laid out — each retry lands closer,
  // and `maintainVisibleContentPosition` keeps the content from sliding
  // under the offset as rows above are measured. Phase two runs the moment
  // the target row lays out (`onRowLayout`): a final `scrollToIndex` by its
  // measured frame, exact, with `viewPosition: 0.5` for the middle of the
  // viewport. No height estimates of our own are handed to FlatList —
  // given `getItemLayout`, it would trust those over measured frames for
  // every phase, and estimates cannot be exact for a hundred rows.
  const rowHeights = useRef<Record<number, number>>({});
  const pendingCentre = useRef<number | null>(null);
  const viewportHeight = useRef(0);
  const retriesLeft = useRef(0);
  /**
   * Put row `index` — or a y inside it, `withinRow`, for the recited line —
   * at the viewport's centre, by FlatList's own `scrollToIndex`, which
   * positions a RENDERED row by the frame it measured for it: exact. On a
   * row not yet rendered (or one whose frame FlatList has not recorded yet)
   * it fails synchronously into `onScrollToIndexFailed`; only then does
   * `pendingCentre` stay set, so the layout-time snap and the retry path
   * keep trying until an attempt succeeds. (A `measureLayout`-based snap was
   * tried and abandoned: on Fabric its coordinates are shadow-tree layout,
   * neither reliably screen- nor content-relative across scroll states.)
   */
  const failed = useRef(false);
  const snapTo = (index: number, withinRow?: number) => {
    const height = rowHeights.current[index] ?? 0;
    failed.current = false;
    listRef.current?.scrollToIndex({
      index,
      viewPosition: 0.5,
      viewOffset: withinRow === undefined || !height ? 0 : height / 2 - withinRow,
      animated: true,
    });
    if (!failed.current && pendingCentre.current === index) pendingCentre.current = null;
  };
  const centreOnRow = (index: number) => {
    pendingCentre.current = index;
    retriesLeft.current = 12;
    snapTo(index);
  };
  const retryCentre = (info: { index: number; averageItemLength: number }) => {
    failed.current = true;
    if (pendingCentre.current !== info.index || retriesLeft.current-- <= 0) return;
    // Jump near FlatList's estimate so the target row gets rendered, then
    // try again once rows there have laid out.
    listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    setTimeout(() => {
      if (pendingCentre.current === info.index) snapTo(info.index);
    }, 300);
  };
  const onRowLayout = (index: number, height: number) => {
    rowHeights.current[index] = height;
    if (pendingCentre.current === index) {
      // Let FlatList record the new frame before centring on it.
      setTimeout(() => { if (pendingCentre.current === index) snapTo(index); }, 60);
    }
  };
  useEffect(() => {
    if (playingAyah === null) return;
    const index = text.ayahs.findIndex(a => a.ayah === playingAyah);
    if (index >= 0) centreOnRow(index);
    // `focusRequest` is bumped by the bar when the user taps the playing
    // surah while already reading it: "take me back to the recitation".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingAyah, text, focusRequest]);
  /**
   * Follow the recited line within a long ayah. Re-centres only when the
   * highlight has moved well away from the line last centred, so the page
   * does not twitch on every word and a reader who nudges it is not fought.
   */
  const lastCentredLine = useRef<{ index: number; y: number } | null>(null);
  const followHighlight = (index: number, line: { top: number; bottom: number }) => {
    const y = (line.top + line.bottom) / 2;
    const last = lastCentredLine.current;
    if (last && last.index === index && Math.abs(y - last.y) < viewportHeight.current * 0.2) return;
    lastCentredLine.current = { index, y };
    snapTo(index, y);
  };

  // `error` is attributed via `pendingSurahId`, not `surahId`: while a
  // *different* surah is still live, failing to load this one leaves
  // `surahId` correctly naming that other, still-fine surah — so this
  // screen's own failure only ever surfaces via `pendingSurahId === surahId`.
  // See PlayerProvider's `PlayerState`.
  const isPending = player.pendingSurahId === surahId;
  const error = isPending ? player.error : null;
  // Loading is attributed the same way. This matters most when a *different*
  // surah is still live: the bar keeps (correctly) showing that surah, so
  // without this strip a tap on one of this screen's ayah buttons would give
  // no visible feedback at all until the switch-over lands or fails.
  const isLoading = isPending && player.isLoading;


  return (
    <View style={styles.root}>
      {/*
        Caps the whole reading column — header included, mirroring the web's
        `max-w-3xl` on both its header and its reader — at `contentWidth`,
        which tracks `width` every render, so a fold/unfold/rotation reflows
        instead of leaving the column pinned to a stale size.
      */}
      <View style={[styles.content, { maxWidth: contentWidth }]}>
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
        {!error && isLoading && (
          <View style={styles.loadingBanner} accessibilityLiveRegion="polite">
            <Text style={styles.loadingText}>Loading recitation…</Text>
          </View>
        )}

        <FlatList
          ref={listRef}
          data={text.ayahs}
          keyExtractor={a => String(a.ayah)}
          initialNumToRender={8}
          windowSize={5}
          onLayout={e => { viewportHeight.current = e.nativeEvent.layout.height; }}
          onScrollToIndexFailed={retryCentre}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          renderItem={({ item, index }) => (
            <View
              style={styles.ayah}
              onLayout={e => onRowLayout(index, e.nativeEvent.layout.height)}
            >
              {script === 'tajweed' ? (
                <TajweedLine
                  words={item.words}
                  ayahNumber={item.ayah}
                  fontFamily={SCRIPT_FONTS[script]}
                  fontSize={arabicFontSize}
                  lineHeight={arabicLineHeight}
                  color={ARABIC_COLOR}
                  onWordPress={wordId => void play(surahId, item.ayah, wordId)}
                  onHighlightLayout={item.ayah === playingAyah ? line => followHighlight(index, line) : undefined}
                />
              ) : (
                <Text
                  style={[
                    styles.arabic,
                    { fontFamily: SCRIPT_FONTS[script], fontSize: arabicFontSize, lineHeight: arabicLineHeight },
                  ]}
                >
                  {item.words.map((w, i) => (
                    <Text key={w.id}>
                      <IndopakWord
                        wordId={w.id}
                        text={w.indopak}
                        onPress={() => void play(surahId, item.ayah, w.id)}
                      />
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: '#666', fontSize: 14 },
  title: { fontSize: 16, fontWeight: '600', flex: 1 },
  toggle: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: '#eee' },
  toggleText: { fontSize: 13, fontWeight: '500', color: '#333' },
  ayah: { paddingHorizontal: 16, paddingVertical: 10 },
  arabic: { textAlign: 'right', writingDirection: 'rtl' },
  ayahNumber: { fontSize: 16, color: '#999' },
  ayahFooter: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  ayahPlayButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ayahPlay: { fontSize: 13, color: '#888', fontVariant: ['tabular-nums'] },
  // Matches the web's `.word--active` tint (#fde68a) — a background colour
  // only, never a text-colour change, so tajweed colours stay visible.
  highlight: { backgroundColor: '#fde68a' },
  errorBanner: { backgroundColor: '#fee2e2', paddingVertical: 8, paddingHorizontal: 16 },
  loadingBanner: { backgroundColor: '#f3f4f6', paddingVertical: 6, paddingHorizontal: 16 },
  loadingText: { color: '#555', fontSize: 13, textAlign: 'center' },
  errorText: { color: '#991b1b', fontSize: 13, textAlign: 'center' },
});
