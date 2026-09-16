import { StyleSheet, Text } from 'react-native';
import { parseTajweed } from '@quran/core';
import { colourFor } from './tajweedColours';
import { useIsActiveWord } from './activeWordStore';

/**
 * One tajweed word. React Native has no innerHTML, so the markup is parsed
 * in @quran/core and each run becomes a nested <Text> — which inherits the
 * parent's font and size, so only colour needs setting here.
 *
 * The active-word highlight is a background colour on the outer <Text>
 * wrapping every run, never a colour change on the runs themselves — tajweed
 * colours carry meaning and must stay visible under the highlight, exactly
 * as on the web (see apps/web/app/globals.css's `.word--active`).
 */
export function TajweedText({ wordId, markup }: { wordId: string; markup: string }) {
  const isActive = useIsActiveWord(wordId);
  return (
    <Text style={isActive ? styles.highlight : undefined}>
      {parseTajweed(markup).map((run, i) => {
        const colour = colourFor(run.rules);
        return (
          <Text key={i} style={colour ? { color: colour } : undefined}>
            {run.text}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  // Matches the web's `.word--active` tint (#fde68a) so both platforms
  // agree on what "currently reciting" looks like.
  highlight: { backgroundColor: '#fde68a' },
});
