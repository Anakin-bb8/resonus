/**
 * The ⋯ menu for a podcast show: a bottom sheet with the things worth doing to
 * a show from wherever it was opened — read it fresh from the publisher, open
 * its website, and download every episode. It mirrors the album's ⋯ sheet, kept
 * small because a show has only these. It is store-driven (see `usePodcastMenu`),
 * so the same sheet opens from the show's own screen and from a long-press on a
 * show in the Library.
 */
import Icon from '@/components/Icon';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Cover } from '@/components/Cover';
import { refreshChannel, listEpisodes } from '@/api/podcasts';
import { useT } from '@/i18n';
import { queryClient } from '@/lib/query';
import { useDownloads } from '@/store/downloads';
import { usePodcastMenu } from '@/store/podcastMenu';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, SHEET_MAX_WIDTH, spacing, themed } from '@/theme';

export function PodcastMenuSheet() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const toast = useToast((s) => s.show);
  const ch = usePodcastMenu((s) => s.channel);
  const close = usePodcastMenu((s) => s.close);

  if (!ch) return null;

  const onClose = () => close();
  const siteUrl = ch.siteUrl;

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Tapping anywhere off the sheet closes it, like the album's. */}
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            {ch.imageUrl ? <Cover uri={ch.imageUrl} size={48} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {ch.title}
              </Text>
              {ch.author ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {ch.author}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.divider} />

          {/* Download every episode of the show. The episodes are read from
              SQLite on the tap, so the sheet needs nothing carried to it. */}
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => {
              onClose();
              void (async () => {
                try {
                  await useDownloads.getState().downloadPodcast(ch.id, await listEpisodes(ch.id));
                } catch {
                  toast(t("Couldn't download this show."));
                }
              })();
            }}
          >
            <Icon name="download-outline" size={24} color={colors.text} />
            <Text style={styles.actionText}>{t('Download')}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => {
              onClose();
              if (!ch.feedUrl) return;
              void refreshChannel(ch.feedUrl)
                .then(() => queryClient.invalidateQueries({ queryKey: ['podcast'] }))
                .catch(() => toast(t("Couldn't read this feed.")));
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
                void Linking.openURL(siteUrl).catch(() => {});
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
