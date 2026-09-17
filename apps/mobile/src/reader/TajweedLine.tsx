import { useMemo } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
// Deliberately a relative import, not a package-name one: `create-expo-
// module --local` gives a local module (apps/mobile/modules/*) no
// package.json and creates no node_modules entry for it — CNG's autolinking
// discovers it natively by scanning for expo-module.config.json, but on the
// JS side it is only ever reachable by relative path. This matches the
// import the scaffolding CLI itself printed when the module was created.
import { TajweedTextView } from '../../modules/tajweed-text/src';
import { useActiveWordAmong } from './activeWordStore';
import { buildTajweedLine, type TajweedLineWord } from './buildTajweedLine';
import { colourFor } from './tajweedColours';
import { parseTajweed } from '@quran/core';
import type { TajweedLineContent, WordRange } from './buildTajweedLine';

const EMPTY_LINE: TajweedLineContent = { text: '', ranges: [], highlight: null, words: [] };

/**
 * Renders one ayah's tajweed text. Android and iOS take genuinely different
 * paths — this is the one call site that switches between them (see the
 * task brief for why): iOS already shapes cursive Arabic correctly through
 * RN's own `<Text>`, nested one level per coloured run, unchanged from
 * before this file existed. Android renders a single native span view
 * instead, because that nesting breaks cursive joining on Android by
 * construction (RN sets a `MetricAffectingSpan` on every fragment) — see
 * `TajweedTextView.kt`'s class doc for the full mechanism.
 */
export function TajweedLine({
  words, ayahNumber, fontFamily, fontSize, lineHeight, color, width, onWordPress, onHighlightLayout,
}: {
  words: TajweedLineWord[];
  ayahNumber: number;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  color: string;
  /** The line's width in dp — the reader's column minus its row padding. Android only; iOS lays out from the row. */
  width: number;
  /** Tapping a word — start reciting from it, as clicking a word does on the web. */
  onWordPress?: (wordId: string) => void;
  /**
   * Android only: where the highlighted word's line sits within this view,
   * in dp from its top, whenever the highlight moves. Lets the reader keep
   * the recited LINE — not just the ayah — centred in a long ayah.
   */
  onHighlightLayout?: (line: { top: number; bottom: number }) => void;
}) {
  // Subscribe to "this ayah's active word, or null" rather than the global
  // active word: the store re-renders this component only when that value
  // changes, so a word tick re-renders the two ayahs it concerns, not every
  // ayah of a surah rendered in full (spec §8).
  const wordIds = useMemo(() => new Set(words.map(w => w.id)), [words]);
  const ownActiveWordId = useActiveWordAmong(wordIds);
  const activeWordId = ownActiveWordId;

  // Only Android needs the single-string form — iOS renders straight from
  // `words` below — so skip building it there rather than doing the work on
  // every recite tick for a platform that never reads the result.
  const line = useMemo(
    () => (Platform.OS === 'android'
      ? buildTajweedLine(words, ayahNumber, ownActiveWordId)
      : EMPTY_LINE),
    [words, ayahNumber, ownActiveWordId],
  );

  if (Platform.OS === 'android') {
    return (
      <TajweedTextView
        // An explicit width, in dp, from the reader's current column. The
        // native view reports its measured size (width AND height) into the
        // shadow tree so Yoga can size a self-measuring view; without an
        // explicit width that report pinned the width to whatever it was
        // first measured at, so after a rotation the text kept its portrait
        // width and sat left of a wider column. (A percentage width did
        // not work here — it resolved to a one-word column.)
        style={{ width }}
        text={line.text}
        ranges={line.ranges}
        highlight={line.highlight}
        fontFamily={fontFamily}
        fontSize={fontSize}
        lineHeight={lineHeight}
        color={color}
        onCharacterPress={onWordPress ? (e) => {
          const wordId = wordAtOffset(line.words, e.nativeEvent.offset);
          if (wordId) onWordPress(wordId);
        } : undefined}
        onHighlightLayout={onHighlightLayout ? (e) => onHighlightLayout(e.nativeEvent) : undefined}
      />
    );
  }

  // iOS: RN's own <Text> nesting already shapes correctly (NSAttributedString
  // + CoreText, one string, colour as a non-metric attribute) — unchanged.
  return (
    <Text style={[styles.arabic, { fontFamily, fontSize, lineHeight, color }]}>
      {words.map((w, i) => (
        <Text key={w.id}>
          <Text
            style={activeWordId === w.id ? styles.highlight : undefined}
            onPress={onWordPress ? () => onWordPress(w.id) : undefined}
          >
            {parseTajweed(w.tajweed).map((run, j) => {
              const runColour = colourFor(run.rules);
              return (
                <Text key={j} style={runColour ? { color: runColour } : undefined}>
                  {run.text}
                </Text>
              );
            })}
          </Text>
          {i < words.length - 1 ? ' ' : null}
        </Text>
      ))}
      <Text style={styles.ayahNumber}>  ﴿{ayahNumber}﴾</Text>
    </Text>
  );
}

/**
 * Resolves a tapped character offset to the word it falls in. A tap on the
 * space between two words, or on the trailing ayah marker, belongs to no
 * word and returns null rather than guessing.
 */
export function wordAtOffset(words: WordRange[], offset: number): string | null {
  for (const w of words) {
    if (offset >= w.start && offset < w.end) return w.id;
  }
  return null;
}

const styles = StyleSheet.create({
  arabic: { textAlign: 'right', writingDirection: 'rtl' },
  ayahNumber: { color: '#999' },
  // Matches the web's `.word--active` tint (#fde68a) — a background colour
  // only, never a text-colour change, so tajweed colours stay visible.
  highlight: { backgroundColor: '#fde68a' },
});
