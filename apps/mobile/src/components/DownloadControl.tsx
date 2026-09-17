import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useDownloadState, startDownload, cancelDownload, removeDownload } from '../offline/downloadManager';
import { surahAudioSize, formatBytes } from '../offline/audioSizes';
import { getSurahMeta } from '../data/surahs';
import { useTheme } from '../theme/theme';

/** Three visible states (spec §9): not downloaded, downloading with progress, downloaded. */
export function DownloadControl({ surahId, compact = false }: { surahId: number; compact?: boolean }) {
  const state = useDownloadState(surahId);
  const { palette } = useTheme();
  const name = getSurahMeta(surahId)?.nameSimple ?? `Surah ${surahId}`;
  const size = formatBytes(surahAudioSize(surahId).bytes);

  if (state.status === 'downloading' || state.status === 'queued') {
    const label = state.status === 'downloading' ? `${state.done} / ${state.total}` : 'Queued';
    return (
      <Pressable onPress={() => cancelDownload(surahId)} accessibilityRole="button" accessibilityLabel="Cancel download" style={styles.control}>
        <Text style={[styles.progress, { color: palette.textMuted }]}>{label}</Text>
        <Text style={[styles.cancel, { color: palette.textMuted }]}>✕</Text>
      </Pressable>
    );
  }
  if (state.status === 'done') {
    return (
      <Pressable
        onPress={() => Alert.alert(`Delete ${name}?`, `Frees ${size} of storage.`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => removeDownload(surahId) },
        ])}
        accessibilityRole="button" accessibilityLabel="Downloaded, tap to delete" style={styles.control}
      >
        <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M5 12.5 10 17.5 19 7" stroke={palette.text} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={() => startDownload(surahId)} accessibilityRole="button" accessibilityLabel={`Download ${name} (${size})`} style={styles.control}>
      <Svg width={20} height={20} viewBox="0 0 24 24"><Path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" stroke={palette.textMuted} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" /></Svg>
      {!compact && <Text style={[styles.size, { color: palette.textMuted }]}>{size}</Text>}
      {state.status === 'error' && <Text style={[styles.size, { color: palette.errorText }]}>Retry</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 6 },
  progress: { fontSize: 12, fontVariant: ['tabular-nums'] },
  cancel: { fontSize: 14 },
  size: { fontSize: 11 },
});
