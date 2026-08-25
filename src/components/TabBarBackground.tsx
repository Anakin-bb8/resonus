/**
 * What is behind the navigation bar.
 *
 * Solid by default, and with "See-through navigation bar" on, a gradient that
 * runs from nothing at the top to the page's own colour at the bottom: the
 * list keeps going under it instead of stopping at a line, and the labels
 * still sit on something opaque enough to read.
 *
 * A gradient rather than one flat wash of half-transparent colour, because a
 * flat one has a hard edge along its top and that edge IS a line — the same
 * line the setting is there to get rid of. And a gradient rather than a real
 * blur because `expo-blur` is a native module: it would mean a new build for
 * something the lists spend most of their time not even scrolling under (they
 * reserve this height, so what is behind the bar is usually the background).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import { useTheme } from '@/theme';

/**
 * How the page's colour arrives. Nothing at the very top, most of the way
 * there by the time the icons start, and all but solid under the labels.
 */
const STOPS = [0, 0.45, 1] as const;
const ALPHA = [0, 0.72, 0.96] as const;

/** `#RRGGBB` at a given alpha, for the two ends of the gradient. */
function fade(hex: string, alpha: number): string {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function TabBarBackground() {
  const colors = useTheme();
  return (
    <LinearGradient
      style={StyleSheet.absoluteFill}
      colors={ALPHA.map((a) => fade(colors.background, a)) as unknown as [string, string, string]}
      locations={STOPS as unknown as [number, number, number]}
      pointerEvents="none"
    />
  );
}
