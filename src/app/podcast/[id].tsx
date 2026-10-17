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
import { useState } from 'react';
import { Linking, View } from 'react-native';

import {
  episodeToSong,
  favoriteIds,
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
import { PodcastMenuSheet } from '@/components/PodcastMenuSheet';
import { episodesLabel, useT } from '@/i18n';
import { formatTotalDuration } from '@/lib/format';
import { queryClient } from '@/lib/query';
import { useSettings } from '@/store/settings';
import { currentSong, usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, useTheme } from '@/theme';

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
  const toast = useToast((s) => s.show);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const playingId = usePlayerStore((s) => currentSong(s)?.id);
  const [menuOpen, setMenuOpen] = useState(false);

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
      if (feedUrl && Date.now() - (ch.refreshedAt ?? 0) > STALE_MS) {
        void refreshChannel(feedUrl)
          .then(() => queryClient.invalidateQueries({ queryKey: ['podcast', id] }))
          .catch(() => {});
      }
      const episodes = await listEpisodes(ch.id);
      return { channel: ch, episodes };
    },
    enabled: !!id,
    staleTime: Infinity,
  });

  // The hearts, so the favorite pill can show whether this show is hearted.
  const favorites = useQuery({ queryKey: ['podcastFavorites'], queryFn: favoriteIds });
  const favSet = favorites.data ?? new Set<string>();

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
  const siteUrl = ch.siteUrl;

  // The episodes, bridged to songs so the album renderer can list and play them.
  const songs = list.map((e) => episodeToSong(e, ch));

  const play = (start: number) => {
    void playQueue(songs, start, ch.title, `/podcast/${id}`);
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
    <>
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
        // album wires it. It is a placeholder for now: podcast downloading gets
        // its real logic later.
        download={{ status: 'none', progress: 0, onPress: () => {} }}
        // The ⋯ opens the show's own sheet: refresh and website.
        onMenu={() => setMenuOpen(true)}
        emptyState={
          <EmptyState
            icon="headset-outline"
            title={t('No episodes')}
            subtitle={t('This show has nothing to play yet.')}
          />
        }
        onPlay={play}
      />
      <PodcastMenuSheet
        visible={menuOpen}
        title={ch.title}
        subtitle={ch.author}
        coverUri={coverArtUrl(ch.imageUrl, COVER.thumb)}
        siteUrl={siteUrl}
        // Refresh re-reads the feed and updates SQLite, then the surface.
        onRefresh={() => {
          if (!ch.feedUrl) return;
          void refreshChannel(ch.feedUrl)
            .then(() => queryClient.invalidateQueries({ queryKey: ['podcast', id] }))
            .catch(() => toast(t("Couldn't read this feed.")));
        }}
        onWebsite={() => {
          if (siteUrl) void Linking.openURL(siteUrl).catch(() => {});
        }}
        onClose={() => setMenuOpen(false)}
      />
    </>
  );
}
