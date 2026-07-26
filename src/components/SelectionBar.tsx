/**
 * Floating action bar for multi-select, above the mini player (at toast
 * height). Shared so every screen with selection shows the same bar in the
 * same place: it lives here rather than in `TrackListView` because screens
 * that build their own list (a genre's songs) need it too.
 *
 * With nothing marked the actions stay visible but dimmed and disabled: they
 * say what selecting is FOR, which an empty bar wouldn't.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontSize, spacing } from '@/theme';

export interface SelectionAction {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}

export function SelectionBar({ actions, count }: { actions: SelectionAction[]; count: number }) {
  const insets = useSafeAreaInsets();
  if (actions.length === 0) return null;
  return (
    <View style={[styles.bar, { bottom: insets.bottom + 96 }]}>
      {actions.map((a) => (
        <Pressable
          key={a.label}
          style={({ pressed }) => [styles.action, (pressed || count === 0) && { opacity: 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          disabled={count === 0}
          onPress={a.onPress}
        >
          <Ionicons name={a.icon} size={22} color={colors.text} />
          <Text style={styles.label} numberOfLines={1}>
            {a.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    flexDirection: 'row',
    backgroundColor: '#2E2E2E',
    borderRadius: 16,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  label: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
});
