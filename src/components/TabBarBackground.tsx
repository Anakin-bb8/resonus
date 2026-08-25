/**
 * What is behind the navigation bar.
 *
 * Solid by default. With "See-through navigation bar" on, the page's own
 * colour at a fraction of itself, so a list scrolling past shows through it.
 *
 * No blur, and that is not a shortcut: the reference for this is Navic, and
 * measuring its screenshots says its bar has none either — the writing behind
 * it is perfectly sharp. What it has is a flat wash of the page colour, which
 * is what this is. Over empty background the two are the same colour and the
 * bar has no edge at all, in Navic exactly as here (sampled: its bar over
 * nothing is the page's own 19,12,12).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import { useTheme } from '@/theme';

/**
 * How the page's colour arrives: nothing at the very top edge, then one flat
 * amount the rest of the way down.
 *
 * Flat is the whole point. A ramp dims whatever passes behind the bar more at
 * the bottom than at the top, and a cover scrolling through it comes out
 * smeared along a line that belongs to nothing on screen. Measured off Navic,
 * which is what this is copying: its bar is one even wash, and the writing
 * behind it stays sharp — there is no blur in it at all.
 *
 * The dissolve at the top is 12% of the height, which at the bar's 84 points
 * is about ten of them: enough that the wash has no hard edge of its own, too
 * little to read as a ramp.
 */
const STOPS = [0, 0.12, 1] as const;
const ALPHA = [0, 0.62, 0.62] as const;

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
