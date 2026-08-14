/**
 * Floating action bar for multi-select, above the mini player and at the same
 * height as the toast. Shared so every screen with selection shows the same
 * bar in the same place: it lives here rather than in `TrackListView` because
 * screens that build their own list (a genre's songs) need it too.
 *
 * How high is not a number of its own but `useFloatingBottom`, which is what
 * "clear of the mini player while there is one, and of the navigation bar
 * where there is one" means in one place. It used to be a constant, and it was
 * 24 px short of the mini player once the navigation bar was on: the actions
 * were there and partly behind it, which is the combination people actually
 * run. Then it followed the padding the lists reserve, which always keeps the
 * mini player's room whether or not anything is playing, and on a quiet screen
 * left the bar floating with a hole under it.
 *
 * With nothing marked the actions stay visible but dimmed and disabled: they
 * say what selecting is FOR, which an empty bar wouldn't.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';

import { useFloatingBottom } from '@/hooks/useScreenBottomPadding';
import { colors, fontSize, spacing, themed } from '@/theme';

export interface SelectionAction {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}

export function SelectionBar({ actions, count }: { actions: SelectionAction[]; count: number }) {
  const bottom = useFloatingBottom();
  if (actions.length === 0) return null;
  return (
    <View style={[styles.bar, { bottom }]}>
      {actions.map((a) => (
        <Pressable
          key={a.label}
          style={({ pressed }) => [styles.action, (pressed || count === 0) && { opacity: 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          disabled={count === 0}
          onPress={a.onPress}
        >
          <Ionicons name={a.icon} size={22} color={colors.onSnackbar} />
          <Text style={styles.label} numberOfLines={1}>
            {a.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = themed((colors) => ({
  bar: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    flexDirection: 'row',
    backgroundColor: colors.snackbar,
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
    color: colors.onSnackbar,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
}));
