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

import { useTheme, useThemeMode } from '@/theme';

/**
 * How much of the page's colour, and it is not the same answer in both
 * appearances.
 *
 * A wash does not hide what is behind it, it only pulls it towards its own
 * colour — and that is worth very different amounts depending on which colour
 * that is. Under the dark appearance the wash is near-black, so an album title
 * passing behind the bar is pulled towards black along with everything else,
 * and the bar's own white labels win by a mile. Under the light one the wash
 * is white, and white does nothing to dark writing: the title behind stays as
 * legible as the label in front of it, and two rows of text at the same height
 * is what "it looks mixed up" means.
 *
 * So the light appearance needs nearly all of it. The setting is still worth
 * having there — a cover's colour comes through, and the edge goes — but the
 * see-through part of it is a hint rather than the effect it is in the dark.
 * Making it more than a hint needs a real blur, which is the thing that
 * actually destroys the detail behind rather than tinting it, and that is a
 * native module and a new build.
 */
const ALPHA_DARK = 0.72;
const ALPHA_LIGHT = 0.9;

/**
 * Where it arrives: nothing at the very top edge, then flat the rest of the
 * way down. Flat is the point — a ramp dims what passes behind more at the
 * bottom than at the top, and a cover scrolling through comes out smeared
 * along a line that belongs to nothing on screen. The dissolve is a tenth of
 * the height, about ten points of the bar's eighty-four: enough that the wash
 * has no hard edge of its own, too little to read as a ramp.
 */
const STOPS = [0, 0.12, 1] as const;

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
  const mode = useThemeMode();
  const a = mode === 'light' ? ALPHA_LIGHT : ALPHA_DARK;
  return (
    <LinearGradient
      style={StyleSheet.absoluteFill}
      colors={
        [0, a, a].map((v) => fade(colors.background, v)) as unknown as [string, string, string]
      }
      locations={STOPS as unknown as [number, number, number]}
      pointerEvents="none"
    />
  );
}
