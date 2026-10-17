/**
 * The ⋯ menu for a podcast preview: a bottom sheet with the two things worth
 * doing to a show from here — read it fresh from the publisher, and open its
 * website. It mirrors the album's ⋯ sheet, kept small because a preview has
 * only these two actions.
 */
import Icon from '@/components/Icon';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Cover } from '@/components/Cover';
import { useT } from '@/i18n';
import { colors, fontSize, radius, SHEET_MAX_WIDTH, spacing, themed } from '@/theme';

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  coverUri?: string;
  siteUrl?: string;
  onRefresh: () => void;
  onWebsite: () => void;
  onClose: () => void;
}

export function PodcastMenuSheet({
  visible,
  title,
  subtitle,
  coverUri,
  siteUrl,
  onRefresh,
  onWebsite,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const t = useT();

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Tapping anywhere off the sheet closes it, like the album's. */}
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            {coverUri ? <Cover uri={coverUri} size={48} rounded /> : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.divider} />

          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => {
              onClose();
              onRefresh();
            }}
          >
            <Icon name="refresh" size={24} color={colors.text} />
            <Text style={styles.actionText}>{t('Refresh')}</Text>
          </Pressable>

          {siteUrl ? (
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                onClose();
                onWebsite();
              }}
            >
              <Icon name="link-outline" size={24} color={colors.text} />
              <Text style={styles.actionText}>{t('Website')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = themed((colors) => ({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill },
  sheet: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
    marginBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
}));
