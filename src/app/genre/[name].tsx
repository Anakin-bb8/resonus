/**
 * A genre: its albums (grid or list) and its songs, with infinite scroll.
 *
 * Both views matter because genre tags live per FILE: an album tagged "Rock"
 * can hold songs tagged otherwise, and a song of this genre can sit inside an
 * album that isn't. Albums alone would only ever show half the picture.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAlbumsByGenre, getSongsByGenre } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { playShuffle } from '@/lib/playShuffle';
import { AlbumCard } from '@/components/AlbumCard';
import { AlbumCardsSkeleton } from '@/components/AlbumCardsSkeleton';
import { AlbumRow } from '@/components/AlbumRow';
import { AlbumRowsSkeleton } from '@/components/AlbumRowsSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { SelectionBar } from '@/components/SelectionBar';
import { TrackRow } from '@/components/TrackRow';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';
import { haptic } from '@/lib/haptics';
import { listPerf } from '@/lib/listPerf';

const PAGE = 30;
const SONG_PAGE = 50;
const COLUMNS = 2;
const GAP = spacing.sm;
const CARD = (Dimensions.get('window').width - spacing.lg * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

/** Songs fetched when pressing play: the same cap as the library shuffle, for
 *  the same reason (a queue of thousands is unusable). */
const PLAY_SIZE = 200;

