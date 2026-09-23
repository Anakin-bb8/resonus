/**
 * The blur behind the navigation bar and the mini player ("Blur behind the
 * bars", Settings › Appearance).
 *
 * On Android a BlurView can only blur what sits inside a `BlurTargetView`, and
 * never itself: the root layout wraps the Stack in one (`BarBlurTarget`) and
 * both bars are drawn next to it, outside. That is why, with this on, the tabs
 * navigator hands its own bar over to `GlobalTabBar` even on the tab screens.
 *
 * Android 12 is the floor. Below it expo-blur falls back to a flat tint, which
 * is the see-through bar that was tried and reverted (b8bb8b1): a veil tints
 * what is behind it without hiding it.
 */
import { BlurTargetView, BlurView } from 'expo-blur';
import { createRef, useRef, type ReactNode, type RefObject } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

import { useSettings } from '@/store/settings';
import { useTheme, useThemeMode } from '@/theme';

export const canBlurBars =
  Platform.OS === 'ios' || (Platform.OS === 'android' && Platform.Version >= 31);

const target = createRef<View | null>();

/** Whether the bars are see-through, blurring what scrolls under them. */
export function useBarBlur(): boolean {
  return useSettings((s) => s.blurBars) && canBlurBars;
}

type Target = RefObject<View | null>;

/**
 * What a bar blurs. Without `target`, everything the Stack draws (the root
 * layout's). A screen's own top bar lives inside that one, so it needs a
 * target of its own around the list it floats over (`useBlurTarget`).
 */
export function BarBlurTarget({ children, target: own }: { children: ReactNode; target?: Target }) {
  return (
    <BlurTargetView ref={own ?? target} style={{ flex: 1 }}>
      {children}
    </BlurTargetView>
  );
}

export function useBlurTarget(): Target {
  return useRef<View | null>(null);
}

/**
 * `tint` is laid over the blur so the bar keeps a colour of its own and its
 * labels stay legible over a bright cover: the page colour for the navigation
 * bar, the cover's for the mini player.
 */
export function BarBlur({ tint, alpha, target: own }: { tint?: string; alpha?: number; target?: Target }) {
  const colors = useTheme();
  const mode = useThemeMode();
  const a = alpha ?? (mode === 'light' ? 0.7 : 0.6);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <BlurView
        style={StyleSheet.absoluteFill}
        blurTarget={own ?? target}
        blurMethod="dimezisBlurViewSdk31Plus"
        intensity={60}
        tint={mode === 'light' ? 'light' : 'dark'}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(tint ?? colors.background, a) }]} />
    </View>
  );
}

/**
 * The background of a screen's top bar, which fades in as the header scrolls
 * away: the header's colour, solid, or over a blur of the list when the bars
 * are blurred.
 */
export function TopBarBackground({
  color,
  opacity,
  target: own,
}: {
  color: string;
  opacity: Animated.AnimatedInterpolation<number> | number;
  target: Target;
}) {
  const blur = useBarBlur();
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      {blur ? (
        <BarBlur target={own} tint={color} alpha={0.7} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: color }]} />
      )}
    </Animated.View>
  );
}

function withAlpha(hex: string, alpha: number): string {
  const n = hex.replace('#', '');
  if (n.length !== 6) return hex;
  return `rgba(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)}, ${alpha})`;
}
