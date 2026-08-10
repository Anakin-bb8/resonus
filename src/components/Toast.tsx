/** Brief pill-shaped message at the bottom (Spotify style). */
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing } from '@/theme';

export function Toast() {
  const message = useToast((s) => s.message);
  const actionLabel = useToast((s) => s.actionLabel);
  const runAction = useToast((s) => s.runAction);
  const hide = useToast((s) => s.hide);
  // The same room every list leaves at its foot: clear of the mini player, and
  // of the navigation bar where there is one. The constant this replaces was
  // 24 px short of the mini player with that bar on, so the message sat partly
  // behind it.
  const bottom = useScreenBottomPadding();

  useEffect(() => {
    if (!message) return;
    // With an action ("Undo") we give more time to react.
    const id = setTimeout(hide, actionLabel ? 4000 : 2600);
    return () => clearTimeout(id);
  }, [message, actionLabel, hide]);

  if (!message) return null;

  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.pill, actionLabel ? styles.pillRow : null, { bottom }]}
      // Without an action the toast is purely informational and shouldn't steal touches.
      pointerEvents={actionLabel ? 'box-none' : 'none'}
    >
      <Text style={[styles.text, actionLabel ? styles.textLeft : null]} numberOfLines={2}>
        {message}
      </Text>
      {actionLabel ? (
        <Pressable
          hitSlop={12}
          accessibilityRole="button"
          onPress={() => {
            runAction?.();
            hide();
          }}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          {/* Inline accent, not in the stylesheet: this module is imported at
              startup, BEFORE hydrating settings, so the stylesheet value would
              be frozen to the default green forever. */}
          <Text style={[styles.action, { color: colors.accent }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    backgroundColor: '#2E2E2E',
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  pillRow: { flexDirection: 'row', gap: spacing.lg },
  text: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  textLeft: { flex: 1 },
  action: { fontSize: fontSize.sm, fontWeight: '700' },
});