export default function GenreScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const genre = decodeURIComponent(name ?? '');
  const router = useRouter();
  const t = useT();
  const auth = useAuthStore((s) => s.auth);
  const toast = useToast((s) => s.show);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const layout = useSettings((s) => s.genreLayout);
  const setLayout = useSettings((s) => s.setGenreLayout);
  const grid = layout === 'grid';
  const [tab, setTab] = useState<'albums' | 'songs'>('albums');
  // Without this, tapping and hearing nothing for half a second feels broken.
  const [starting, setStarting] = useState(false);
  const offline = useAuthStore((s) => s.offline);
  const downloadSongs = useDownloads((s) => s.downloadSongs);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  // The picker is mounted once in the root layout; screens just hand it songs.
  const openPlaylistPicker = usePlaylistPicker((s) => s.open);

  // ── Multi-select ────────────────────────────────────────────────────────
  // Same as the album and playlist lists: null = normal, a Set (even empty) =
  // selecting. See `TrackListView`, which does this over its own list.
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const selecting = selectedIds !== null;
  // Id that just entered selection via long-press: the `onPress` of that same
  // gesture arrives with selection already on and would undo it.
  const justLongPressed = useRef<string | null>(null);

  function toggleSelect(id: string) {
    setSelectedIds((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Runs an action with the marked songs and leaves selection mode. */
  function runSelection(fn: (sel: Song[]) => void) {
    const sel = songs.filter((s) => selectedIds?.has(s.id));
    setSelectedIds(null);
    if (sel.length > 0) fn(sel);
  }

  const href = `/genre/${encodeURIComponent(genre)}`;

  /** Play and shuffle draw from the SAME pool (the genre's songs), one in the
   *  server's order and the other at random, so both mean the same thing in
   *  either tab and neither has to expand album by album. */
  async function onPlay() {
    if (starting) return;
    setStarting(true);
    try {
      const songs = await getSongsByGenre(genre, PLAY_SIZE, 0);
      if (songs.length === 0) {
        toast(t('Nothing to shuffle yet'));
        return;
      }
      await playQueue(songs, 0, genre, href);
    } catch {
      toast(t("Couldn't load songs."));
    } finally {
      setStarting(false);
    }
  }

  async function onShuffle() {
    if (starting) return;
    setStarting(true);
    try {
      await playShuffle(genre);
    } finally {
      setStarting(false);
    }
  }

  const albumsQuery = useInfiniteQuery({
    queryKey: ['genreAlbums', genre],
    queryFn: ({ pageParam }) => getAlbumsByGenre(genre, PAGE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length * PAGE : undefined),
    enabled: !!auth && !!genre && tab === 'albums',
  });

  const songsQuery = useInfiniteQuery({
    queryKey: ['genreSongs', genre],
    queryFn: ({ pageParam }) => getSongsByGenre(genre, SONG_PAGE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.length === SONG_PAGE ? pages.length * SONG_PAGE : undefined,
    enabled: !!auth && !!genre && tab === 'songs',
  });

  const albums = albumsQuery.data?.pages.flat() ?? [];
  const songs = songsQuery.data?.pages.flat() ?? [];
  const query = tab === 'albums' ? albumsQuery : songsQuery;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* While selecting, the header turns into ✕ + counter + select all, the
          same swap the album and playlist lists do. */}
      <View style={styles.header}>
        <Pressable
          hitSlop={10}
          onPress={() => (selecting ? setSelectedIds(null) : router.back())}
          accessibilityLabel={selecting ? t('Close') : t('Back')}
        >
          <Ionicons name={selecting ? 'close' : 'chevron-back'} size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {selecting ? t('{n} selected', { n: selectedIds.size }) : genre}
        </Text>
        {selecting ? (
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('Select all')}
            onPress={() =>
              setSelectedIds(
                selectedIds.size === songs.length ? new Set() : new Set(songs.map((s) => s.id)),
              )
            }
          >
            <Ionicons
              name="checkmark-done"
              size={24}
              color={
                songs.length > 0 && selectedIds.size === songs.length ? colors.accent : colors.text
              }
            />
          </Pressable>
        ) : null}
        {/* Only for the albums: the song list is a list, there's no other way
            to draw it. */}
        {!selecting && tab === 'albums' ? (
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={grid ? t('List view') : t('Grid view')}
            onPress={() => setLayout(grid ? 'list' : 'grid')}
          >
            <Ionicons name={grid ? 'list' : 'grid-outline'} size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {/* What you're looking at on the left, what it does on the right. The
          play button used to be a bare icon in the corner, which said nothing
          about what it would play. */}
      <View style={styles.toolbar}>
        <View style={styles.tabs}>
          {(['albums', 'songs'] as const).map((key) => (
            <Pressable
              key={key}
              style={[styles.chip, tab === key && { backgroundColor: colors.accent }]}
              onPress={() => {
                setTab(key);
                setSelectedIds(null);
              }}
            >
              <Text style={[styles.chipText, tab === key && styles.chipTextActive]}>
                {key === 'albums' ? t('Albums') : t('Songs')}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.playRow}>
          <Pressable hitSlop={10} onPress={onShuffle} accessibilityLabel={t('Shuffle')}>
            <Ionicons name="shuffle" size={24} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            style={styles.playButton}
            onPress={onPlay}
            accessibilityRole="button"
            accessibilityLabel={t('Play')}
          >
            {starting ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Ionicons name="play" size={22} color="#000" />
            )}
          </Pressable>
        </View>
      </View>

      {query.isLoading ? (
        tab === 'songs' || !grid ? (
          <AlbumRowsSkeleton />
        ) : (
          <AlbumCardsSkeleton width={CARD} count={8} />
        )
      ) : query.isError ? (
        <Message
          text={tab === 'albums' ? t("Couldn't load albums.") : t("Couldn't load songs.")}
          onRetry={() => query.refetch()}
        />
      ) : tab === 'songs' ? (
        <FlatList
          {...listPerf}
          data={songs}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          contentContainerStyle={styles.songList}
          extraData={selectedIds}
          renderItem={({ item, index }) => (
            <TrackRow
              song={item}
              isCurrent={playing?.id === item.id}
              showArtwork={showListArtwork}
              selecting={selecting}
              selected={!!selectedIds?.has(item.id)}
              onPressIn={() => {
                justLongPressed.current = null;
              }}
              onLongPress={
                selecting
                  ? undefined
                  : () => {
                      haptic('medium');
                      setSelectedIds(new Set([item.id]));
                      justLongPressed.current = item.id;
                    }
              }
              onPress={() => {
                // Discards the onPress that closes the long-press: it would
                // deselect the very song you entered selection with.
                if (justLongPressed.current === item.id) return;
                if (selecting) toggleSelect(item.id);
                else void playQueue(songs, index, genre, href);
              }}
            />
          )}
          onEndReached={() => songsQuery.hasNextPage && songsQuery.fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            songsQuery.isFetchingNextPage ? (
              <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="musical-notes-outline"
              title={t('No songs in this genre')}
              subtitle={t('Try exploring another genre.')}
            />
          }
        />
      ) : (
        <FlatList
          {...listPerf}
          data={albums}
          // Remount on layout change: FlatList reuses rows and gets stuck with
          // stale ones, and `numColumns` can't be hot-swapped either.
          key={layout}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          {...(grid
            ? {
                numColumns: COLUMNS,
                columnWrapperStyle: { gap: GAP },
                contentContainerStyle: styles.list,
              }
            : { contentContainerStyle: styles.rowList })}
          renderItem={({ item }) =>
            grid ? <AlbumCard album={item} width={CARD} /> : <AlbumRow album={item} />
          }
          onEndReached={() => albumsQuery.hasNextPage && albumsQuery.fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            albumsQuery.isFetchingNextPage ? (
              <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="disc-outline"
              title={t('No albums in this genre')}
              subtitle={t('Try exploring another genre.')}
            />
          }
        />
      )}

      {selecting ? (
        <SelectionBar
          count={selectedIds.size}
          actions={[
            {
              icon: 'add-circle-outline',
              label: t('Add to a playlist'),
              onPress: () => runSelection(openPlaylistPicker),
            },
            {
              icon: 'list',
              label: t('Add to queue'),
              onPress: () =>
                runSelection((sel) => {
                  // In reverse: each one goes right after the current song, so
                  // queueing them backwards leaves them in the order you see.
                  [...sel].reverse().forEach(addToQueue);
                  toast(t('Added to queue'));
                }),
            },
            ...(offline
              ? []
              : [
                  {
                    icon: 'download-outline' as const,
                    label: t('Download'),
                    onPress: () =>
                      runSelection((sel) => {
                        void downloadSongs(sel);
                        toast(t('Downloading…'));
                      }),
                  },
                ]),
          ]}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { flex: 1, color: colors.text, fontSize: fontSize.lg, fontWeight: '800' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  tabs: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    // Asymmetric padding on purpose: even without includeFontPadding, glyphs
    // end up ~1dp low relative to the pill center (same as the browse chips).
    paddingTop: spacing.xs - 1,
    paddingBottom: spacing.xs + 1,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.surfaceHighlight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  chipTextActive: { color: '#000' },
  playRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING, gap: GAP },
  rowList: {
    paddingHorizontal: spacing.lg,
    paddingBottom: SCREEN_BOTTOM_PADDING,
    gap: spacing.lg,
  },
  // Same side margin as the album and playlist song lists: `TrackRow` brings
  // no horizontal padding of its own, so without this the covers sit against
  // the left edge and the ⋯ against the right one.
  songList: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
});
