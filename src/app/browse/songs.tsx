/**
 * Browse the library's songs, with search, infinite scroll and multi-select.
 *
 * The sibling of browsing albums and artists, and the one the server makes
 * hardest: Subsonic has no endpoint that lists songs in any order, so there the
 * screen shows them as the server keeps them (an empty `search3`) and offers
 * nothing but shuffle beside it. Jellyfin and the local catalog can sort, and
 * there the chips are the ones you would expect. `songListSorts` is what
 * decides, so no chip here ever promises an order the server won't give.
 *
 * Finding one song among many is the search bar's job, not the list's: a
 * six-figure library is not something anybody scrolls, and pulling it down to
 * sort it on the phone is not something a phone can do (#77).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getSongList, search, songListSorts } from '@/api/data';
import { type Song, type SongListSort } from '@/api/subsonic';
import { AlbumRowsSkeleton } from '@/components/AlbumRowsSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { Message } from '@/components/Message';
import { SelectionBar } from '@/components/SelectionBar';
import { TrackRow } from '@/components/TrackRow';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { listPerf } from '@/lib/listPerf';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { currentSong, usePlayerStore } from '@/store/player';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

const PAGE = 50;

/** Bar height: the box (44) plus its gap to the chips below. */
const SEARCH_H = 44 + spacing.md;

/** Delay before querying the server: without this it'd be one request per keystroke. */
const DEBOUNCE_MS = 300;

const SORT_LABEL: Record<SongListSort, string> = {
  server: 'Library order',
  alpha: 'A-Z',
  added: 'Recently added',
  frequent: 'Most played',
  random: 'Shuffle',
};

export default function BrowseSongsScreen() {
  const router = useRouter();
  const t = useT();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const offline = useAuthStore((s) => s.offline);
  const toast = useToast((s) => s.show);
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const downloadSongs = useDownloads((s) => s.downloadSongs);
  const openPlaylistPicker = usePlaylistPicker((s) => s.open);
  // What this server can actually order by; the first one is what it opens on.
  const sorts = canFetch ? songListSorts() : [];
  const [sort, setSort] = useState<SongListSort>(sorts[0] ?? 'server');

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['browseSongs', sort],
      queryFn: ({ pageParam }) => getSongList(sort, PAGE, pageParam),
      initialPageParam: 0,
      getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length * PAGE : undefined),
      enabled: canFetch,
    });

  // ── Search ─────────────────────────────────────────────────────────────
  // Server-side, like browsing albums: filtering the loaded pages would look
  // like it works and quietly leave the rest of the library out.
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const {
    data: results,
    isLoading: searchLoading,
    isError: searchError,
    refetch: refetchSearch,
  } = useQuery({
    queryKey: ['searchSongs', debounced],
    queryFn: () => search(debounced).then((r) => r.songs),
    enabled: canFetch && debounced.length > 0,
  });

  const isSearch = query.trim().length > 0;
  const songs = isSearch ? (results ?? []) : (data?.pages.flat() ?? []);
  // While the debounce hasn't fired the query is still off, so it's not
  // "loading" but there are also no results: without this «No results» would
  // flash between keystrokes.
  const searchPending = isSearch && (searchLoading || debounced !== query.trim());

  // ── Multi-select ───────────────────────────────────────────────────────
  // Same as the genre and album lists: null = normal, a Set (even empty) =
  // selecting. Building a playlist out of loose songs is what the screen was
  // asked for, and one by one through the ⋯ menu is not building anything.
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

  function cancelSearch() {
    Keyboard.dismiss();
    setQuery('');
    setSearching(false);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* While selecting, the header turns into ✕ + counter + select all, the
          same swap the other song lists do. */}
      <View style={styles.header}>
        <Pressable
          hitSlop={10}
          onPress={() => (selecting ? setSelectedIds(null) : router.back())}
          accessibilityLabel={selecting ? t('Close') : t('Back')}
        >
          <Ionicons name={selecting ? 'close' : 'chevron-back'} size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {selecting ? t('{n} selected', { n: selectedIds.size }) : t('Songs')}
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
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            style={styles.input}
            placeholder={t('Find a song')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearching(true)}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Clear')}
              onPress={() => setQuery('')}
            >
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        {searching ? (
          <Pressable hitSlop={8} accessibilityRole="button" onPress={cancelSearch}>
            <Text style={styles.searchCancel}>{t('Cancel')}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Hidden while searching: results come back by relevance, so a marked
          pill would lie about the order on screen. With a single order there is
          nothing to choose either. */}
      {isSearch || sorts.length < 2 ? null : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipsRow}
        >
          {sorts.map((key) => {
            const active = key === sort;
            return (
              <Pressable
                key={key}
                style={[styles.chip, active && { backgroundColor: colors.accent }]}
                onPress={() => {
                  setSort(key);
                  setSelectedIds(null);
                }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {t(SORT_LABEL[key])}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {(isSearch ? searchPending : isLoading) ? (
        <AlbumRowsSkeleton />
      ) : isSearch && searchError ? (
        <Message text={t("Couldn't load songs.")} onRetry={() => refetchSearch()} />
      ) : isError ? (
        <Message text={t("Couldn't load songs.")} onRetry={() => refetch()} />
      ) : (
        <FlatList
          {...listPerf}
          data={songs}
          // The random order can hand back a song that already came in an
          // earlier page, so the index goes into the key.
          keyExtractor={(item, i) => `${item.id}-${i}`}
          contentContainerStyle={styles.list}
          extraData={selectedIds}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item, index }: { item: Song; index: number }) => (
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
                else void playQueue(songs, index, t('Songs'), '/browse/songs');
              }}
            />
          )}
          // Results are a cap, not a window: asking for more at the end would
          // bring the plain list back underneath them.
          onEndReached={() => !isSearch && hasNextPage && fetchNextPage()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            !isSearch && isFetchingNextPage ? (
              <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} />
            ) : null
          }
          ListEmptyComponent={
            isSearch ? (
              <EmptyState
                icon="search-outline"
                title={t('No results')}
                subtitle={t('No results for “{q}”', { q: query.trim() })}
              />
            ) : (
              <EmptyState
                icon="musical-notes-outline"
                title={t('No songs yet')}
                subtitle={t('Your library looks empty.')}
              />
            )
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
  searchRow: {
    height: SEARCH_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    // The gap to the chips is part of the height, not an outer margin.
    paddingBottom: spacing.md,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    backgroundColor: colors.surfaceHighlight,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  input: { flex: 1, color: colors.text, fontSize: fontSize.md, paddingVertical: 0 },
  searchCancel: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
  // `flexShrink: 0` because the search bar adds a child to the column: without
  // it flex shrinks this row and clips the pill text.
  chipsRow: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
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
    // Android adds extra asymmetric padding on top of the text (font ascent):
    // without removing it, the text doesn't center in the pill.
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  chipTextActive: { color: '#000' },
  // `TrackRow` brings no horizontal padding of its own, so without this the
  // covers sit against the left edge and the ⋯ against the right one.
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
});
