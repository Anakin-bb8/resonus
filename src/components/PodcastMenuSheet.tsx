/**
 * The ⋯ menu for a podcast show: a bottom sheet with the things worth doing to
 * a show from wherever it was opened — start it, deal it, put it into the queue,
 * download every episode, read it fresh from the publisher, open its website,
 * keep it as a favourite, and take the downloaded episodes off the phone. It
 * mirrors the album's ⋯ sheet in the same order: what you do WITH the show first
 * (playback, queue), then what it takes to get it (download), then the way
 * around it (refresh, website), then where it lives (the heart), and the only
 * thing that takes something away last. It opens through `openPodcastMenu`, so
 * the same sheet opens from the show's own screen and from a long-press on a
 * show in the Library — which is why it plays at all: a row in the Library has
 * no play button, and this sheet is the way into one.
 */
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import Icon from '@/components/Icon';
import { Cover } from '@/components/Cover';
import { SheetModal } from './SheetModal';
import { COVER, coverArtUrl, type Song } from '@/api/data';
import {
  episodeToSong,
  feedErrorCode,
  refreshChannel,
  listAllEpisodes,
  downloadedForChannel,
  podcastCover,
  toggleFavoritePodcast,
  type PodcastChannel,
} from '@/api/podcasts';
import { useQuery } from '@tanstack/react-query';
import { isManualOffline } from '@/api/netGate';
import { useT } from '@/i18n';
import { invalidatePodcastCaches, invalidatePodcastFavorites } from '@/lib/query';
import { usePodcastFavoriteIds } from '@/lib/podcastFavorites';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, themed } from '@/theme';

let openMenu: ((channel: PodcastChannel) => void) | null = null;

/** Opens the sheet for a show, from wherever the show was opened. */
export function openPodcastMenu(channel: PodcastChannel): void {
  openMenu?.(channel);
}

export function PodcastMenuSheet() {
  const t = useT();
  const toast = useToast((s) => s.show);
  // The show's heart, read from the same SQLite set every surface asks for.
  const favIds = usePodcastFavoriteIds();
  // Playback too: a show in the Library has no play button, and this sheet is
  // the way into one (as the album's has Play for the same reason).
  const playQueue = usePlayerStore((s) => s.playQueue);
  const queueMany = usePlayerStore((s) => s.queueMany);
  const downloadPodcast = useDownloads((s) => s.downloadPodcast);
  const deletePodcastChannelDownloads = useDownloads(
    (s) => s.deletePodcastChannelDownloads,
  );

  const openRef = useRef<() => void>(() => {});
  const [target, setTarget] = useState<PodcastChannel | null>(null);

  useEffect(() => {
    openMenu = (channel) => {
      setTarget(channel);
      openRef.current();
    };
    return () => {
      openMenu = null;
    };
  }, []);

  // Whether this show has anything downloaded, from the record and not from
  // a loaded list: downloads sitting beyond the first page still count. The
  // download and delete actions invalidate this key when they land.
  const downloaded = useQuery({
    queryKey: ['podcastDownloads', target?.id ?? ''],
    queryFn: async () => (await downloadedForChannel(target?.id ?? '')).count,
    enabled: !!target,
    staleTime: Infinity,
  });

  const row = (
    icon: keyof typeof Icon.glyphMap,
    label: string,
    onPress: () => void,
  ) => (
    <Pressable
      key={label}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      <Icon name={icon} size={24} color={colors.text} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );

  return (
    <SheetModal openRef={openRef}>
      {(close) => {
        if (!target) return null;
        const ch = target;
        const siteUrl = ch.siteUrl;
        const hearted = favIds.has(ch.id);
        const href = `/podcast/${ch.id}`;

        /** Reads the episodes from SQLite and runs the action on them. */
        const withEpisodes = (fn: (songs: Song[]) => void) => {
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
          <>
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
            {row('play-outline', t('Play'), () => {
              close();
              withEpisodes((songs) => void playQueue(songs, 0, ch.title, href));
            })}
            {row('shuffle-outline', t('Shuffle'), () => {
              close();
              withEpisodes(
                (songs) => void playQueue(songs, 0, ch.title, href, { shuffled: true }),
              );
            })}
            {row('play-forward-outline', t('Play next'), () => {
              close();
              withEpisodes((songs) => {
                queueMany(songs, 'next');
                toast(t('Playing next'));
              });
            })}
            {row('list-outline', t('Add to queue'), () => {
              close();
              withEpisodes((songs) => {
                queueMany(songs, 'end');
                toast(t('Added to queue'));
              });
            })}

            {/* Download every episode of the show. The episodes are read from
                SQLite on the tap, so the sheet needs nothing carried to it. */}
            {row('download-outline', t('Download'), () => {
              close();
              // A download is a transfer, and a manual "use no network" makes
              // none — said here, because the transfer goes through expo-file-
              // system and the gate under the API layer cannot see it.
              if (isManualOffline()) {
                toast(t("You're offline"));
                return;
              }
              void (async () => {
                try {
                  await downloadPodcast(ch.id);
                } catch {
                  toast(t("Couldn't complete the action"));
                }
              })();
            })}

            {row('refresh', t('Refresh'), () => {
              close();
              if (!ch.feedUrl) return;
              void refreshChannel(ch.feedUrl)
                .then(() => invalidatePodcastCaches())
                .catch((e) =>
                  toast(
                    feedErrorCode(e) === 'offline'
                      ? t("You're offline")
                      : t("Couldn't read this feed"),
                  ),
                );
            })}

            {siteUrl
              ? row('link-outline', t('Website'), () => {
                  close();
                  void Linking.openURL(siteUrl).catch(() => {});
                })
              : null}

            {/* Where the show lives: its heart, filed in SQLite — the same heart
                the show's screen lights, so a show can be kept from wherever it
                was opened, as the album's sheet does with «Add to favorites». It
                sits here, not on top: the album side keeps the favorites group
                next to the thing that takes something away. */}
            {row(
              hearted ? 'heart' : 'heart-outline',
              hearted ? t('Remove from favorites') : t('Add to favorites'),
              () => {
                close();
                void (async () => {
                  try {
                    await toggleFavoritePodcast(ch.id, 'channel', ch.id);
                    invalidatePodcastFavorites();
                  } catch {
                    toast(t("Couldn't complete the action"));
                  }
                })();
              },
            )}

            {/* Last, because it is the only thing here that takes something away.
                Offered only while the show has something downloaded — the album
                sheet hides its trash action exactly the same way — and it clears
                every episode the record holds, not just the ones a loaded list
                showed (#47 on the album side). */}
            {(downloaded.data ?? 0) > 0
              ? row('trash-outline', t('Delete downloads'), () => {
                  close();
                  void (async () => {
                    try {
                      const n = await deletePodcastChannelDownloads(ch.id);
                      toast(
                        n === 0
                          ? t('Nothing here is downloaded')
                          : t('{n} episodes deleted', { n }),
                      );
                    } catch {
                      toast(t("Couldn't complete the action"));
                    }
                  })();
                })
              : null}
          </>
        );
      }}
    </SheetModal>
  );
}

const styles = themed((colors) => ({
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
