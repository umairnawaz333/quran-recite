import { useFonts } from 'expo-font';
import type { Script } from '../screens/ReaderScreen';

/**
 * Quran typefaces, bundled as app assets so the same files render identically
 * on iOS and Android. Never fetched at runtime — the app is meant to work
 * offline, and a network-loaded font is a blank page on a plane.
 *
 * Keyed by script so adding a face later is one asset and one entry here.
 */
export const FONT_ASSETS = {
  'AmiriQuran': require('../../assets/fonts/amiri-quran.ttf'),
  'NotoNaskhArabic': require('../../assets/fonts/noto-naskh-arabic.ttf'),
} as const;

export const SCRIPT_FONTS: Record<Script, string> = {
  tajweed: 'AmiriQuran',
  indopak: 'NotoNaskhArabic',
};

/**
 * `true` once the fonts are ready to use *or* loading has failed. `expo-font`
 * never flips `loaded` back to `true` after an error, so gating on `loaded`
 * alone would hold the app on a blank screen forever if a bundled font file
 * were ever missing or corrupt. Since these fonts are bundled assets (not
 * fetched), that failure should not happen in practice — but if it does, we'd
 * rather fall back to the OS's Arabic face than never render the reader.
 */
export function useQuranFonts(): boolean {
  const [loaded, error] = useFonts(FONT_ASSETS);
  return loaded || error !== null;
}
