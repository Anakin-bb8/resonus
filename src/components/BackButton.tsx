/**
 * Floating back chevron for screens that are showing something other than
 * their content: a loading skeleton, an error.
 *
 * Those states used to render just the message, so the only way out was the
 * system's back gesture — and when the screen never settles, or the app is
 * busy enough that the gesture doesn't register, there's no way out at all
 * (issue #51). Cheap insurance: always a visible exit.
 *
 * The same chevron every top bar draws, so a long press leads out of the whole
 * pile here too, which is where somebody stuck on a screen that won't load is
 * most likely to want it.
 */
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '@/theme';
import { BackChevron } from './BackChevron';

export function BackButton() {
  const insets = useSafeAreaInsets();
  return <BackChevron size={28} style={[styles.back, { top: insets.top + spacing.sm }]} />;
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: spacing.lg, zIndex: 1 },
});
