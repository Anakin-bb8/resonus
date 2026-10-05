import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Safe area insets with a top that is never zero.
 *
 * iOS reports no top inset inside a modal presentation — the full-screen modals
 * for queue and lyrics hit it and keep their own 12 for it. Everything that
 * hangs its own bar under the status bar (the artist bar, the track list's bar
 * and the play button docked in it) would end up *above* the bar instead of
 * below it, so those take the window's own metrics, captured at launch: the
 * real inset rather than a guess.
 */
export function useInsets() {
  const insets = useSafeAreaInsets();
  if (insets.top > 0) return insets;
  return { ...insets, top: initialWindowMetrics?.insets.top || 12 };
}
