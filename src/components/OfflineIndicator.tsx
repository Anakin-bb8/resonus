/**
 * Subtle "offline" indicator for the tab headers (Home, Library, Search).
 * It reminds why what is on screen is limited to downloads.
 * Only for server accounts in offline mode; on a local profile "offline" is
 * the normal state and doesn't need a warning, and Home marks that one with an
 * icon of its own.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { colors, fontSize, spacing } from '@/theme';

export function OfflineIndicator({ iconOnly }: { iconOnly?: boolean } = {}) {
  const t = useT();
  const offline = useAuthStore((s) => s.offline);
  const hasAccount = useAuthStore((s) => !!s.auth);
  if (!offline || !hasAccount) return null;
  // The cloud on its own where the word doesn't fit: on Home this shares its
  // line with a greeting that can be as long as somebody wants it.
  if (iconOnly) {
    return (
      <Ionicons
        name="cloud-offline-outline"
        size={22}
        color={colors.textMuted}
        accessibilityLabel={t('Offline')}
      />
    );
  }
  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel={t('Offline')}>
      <Ionicons name="cloud-offline-outline" size={14} color={colors.textMuted} />
      <Text style={styles.text}>{t('Offline')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Just dim icon + text, no background: present but not attention-grabbing, and
  // consistent on any surface (header or search bar).
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  text: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: '600' },
});
