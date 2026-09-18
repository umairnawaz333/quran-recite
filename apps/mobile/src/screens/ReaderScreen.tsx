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
import { BackIcon } from '../components/NavIcons';
import { DownloadControl } from '../components/DownloadControl';
import { useTheme } from '../theme/theme';

export type Script = 'tajweed' | 'indopak';

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
/** `styles.ayah`'s horizontal padding, which the native line's explicit width must exclude. */
const ROW_PADDING = 16;
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
/**
 * One ayah row. Reports its laid-out height and — the part a plain `View`
 * cannot — its unmount, so the reader knows which rows FlatList currently
 * has rendered and can therefore position exactly.
 */
function AyahRow({ index, onLayout, onUnmount, children }: {
  index: number;
  onLayout: (index: number, height: number) => void;
  onUnmount: (index: number) => void;
  children: React.ReactNode;
}) {
  // The handler is read through a ref so this cleanup runs on a real
  // unmount only — not on every render, where a fresh `onUnmount` identity
  // would otherwise mark a mounted row as gone.
  const unmountRef = useRef(onUnmount);
  unmountRef.current = onUnmount;
  useEffect(() => () => unmountRef.current(index), [index]);
  return (
    <View style={styles.ayah} onLayout={e => onLayout(index, e.nativeEvent.layout.height)}>
      {children}
    </View>
  );
}

