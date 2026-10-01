import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Safe area insets with a top that is never zero.
 *
 * iOS reports no top inset inside a modal presentation — the full-screen modals
 * for queue and lyrics hit it, and so does a sheet. Everything that hangs its
 * own bar under the status bar (the artist bar, the track list's bar and the
 * play button docked in it) would end up *above* the bar instead of below it.
 *
 * The window's own metrics are captured at launch, which is exactly what the
 * sheet is covering, so they are the number to fall back on: the real inset
 * rather than the guess the lyrics and queue screens had to make (they keep
 * their 12, it is two lines of the same idea in a place that only needs to
 * clear a close button).
 */
export function useInsets() {
  const insets = useSafeAreaInsets();
  if (insets.top > 0) return insets;
  return { ...insets, top: initialWindowMetrics?.insets.top || 12 };
}
