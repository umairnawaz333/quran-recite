import { Text } from 'react-native';
import { parseTajweed } from '@quran/core';
import { colourFor } from './tajweedColours';

/**
 * One word of tajweed text. React Native has no innerHTML, so the markup is
 * parsed in @quran/core and each run becomes a nested <Text> — which inherits
 * the parent's font and size, so only colour needs setting here.
 */
export function TajweedText({ markup }: { markup: string }) {
  return (
    <>
      {parseTajweed(markup).map((run, i) => {
        const colour = colourFor(run.rules);
        return (
          <Text key={i} style={colour ? { color: colour } : undefined}>
            {run.text}
          </Text>
        );
      })}
    </>
  );
}
