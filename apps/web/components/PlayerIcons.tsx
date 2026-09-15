/**
 * Transport icons as inline SVG.
 *
 * Emoji glyphs (⏮ ⏸ ▶) were used here originally and caused two problems:
 * they render as full-colour emoji on macOS rather than monochrome symbols,
 * and because each character has a different advance width, a button sized by
 * padding around one came out a different shape for every state — the play
 * button was a visible oval. A fixed 24×24 viewBox makes every control the
 * same size regardless of which icon is inside it.
 *
 * All paths use currentColor so the button controls the colour.
 */

type IconProps = { className?: string };

const BOX = {
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  'aria-hidden': true,
  focusable: false,
} as const;

export function PlayIcon({ className }: IconProps) {
  return (
    // Bounding box spans x 7.4 → 17.4, so its centre is 12.4 — the viewBox
    // centre (12) plus a 0.4 optical nudge, because a right-pointing triangle
    // has its visual mass toward the flat edge and reads as sitting left when
    // centred exactly. The nudge belongs in the geometry; an extra CSS
    // translate on top of it just moves the icon off-centre for real.
    // Stroke with a round linejoin softens the corners symmetrically, so it
    // does not shift the centre.
    <svg viewBox="0 0 24 24" aria-hidden focusable={false} className={className}>
      <path
        d="M7.4 6 17.4 12 7.4 18Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg {...BOX} className={className}>
      <rect x="7" y="5" width="3.6" height="14" rx="1.3" />
      <rect x="13.4" y="5" width="3.6" height="14" rx="1.3" />
    </svg>
  );
}

// Prev and Next are exact mirrors about x = 12: the bar sits 5.2–7.6 on one
// side and 16.4–18.8 on the other, and the triangles reflect to match. Drawn
// independently they drifted to bbox centres of 12.6 and 11.4, which reads as
// the pair being subtly misaligned with each other and with the play button.
export function PrevIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable={false} className={className}>
      <rect x="5.2" y="5.8" width="2.4" height="12.4" rx="1.2" fill="currentColor" />
      <path
        d="M18.6 6.4 9 12 18.6 17.6Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NextIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable={false} className={className}>
      <path
        d="M5.4 6.4 15 12 5.4 17.6Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect x="16.4" y="5.8" width="2.4" height="12.4" rx="1.2" fill="currentColor" />
    </svg>
  );
}

/** Same 24×24 box as the others, so swapping it in never resizes the button. */
export function SpinnerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden focusable={false} className={className}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function VolumeIcon({ className }: IconProps) {
  return (
    <svg {...BOX} className={className}>
      <path d="M11 4.6 6.9 8H4.4A1.4 1.4 0 0 0 3 9.4v5.2A1.4 1.4 0 0 0 4.4 16h2.5l4.1 3.4a.9.9 0 0 0 1.5-.7V5.3a.9.9 0 0 0-1.5-.7Z" />
      <path
        d="M15.8 9.2a4 4 0 0 1 0 5.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M18.4 6.6a7.6 7.6 0 0 1 0 10.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
