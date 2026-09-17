/**
 * `react-native-svg` as host elements, for `src/components/PlayerIcons.tsx`.
 * The icons' geometry is covered elsewhere; here they only have to render.
 */
import { createElement } from 'react';
import type { ReactNode } from 'react';

type HostProps = Record<string, unknown> & { children?: ReactNode };

function host(name: string) {
  const Component = (props: HostProps) => createElement(name, props);
  Component.displayName = name;
  return Component;
}

const Svg = host('Svg');

export default Svg;
export { Svg };
export const Circle = host('Circle');
export const Path = host('Path');
export const Rect = host('Rect');
export const G = host('G');
export const Line = host('Line');
export const Defs = host('Defs');
export const ClipPath = host('ClipPath');
