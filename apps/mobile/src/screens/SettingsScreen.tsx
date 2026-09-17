import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { nativeApplicationVersion } from 'expo-application';
import { getSurahList, getSurahMeta } from '../data/surahs';
import { cancelDownload, downloadAll, downloads, refreshFromDisk, removeDownload, useDownloadedSurahs, useDownloadState } from '../offline/downloadManager';
import { surahBytesOnDisk } from '../offline/offlineStore';
import { allAudioSize, formatBytes } from '../offline/audioSizes';
import { useTheme, useThemePreference } from '../theme/theme';
import type { Palette, ThemePreference } from '../theme/theme';

const THEME_OPTIONS: { pref: ThemePreference; label: string }[] = [
  { pref: 'system', label: 'System' },
  { pref: 'light', label: 'Light' },
  { pref: 'dark', label: 'Dark' },
];

/**
 * One surah still downloading or queued, shown above the downloaded list.
 * Its own component so `useDownloadState` — a hook — runs once per surah in
 * a fixed-length list (`getSurahList()`), never inside a loop body.
 */
function InProgressRow({ surahId, name, palette }: { surahId: number; name: string; palette: Palette }) {
  const state = useDownloadState(surahId);
  if (state.status !== 'downloading' && state.status !== 'queued') return null;
  const label = state.status === 'downloading' ? `${state.done} / ${state.total}` : 'Queued';
  return (
    <View style={styles.row}>
      <Text style={[styles.rowName, { color: palette.text }]}>{name}</Text>
      <Text style={[styles.rowMeta, { color: palette.textMuted }]}>{label}</Text>
      <Pressable
        onPress={() => cancelDownload(surahId)}
        accessibilityRole="button"
        accessibilityLabel={`Cancel ${name} download`}
        style={styles.rowAction}
      >
        <Text style={[styles.action, { color: palette.textMuted }]}>Cancel</Text>
      </Pressable>
    </View>
  );
}

