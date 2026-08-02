import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MINI_PLAYER_HEIGHT, spacing, TAB_BAR_HEIGHT } from '@/theme';
import { useTabBarShown } from './useTabBar';

/**
 * Bottom space that a list or scroll view must reserve to avoid being covered
 * by the floating MiniPlayer (and, where there is one, by the navigation bar).
 *
 * Replaces the fixed SCREEN_BOTTOM_PADDING constant, which ignored the bottom
 * safe area: with 3-button navigation (or large screens/fonts) that inset grows
 * and the MiniPlayer would end up covering the last item.
 *
 * The calculation mirrors the MiniPlayer position in `GlobalMiniPlayer`: above
 * the navigation bar wherever there is one, and at the bottom otherwise.
 */
export function useScreenBottomPadding(): number {
  const insets = useSafeAreaInsets();
  const withBar = useTabBarShown();
  const miniBottom = withBar ? TAB_BAR_HEIGHT + insets.bottom : insets.bottom + spacing.sm;
  return miniBottom + MINI_PLAYER_HEIGHT + spacing.md;
}
