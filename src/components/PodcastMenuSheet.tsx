/**
 * The ⋯ menu for a podcast show: a bottom sheet with the things worth doing to
 * a show from wherever it was opened — start it, deal it, put it into the queue,
 * download every episode, read it fresh from the publisher, open its website,
 * keep it as a favourite, and take the downloaded episodes off the phone. It
 * mirrors the album's ⋯ sheet in the same order: what you do WITH the show first
 * (playback, queue), then what it takes to get it (download), then the way
 * around it (refresh, website), then where it lives (the heart), and the only
 * thing that takes something away last. It is store-driven (see `usePodcastMenu`),
 * so the same sheet opens from the show's own screen and from a long-press on a
 * show in the Library — which is why it plays at all: a row in the Library has
 * no play button, and this sheet is the way into one.
 */
import Icon from '@/components/Icon';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Cover } from '@/components/Cover';
import { COVER, coverArtUrl, type Song } from '@/api/data';
import {
  episodeToSong,
  feedErrorCode,
  refreshChannel,
  listAllEpisodes,
  downloadedForChannel,
  podcastCover,
  toggleFavoritePodcast,
} from '@/api/podcasts';
import { useQuery } from '@tanstack/react-query';
import { isManualOffline } from '@/api/netGate';
import { useT } from '@/i18n';
import { invalidatePodcastCaches, invalidatePodcastFavorites } from '@/lib/query';
import { usePodcastFavoriteIds } from '@/lib/podcastFavorites';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { usePodcastMenu } from '@/store/podcastMenu';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, SHEET_MAX_WIDTH, spacing, themed } from '@/theme';

export function PodcastMenuSheet() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const toast = useToast((s) => s.show);
  const ch = usePodcastMenu((s) => s.channel);
  const close = usePodcastMenu((s) => s.close);
  // The show's heart, read from the same SQLite set every surface asks for.
  const favIds = usePodcastFavoriteIds();
  // Playback too: a show in the Library has no play button, and this sheet is
  // the way into one (as the album's has Play for the same reason).
  const playQueue = usePlayerStore((s) => s.playQueue);
  const queueMany = usePlayerStore((s) => s.queueMany);

  // Whether this show has anything downloaded, from the record and not from
  // a loaded list: downloads sitting beyond the first page still count. The
  // download and delete actions invalidate this key when they land.
  const downloaded = useQuery({
    queryKey: ['podcastDownloads', ch?.id ?? ''],
    queryFn: async () => (await downloadedForChannel(ch?.id ?? '')).count,
    enabled: !!ch,
    staleTime: Infinity,
  });

  if (!ch) return null;

  const onClose = () => close();
  const siteUrl = ch.siteUrl;
  const hearted = favIds.has(ch.id);
  const href = `/podcast/${ch.id}`;

  /** Closes, reads the episodes from SQLite, and runs the action on them. */
  const withEpisodes = (fn: (songs: Song[]) => void) => {
    onClose();
    void (async () => {
      try {
        const list = await listAllEpisodes(ch.id);
        if (list.length > 0) fn(list.map((e) => episodeToSong(e, ch)));
      } catch {
        toast(t("Couldn't complete the action"));
      }
    })();
  };

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Tapping anywhere off the sheet closes it, like the album's. */}
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.grabber} />
          <View style={styles.headerRow}>
            {ch.imageUrl ? (
              <Cover
                uri={coverArtUrl(podcastCover(ch.id, ch.imageUrl), COVER.thumb)}
                size={48}
              />
            ) : null}
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

          {/* Playback first, as on the album's sheet: this is the way into a
              show long-pressed in the Library, which has no play button. The
              episodes come from SQLite, bridged to songs, and the queue takes
              them the same way it takes an album's. */}
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => withEpisodes((songs) => void playQueue(songs, 0, ch.title, href))}
          >
            <Icon name="play-outline" size={24} color={colors.text} />
            <Text style={styles.actionText}>{t('Play')}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() =>
              withEpisodes((songs) => void playQueue(songs, 0, ch.title, href, { shuffled: true }))
            }
          >
            <Icon name="shuffle-outline" size={24} color={colors.text} />
            <Text style={styles.actionText}>{t('Shuffle')}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() =>
              withEpisodes((songs) => {
                queueMany(songs, 'next');
                toast(t('Playing next'));
              })
            }
          >
            <Icon name="play-forward-outline" size={24} color={colors.text} />
            <Text style={styles.actionText}>{t('Play next')}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() =>
              withEpisodes((songs) => {
                queueMany(songs, 'end');
                toast(t('Added to queue'));
              })
            }
          >
            <Icon name="list-outline" size={24} color={colors.text} />
            <Text style={styles.actionText}>{t('Add to queue')}</Text>
          </Pressable>

          {/* Download every episode of the show. The episodes are read from
              SQLite on the tap, so the sheet needs nothing carried to it. */}
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => {
              onClose();
              // A download is a transfer, and a manual "use no network" makes
              // none — said here, because the transfer goes through expo-file-
              // system and the gate under the API layer cannot see it.
              if (isManualOffline()) {
                toast(t("You're offline"));
                return;
              }
              void (async () => {
                try {
                  await useDownloads.getState().downloadPodcast(ch.id);
                } catch {
                  toast(t("Couldn't complete the action"));
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
                .then(() => invalidatePodcastCaches())
                .catch((e) => toast(feedErrorCode(e) === 'offline' ? t("You're offline") : t("Couldn't read this feed")));
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

          {/* Where the show lives: its heart, filed in SQLite — the same heart
              the show's screen lights, so a show can be kept from wherever it
              was opened, as the album's sheet does with «Add to favorites». It
              sits here, not on top: the album side keeps the favorites group
              next to the thing that takes something away. */}
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => {
              onClose();
              void (async () => {
                try {
                  await toggleFavoritePodcast(ch.id, 'channel', ch.id);
                  invalidatePodcastFavorites();
                } catch {
                  toast(t("Couldn't complete the action"));
                }
              })();
            }}
          >
            <Icon name={hearted ? 'heart' : 'heart-outline'} size={24} color={colors.text} />
            <Text style={styles.actionText}>
              {hearted ? t('Remove from favorites') : t('Add to favorites')}
            </Text>
          </Pressable>

          {/* Last, because it is the only thing here that takes something away.
              Offered only while the show has something downloaded — the album
              sheet hides its trash action exactly the same way — and it clears
              every episode the record holds, not just the ones a loaded list
              showed (#47 on the album side). */}
          {(downloaded.data ?? 0) > 0 ? (
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                onClose();
                void (async () => {
                  try {
                    const n = await useDownloads
                      .getState()
                      .deletePodcastChannelDownloads(ch.id);
                    toast(
                      n === 0
                        ? t('Nothing here is downloaded')
                        : t('{n} episodes deleted', { n }),
                    );
                  } catch {
                    toast(t("Couldn't complete the action"));
                  }
                })();
              }}
            >
              <Icon name="trash-outline" size={24} color={colors.text} />
              <Text style={styles.actionText}>{t('Delete downloads')}</Text>
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