/** One row of the downloaded list: its size, a tap to open it, and a delete button. */
function DownloadedRow({ id, bytes, onOpenSurah, palette }: { id: number; bytes: number; onOpenSurah: (id: number) => void; palette: Palette }) {
  const name = getSurahMeta(id)?.nameSimple ?? `Surah ${id}`;
  const size = formatBytes(bytes);
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onOpenSurah(id)}
        style={styles.rowMain}
        accessibilityRole="button"
        accessibilityLabel={`Open ${name}`}
      >
        <Text style={[styles.rowName, { color: palette.text }]}>{name}</Text>
        <Text style={[styles.rowMeta, { color: palette.textMuted }]}>{size}</Text>
      </Pressable>
      <Pressable
        onPress={() => Alert.alert(`Delete ${name}?`, `Frees ${size} of storage.`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => removeDownload(id) },
        ])}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${name}`}
        style={styles.rowAction}
      >
        <Text style={[styles.action, { color: palette.errorText }]}>Delete</Text>
      </Pressable>
    </View>
  );
}

/** Settings: offline management, the theme picker and the About block (spec Task 7). */
export function SettingsScreen({ onBack, onOpenSurah }: { onBack: () => void; onOpenSurah: (id: number) => void }) {
  const { palette } = useTheme();
  const [preference, setPreference] = useThemePreference();
  const downloaded = useDownloadedSurahs();
  // Walked once per surah per render, not once for the total and again per
  // row: `DownloadedRow` takes its size as a prop rather than re-reading
  // disk itself.
  const downloadedSizes = useMemo(
    () => downloaded.map(id => ({ id, bytes: surahBytesOnDisk(id) })),
    [downloaded],
  );
  const totalBytes = downloadedSizes.reduce((sum, s) => sum + s.bytes, 0);
  const { bytes: allBytes, files: allFiles } = allAudioSize();
  const downloadAllLabel = `Download all (${formatBytes(allBytes)})`;

  const confirmDeleteAll = () => {
    Alert.alert('Delete all downloads?', `Frees ${formatBytes(totalBytes)} of storage.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete all',
        style: 'destructive',
        // Re-reads the disk at confirm time (not the `downloaded` binding
        // captured when the row was tapped): a surah that finishes
        // downloading while this dialog is open is on disk by the time this
        // fires, and must not be left behind.
        onPress: () => { refreshFromDisk(); downloads.downloaded().forEach(removeDownload); },
      },
    ]);
  };

  const confirmDownloadAll = () => {
    Alert.alert(
      'Download everything?',
      `This downloads the whole recitation — ${formatBytes(allBytes)} over ${allFiles.toLocaleString()} files. Keep the app open on Wi-Fi.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Download', onPress: downloadAll },
      ],
    );
  };

  return (
    <ScrollView style={[styles.root, { backgroundColor: palette.background }]} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={[styles.back, { color: palette.textMuted }]}>Back</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]}>Settings</Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: palette.textMuted }]}>Offline</Text>
        {getSurahList().map(s => (
          <InProgressRow key={s.id} surahId={s.id} name={s.nameSimple} palette={palette} />
        ))}
        {downloaded.length === 0 ? (
          <Text style={[styles.empty, { color: palette.textMuted }]}>No surahs downloaded yet.</Text>
        ) : (
          <>
            {downloadedSizes.map(({ id, bytes }) => (
              <DownloadedRow key={id} id={id} bytes={bytes} onOpenSurah={onOpenSurah} palette={palette} />
            ))}
            <View style={styles.totalRow}>
              <Text style={[styles.total, { color: palette.text }]}>Total: {formatBytes(totalBytes)}</Text>
              <Pressable onPress={confirmDeleteAll} accessibilityRole="button" accessibilityLabel="Delete all">
                <Text style={[styles.action, { color: palette.errorText }]}>Delete all</Text>
              </Pressable>
            </View>
          </>
        )}
        <Pressable
          onPress={confirmDownloadAll}
          accessibilityRole="button"
          accessibilityLabel={downloadAllLabel}
          style={[styles.downloadAll, { backgroundColor: palette.surface }]}
        >
          <Text style={[styles.action, { color: palette.text }]}>{downloadAllLabel}</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: palette.textMuted }]}>Appearance</Text>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map(opt => {
            const selected = preference === opt.pref;
            return (
              <Pressable
                key={opt.pref}
                onPress={() => setPreference(opt.pref)}
                accessibilityRole="button"
                accessibilityLabel={opt.label}
                accessibilityState={{ selected }}
                style={[
                  styles.themeOption,
                  { borderColor: palette.border },
                  selected && { backgroundColor: palette.accent, borderColor: palette.accent },
                ]}
              >
                <Text style={[styles.themeLabel, { color: selected ? palette.accentText : palette.text }]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: palette.textMuted }]}>About</Text>
        <Text style={[styles.about, { color: palette.text }]}>Version {nativeApplicationVersion ?? '—'}</Text>
        <Text style={[styles.about, { color: palette.textMuted }]}>Umair Nawaz 2026</Text>
      </View>
    </ScrollView>
  );
}

// Layout only — every colour comes from the palette at the call site (see `theme.tsx`).
const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16, gap: 12 },
  back: { fontSize: 15 },
  title: { fontSize: 18, fontWeight: '600' },
  section: { paddingHorizontal: 16, paddingTop: 20 },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowName: { fontSize: 15, flexShrink: 1 },
  rowMeta: { fontSize: 12 },
  rowAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  action: { fontSize: 14, fontWeight: '500' },
  empty: { fontSize: 14, paddingVertical: 8 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10 },
  total: { fontSize: 14, fontWeight: '500' },
  downloadAll: { marginTop: 14, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  themeRow: { flexDirection: 'row', gap: 10 },
  themeOption: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  themeLabel: { fontSize: 14, fontWeight: '500' },
  about: { fontSize: 14, paddingVertical: 4 },
});
