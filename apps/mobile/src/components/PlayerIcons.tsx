/**
 * Transport icons as inline SVG (react-native-svg), mirroring
 * `apps/web/components/PlayerIcons.tsx` exactly so the mobile transport
 * controls read the same as the web ones instead of falling back to plain
 * text labels ("Play" / "Pause") that don't render as recognisable controls.
 *
 * A fixed 24×24 viewBox makes every control the same size regardless of
 * which icon is inside it. The web version paints every path with CSS
 * `currentColor` so a button's text colour drives the icon; React Native has
 * no such cascade, so each icon here takes an explicit `color` prop instead
 * and every call site passes the colour it would otherwise have given the
 * text label it replaces.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type IconProps = { size?: number; color: string };

export function PlayIcon({ size = 24, color }: IconProps) {
  return (
    // Bounding box spans x 7.4 → 17.4, so its centre is 12.4 — the viewBox
    // centre (12) plus a 0.4 optical nudge, because a right-pointing triangle
    // has its visual mass toward the flat edge and reads as sitting left when
    // centred exactly. The nudge belongs in the geometry; an extra CSS
    // translate on top of it just moves the icon off-centre for real.
    // Stroke with a round linejoin softens the corners symmetrically, so it
    // does not shift the centre.
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M7.4 6 17.4 12 7.4 18Z"
        fill={color}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PauseIcon({ size = 24, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="7" y="5" width="3.6" height="14" rx="1.3" fill={color} />
      <Rect x="13.4" y="5" width="3.6" height="14" rx="1.3" fill={color} />
    </Svg>
  );
}

// Prev and Next are exact mirrors about x = 12: the bar sits 5.2–7.6 on one
// side and 16.4–18.8 on the other, and the triangles reflect to match. Drawn
// independently they drifted to bbox centres of 12.6 and 11.4, which reads as
// the pair being subtly misaligned with each other and with the play button.
export function PrevIcon({ size = 24, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="5.2" y="5.8" width="2.4" height="12.4" rx="1.2" fill={color} />
      <Path
        d="M18.6 6.4 9 12 18.6 17.6Z"
        fill={color}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function NextIcon({ size = 24, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M5.4 6.4 15 12 5.4 17.6Z"
        fill={color}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Rect x="16.4" y="5.8" width="2.4" height="12.4" rx="1.2" fill={color} />
    </Svg>
  );
}

/** Same 24×24 box as the others, so swapping it in never resizes the button. */
export function SpinnerIcon({ size = 24, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth={2.5} opacity={0.25} />
      <Path
        d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * `SpinnerIcon` spinning continuously — the RN equivalent of the web's
 * `animate-spin` class, which a static SVG has no equivalent for on this
 * platform. Both transport buttons use this for their "Loading" state.
 */
export function Spinner(props: IconProps) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [rotation]);

  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <SpinnerIcon {...props} />
    </Animated.View>
  );
}
