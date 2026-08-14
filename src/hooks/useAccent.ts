/**
 * Current accent colour, reactive.
 *
 * Two things at once, and both matter. It subscribes, so a component repaints
 * when the accent (or the appearance) changes rather than keeping the colour it
 * was last painted in — a stack leaves screens mounted behind you, well out of
 * reach of anything else. And it hands back the theme's accent, not the one in
 * the picker: the light appearance darkens whichever colour was chosen until it
 * can be read on white (see `readableOn` in the theme), and the raw value would
 * be the one that can't.
 */
import { useTheme } from '@/theme';

export function useAccent(): string {
  return useTheme().accent;
}
