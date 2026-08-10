/**
 * Every song by one artist, as a list (#139 asked for it next to "Popular").
 *
 * "Popular" is what the server thinks is worth hearing first, twenty tracks of
 * it. This is the rest: everything the artist has here, in one place, to be
 * sorted, searched, played, shuffled or picked through.
 *
 * Where the songs come from is the interesting part. No server has an endpoint
 * for "every song by this artist" that all four of them share, but every one
 * of them can list an artist's albums, and each album brings its songs. So the
 * list is built the way the artist screen already builds it to download a
 * discography: album by album, through the query cache, so an album opened a
 * minute ago costs nothing. Bounded, complete, and the same on every backend,
 * which is what a genre's songs could never be.
 *
 * And because the whole list ends up here rather than arriving a page at a
 * time, it sorts like a playlist does — the menu with a direction, and
 * "Downloaded" among the fields, neither of which a paged list can honestly
 * offer.
 */
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { COVER, coverArtUrl, getAlbum, getArtist, getAppearsOn, type Song } from '@/api/data';
import { BackButton } from '@/components/BackButton';
import { Message } from '@/components/Message';
import { TrackListSkeleton } from '@/components/TrackListSkeleton';
import { TrackListView } from '@/components/TrackListView';
import { useSongSort } from '@/hooks/useSongSort';
import { songsLabel, useT } from '@/i18n';
import { splitArtistAlbums } from '@/lib/artistAlbums';
import { formatTotalDuration } from '@/lib/format';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors } from '@/theme';

export default function ArtistSongsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const lang = useSettings((s) => s.language);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const downloadSongs = useDownloads((s) => s.downloadSongs);
  const openPlaylistPicker = usePlaylistPicker((s) => s.open);
  const toast = useToast((s) => s.show);

  // The same two queries, under the same keys, the artist screen filled on the
  // way here: arriving from its link costs nothing.
  const { data: artist } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => getArtist(id),
    enabled: canFetch && !!id,
  });
  const name = artist?.artist.name;
  const { data: appearsOn } = useQuery({
    queryKey: ['appearsOn', id],
    queryFn: () => getAppearsOn(id, name!),
    enabled: canFetch && !!id && !!name,
  });
  // The artist's own records, not the ones they only play on: those belong to
  // somebody else, and pulling a whole album in because this artist sings on
  // one track of it is not what was asked for.
  const albums = artist ? splitArtistAlbums(artist.albums, appearsOn ?? []).own : [];

  const {
    data: songs,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    // The albums are part of what is being gathered, so a discography that
    // grew is a different answer rather than a stale one.
    queryKey: ['artistSongs', id, albums.map((a) => a.id).join(',')],
    queryFn: async () => {
      const parts = await Promise.all(
        albums.map((al) =>
          queryClient
            .fetchQuery({ queryKey: ['album', al.id], queryFn: () => getAlbum(al.id) })
            .then((d) => d.songs)
            // One album that will not load is a gap, not a failure: the rest
            // of the discography is still worth showing.
            .catch(() => [] as Song[]),
        ),
      );
      return parts.flat();
    },
    enabled: canFetch && albums.length > 0,
  });

  const all = songs ?? [];
  const {
    songs: shown,
    openSort,
    sortSheet,
  } = useSongSort(all, `artistSongs:${id}`, {
    // 'recent' is the order they were gathered in: the discography newest
    // first, each record in its own running order. Named for what that is.
    fields: ['recent', 'alpha', 'downloaded'],
    labels: { recent: 'By album' },
  });

  if (isLoading || (!artist && canFetch)) return <TrackListSkeleton />;

  if (!songs || songs.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <BackButton />
        <Message
          text={isError ? t("Couldn't load songs.") : t('No songs here yet')}
          onRetry={() => void refetch()}
        />
      </View>
    );
  }

  const totalSec = all.reduce((acc, s) => acc + (s.duration ?? 0), 0);
  const meta = [t('Songs'), songsLabel(all.length, lang), formatTotalDuration(totalSec)]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <TrackListView
        title={name ?? ''}
        meta={meta}
        coverUri={coverArtUrl(id, COVER.card)}
        songs={shown}
        currentId={playing?.id}
        showArtwork={showListArtwork}
        searchable
        searchPlaceholder={t('Find a song')}
        onSort={all.length > 1 ? openSort : undefined}
        selection={{
          onAddTo: (sel) => openPlaylistPicker(sel),
          onDownload: (sel) => {
            void downloadSongs(sel);
            toast(t('Downloading…'));
          },
        }}
        onPlay={(start, opts) => playQueue(shown, start, name, `/artist/${id}`, opts)}
      />
      {sortSheet}
    </>
  );
}
