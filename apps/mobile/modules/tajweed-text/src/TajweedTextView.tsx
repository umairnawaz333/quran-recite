import { requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';

import type { TajweedTextViewProps } from './TajweedText.types';

/**
 * The native span view (Android only — see `apps/mobile/src/reader/
 * TajweedLine.tsx` for the platform switch). One `SpannableString`, one
 * typeface, one text size, with tajweed colour and the playback highlight
 * applied as `ForegroundColorSpan`/`BackgroundColorSpan` character ranges —
 * the Android equivalent of the single `NSAttributedString` iOS already
 * shapes correctly through RN's own `<Text>`.
 */
export const TajweedTextView: ComponentType<TajweedTextViewProps> = requireNativeViewManager(
  'TajweedText',
  'TajweedTextView',
);
