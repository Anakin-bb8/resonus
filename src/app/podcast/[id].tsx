/**
 * One podcast and its episodes — a first-class entity, drawn by the album's
 * renderer so it behaves like an album: big cover that scrolls away, a sticky
 * bar with the name, the action row, the ⋯ menu.
 *
 * SQLite is the store, iTunes is the refresh. Opening a show reads it from
 * SQLite; if it was never opened it is read from the publisher and filed there.
 * A show whose last write is older than three days is re-read in the background
 * and the surface updated once it lands. Nothing is subscribed: opening lands it.
 */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import {
  episodeToSong,
  getChannel,
  getStoredChannel,
  listEpisodes,
  refreshChannel,
  type PodcastChannel,
} from '@/api/podcasts';
import { COVER, coverArtUrl } from '@/api/data';
import { BackButton } from '@/components/BackButton';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { TrackListSkeleton } from '@/components/TrackListSkeleton';
import { TrackListView } from '@/components/TrackListView';
import { usePodcastMenu } from '@/store/podcastMenu';
import { episodesLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { usePodcastFavoriteIds } from '@/lib/podcastFavorites';
import { invalidatePodcastCaches } from '@/lib/query';
import { useSettings } from '@/store/settings';
import { currentSong, usePlayerStore } from '@/store/player';
import { groupDownloadState, useDownloads } from '@/store/downloads';
import { useAuthStore } from '@/store/auth';
import { colors, useTheme } from '@/theme';
import { useShallow } from 'zustand/react/shallow';

/** A show older than this is quietly re-read from the publisher on opening. */
const STALE_MS = 1000 * 60 * 60 * 72;

/** The route id is either a stored channel id or a percent-encoded feed URL. */
function isFeedUrl(id: string): boolean {
  return /^https?:\/\//i.test(decodeURIComponent(id));
}

export default function PodcastScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const lang = useSettings((s) => s.language);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const playingId = usePlayerStore((s) => currentSong(s)?.id);
  const offline = useAuthStore((s) => s.offline);

  // SQLite first. A show never opened is read from the publisher and filed; a
  // show written more than three days ago is served from SQLite now and re-read
  // in the background, which invalidates this query once the new data lands.
  const data = useQuery({
    queryKey: ['podcast', id],
    queryFn: async () => {
      let ch: PodcastChannel | undefined;
      let feedUrl: string | undefined;
      if (isFeedUrl(id)) {
        feedUrl = decodeURIComponent(id);
        ch = await getStoredChannel(feedUrl);
        if (!ch) ch = await refreshChannel(feedUrl);
      } else {
        ch = await getChannel(id);
        feedUrl = ch?.feedUrl;
      }
      if (!ch) return null;
      if (!offline && feedUrl && Date.now() - (ch.refreshedAt ?? 0) > STALE_MS) {
        void refreshChannel(feedUrl)
          .then(() => invalidatePodcastCaches())
          .catch(() => {});
      }
      const episodes = await listEpisodes(ch.id);
      return { channel: ch, episodes };
    },
    enabled: !!id,
    staleTime: Infinity,
  });

  // The hearts, so the favorite pill can show whether this show is hearted.
  const favSet = usePodcastFavoriteIds();

  // The show's download, read the way an album's is: the same `files` map the
  // player uses, keyed by episode id, so "done" means every episode is on disk.
  const episodeIds = data.data?.episodes.map((e) => e.id) ?? [];
  const download = useDownloads(
    useShallow((s) => groupDownloadState(s, `podcast:${data.data?.channel?.id ?? id}`, episodeIds)),
  );
  const downloadPodcast = useDownloads((s) => s.downloadPodcast);
  const cancelDownload = useDownloads((s) => s.cancelDownload);
  const deletePodcastDownloads = useDownloads((s) => s.deletePodcastDownloads);

  if (data.isLoading) {
    return <TrackListSkeleton />;
  }

  if (data.isError || !data.data) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}>
        <BackButton />
        <Message text={t("Couldn't load this podcast.")} onRetry={() => data.refetch()} />
      </View>
    );
  }

  const ch = data.data.channel;
  const list = data.data.episodes;

  // The episodes, bridged to songs so the album renderer can list and play them.
  const songs = list.map((e) => episodeToSong(e, ch));

  // The play button hands the show over in feed order (newest first); the
  // shuffle button asks for the same list dealt (`shuffled`), which playQueue
  // honors without turning the shuffle mode on.
  const play = (start: number, opts?: { shuffled?: boolean }) => {
    void playQueue(songs, start, ch.title, `/podcast/${id}`, opts);
  };

  // The metadata line, built the way an album's reads: what it is, how many
  // episodes, and how long they add up to.
  const totalSec = list.reduce((acc, e) => acc + (e.duration ?? 0), 0);
  const meta = [
    t('Podcast'),
    episodesLabel(ch.episodeCount ?? list.length, lang),
    totalSec > 0 ? formatTotalDuration(totalSec) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <TrackListView
        title={ch.title}
        subtitle={ch.author}
        description={ch.description}
        meta={meta}
        coverUri={coverArtUrl(ch.imageUrl, COVER.card)}
        songs={songs}
        currentId={playingId}
        // The heart marks the show as a favorite — the user's own heart, kept on
        // the device (SQLite), which is what puts it in the Library's shelf.
        favorite={{ id: ch.id, type: 'song', starred: favSet.has(ch.id), podcast: true }}
        // The episodes' hearts read from the same SQLite favorites.
        podcastFavIds={favSet}
        // The download button sits in the album's action row, exactly as an
        // album wires it: tapping downloads every episode of the show, tapping
        // again removes them, and while it runs a stop cancels it. Hidden when
        // offline, since a download is a transfer and offline makes none.
        download={
          !offline
            ? {
                ...download,
                onPress: () => {
                  if (download.status === 'done') void deletePodcastDownloads(episodeIds);
                  else if (download.status === 'active') cancelDownload(`podcast:${ch.id}`);
                  else void downloadPodcast(ch.id, list);
                },
              }
            : undefined
        }
        // The ⋯ opens the show's own sheet (store-driven, mounted globally).
        onMenu={() => usePodcastMenu.getState().open(ch)}
        emptyState={
          <EmptyState icon="headset-outline" title={t('No episodes')} />
        }
        onPlay={play}
      />
  );
}
