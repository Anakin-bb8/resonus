/**
 * Floating back chevron for screens that are showing something other than
 * their content: a loading skeleton, an error.
 *
 * Those states used to render just the message, so the only way out was the
 * system's back gesture — and when the screen never settles, or the app is
 * busy enough that the gesture doesn't register, there's no way out at all
 * (issue #51). Cheap insurance: always a visible exit.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme';

export function BackButton() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <Pressable
      style={[styles.back, { top: insets.top + spacing.sm }]}
      hitSlop={12}
      accessibilityRole="button"
      onPress={() => router.back()}
    >
      <Ionicons name="chevron-back" size={28} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: spacing.lg, zIndex: 1 },
});