function IndopakWord({ wordId, text, highlightStyle, onPress }: {
  wordId: string;
  text: string;
  /** The recited word's tint, from the palette — a background colour only. */
  highlightStyle: { backgroundColor: string };
  onPress: () => void;
}) {
  const isActive = useIsActiveWord(wordId);
  return <Text style={isActive ? highlightStyle : undefined} onPress={onPress}>{text}</Text>;
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
  // A context read of an object that only changes with the scheme (see
  // `theme.tsx`), so nothing here is on the per-word tick path.
  const { palette } = useTheme();
  const highlightStyle = useMemo(() => ({ backgroundColor: palette.highlight }), [palette.highlight]);
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
  const { width, height } = useWindowDimensions();
  // Type size follows the SHORTER side of the screen, not the width: the
  // web's `5vw` scales with viewport width, but on a phone turned sideways
  // that made the letters jump a size while the user wanted the same type
  // with more words per line. The shorter side is the same in both
  // orientations, so rotating only changes how the lines wrap; a tablet
  // still gets larger type than a phone.
  const { fontSize: arabicFontSize, lineHeight: arabicLineHeight } = arabicTypeForWidth(Math.min(width, height));
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
  // Precise, centred following.
  //
  // The surah is rendered in full — progressively, in batches, but with a
  // render window so large that nothing above the playing ayah is ever an
  // estimate. Every attempt to keep virtualising while jumping deep into a
  // 286-ayah surah failed for the same reason: FlatList positions
  // unrendered rows by estimate, and either the estimate steered the final
  // scroll (landing a dozen ayahs off) or it shifted the content under a
  // fixed offset as rows measured (a scroll that was exact when made drifted
  // afterwards). With every row above the target really laid out, FlatList's
  // frame for it is exact and `scrollToIndex` centres it exactly. The cost
  // is rendering a long surah's rows up front, which the batching spreads
  // over a second or so and which the user asked for in so many words.
  const rowHeights = useRef<Record<number, number>>({});
  const mountedRows = useRef<Set<number>>(new Set());
  const pendingCentre = useRef<number | null>(null);
  const viewportHeight = useRef(0);
  /** Centre a rendered row; `withinRow` moves the centre from the row's middle to the recited line. */
  const snapTo = (index: number, withinRow?: number) => {
    if (!mountedRows.current.has(index)) return false;
    const height = rowHeights.current[index] ?? 0;
    listRef.current?.scrollToIndex({
      index,
      viewPosition: 0.5,
      viewOffset: withinRow === undefined || !height ? 0 : height / 2 - withinRow,
      animated: true,
    });
    return true;
  };
  const centreOnRow = (index: number) => {
    // Rendered already: centre now. Otherwise wait — rendering is marching
    // down the surah regardless of scroll position, and `onRowLayout`
    // centres the moment the row exists.
    pendingCentre.current = snapTo(index) ? null : index;
  };
  const onRowLayout = (index: number, height: number) => {
    // A row lays out once with only its footer (the native text view sizes
    // itself a beat later) and again at its real height; only the latter is
    // a height worth recording or centring on.
    if (height < 60) return;
    rowHeights.current[index] = height;
    mountedRows.current.add(index);
    if (pendingCentre.current === index) {
      pendingCentre.current = null;
      // Let FlatList record the frame before centring on it.
      setTimeout(() => snapTo(index), 60);
    }
  };
  const onRowUnmount = (index: number) => { mountedRows.current.delete(index); };
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
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={styles.back} hitSlop={8}>
            <BackIcon size={26} color={palette.text} />
          </Pressable>
          <Text style={[styles.title, { color: palette.text }]}>{meta?.nameSimple ?? `Surah ${surahId}`}</Text>
          {/*
            `compact` — the header already carries four items (back, the
            surah name, this, the script toggle); the size text beside the
            arrow is what pushes the row over on a narrow phone. The surah
            list uses the same compact form.
          */}
          <DownloadControl surahId={surahId} compact />
          <Pressable
            style={[styles.toggle, { backgroundColor: palette.surface }]}
            onPress={() => onScriptChange(script === 'tajweed' ? 'indopak' : 'tajweed')}
            accessibilityRole="button"
          >
            <Text style={[styles.toggleText, { color: palette.text }]}>{script === 'tajweed' ? 'Tajweed' : 'IndoPak'}</Text>
          </Pressable>
        </View>

        {error && (
          <View style={[styles.errorBanner, { backgroundColor: palette.error }]}>
            <Text style={[styles.bannerText, { color: palette.errorText }]}>{error}</Text>
          </View>
        )}
        {!error && isLoading && (
          <View style={[styles.loadingBanner, { backgroundColor: palette.loadingBg }]} accessibilityLiveRegion="polite">
            <Text style={[styles.bannerText, { color: palette.textMuted }]}>Loading recitation…</Text>
          </View>
        )}

        <FlatList
          ref={listRef}
          data={text.ayahs}
          keyExtractor={a => String(a.ayah)}
          // Render everything, in batches — see the centring comment above.
          initialNumToRender={12}
          maxToRenderPerBatch={24}
          updateCellsBatchingPeriod={30}
          windowSize={1001}
          // Rows stay mounted and measured (frames stay exact) but off-screen
          // ones are detached from the native hierarchy, which is what keeps
          // a fully rendered long surah scrolling smoothly.
          removeClippedSubviews
          onLayout={e => { viewportHeight.current = e.nativeEvent.layout.height; }}
          onScrollToIndexFailed={() => { /* unreachable: only mounted rows are targeted */ }}
          renderItem={({ item, index }) => (
            <AyahRow
              index={index}
              onLayout={onRowLayout}
              onUnmount={onRowUnmount}
            >
              {script === 'tajweed' ? (
                <TajweedLine
                  words={item.words}
                  ayahNumber={item.ayah}
                  fontFamily={SCRIPT_FONTS[script]}
                  fontSize={arabicFontSize}
                  lineHeight={arabicLineHeight}
                  color={palette.text}
                  width={contentWidth - 2 * ROW_PADDING}
                  onWordPress={wordId => void play(surahId, item.ayah, wordId)}
                  onHighlightLayout={item.ayah === playingAyah ? line => followHighlight(index, line) : undefined}
                />
              ) : (
                <Text
                  style={[
                    styles.arabic,
                    { fontFamily: SCRIPT_FONTS[script], fontSize: arabicFontSize, lineHeight: arabicLineHeight, color: palette.text },
                  ]}
                >
                  {item.words.map((w, i) => (
                    <Text key={w.id}>
                      <IndopakWord
                        wordId={w.id}
                        text={w.indopak}
                        highlightStyle={highlightStyle}
                        onPress={() => void play(surahId, item.ayah, w.id)}
                      />
                      {i < item.words.length - 1 ? <Text> </Text> : null}
                    </Text>
                  ))}
                  <Text style={[styles.ayahNumber, { color: palette.textMuted }]}>  ﴿{item.ayah}﴾</Text>
                </Text>
              )}

              <View style={styles.ayahFooter}>
                <Pressable
                  onPress={() => void play(surahId, item.ayah)}
                  accessibilityRole="button"
                  accessibilityLabel={`Play ayah ${item.ayah}`}
                  style={styles.ayahPlayButton}
                >
                  <PlayIcon size={12} color={palette.textMuted} />
                  <Text style={[styles.ayahPlay, { color: palette.textMuted }]}>{surahId}:{item.ayah}</Text>
                </Pressable>
              </View>
            </AyahRow>
          )}
        />
      </View>
    </View>
  );
}

// Layout only: every colour is a palette value applied at the call site, so
// the reader follows the scheme (see `theme.tsx`). The highlight stays
// `palette.highlight` — a background colour only, never a text-colour
// change, so tajweed colours remain visible under the recited word.
const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 12 },
  back: { marginLeft: -6 },
  title: { fontSize: 16, fontWeight: '600', flex: 1 },
  toggle: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  toggleText: { fontSize: 13, fontWeight: '500' },
  ayah: { paddingHorizontal: 16, paddingVertical: 10 },
  arabic: { textAlign: 'right', writingDirection: 'rtl' },
  ayahNumber: { fontSize: 16 },
  ayahFooter: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  ayahPlayButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ayahPlay: { fontSize: 13, fontVariant: ['tabular-nums'] },
  errorBanner: { paddingVertical: 8, paddingHorizontal: 16 },
  loadingBanner: { paddingVertical: 6, paddingHorizontal: 16 },
  bannerText: { fontSize: 13, textAlign: 'center' },
});
