/** Artist detail, Spotify-style: large header, actions, sections. */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
// gesture-handler ScrollView: needed so the "Popular" row swipe-to-queue
// coexists with scrolling (see TrackRow).
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  coverArtUrl,
  getAlbum,
  getAppearsOn,
  getArtist,
  getArtistInfo,
  getTopSongs,
} from '@/api/data';
import { type Song } from '@/api/subsonic';
import { AlbumCard } from '@/components/AlbumCard';
import { Cover } from '@/components/Cover';
import { CoverViewer } from '@/components/CoverViewer';
import { Dialog } from '@/components/Dialog';
import { FavoriteButton } from '@/components/FavoriteButton';
import { BackButton } from '@/components/BackButton';
import { Message } from '@/components/Message';
import { SheetModal } from '@/components/SheetModal';
import { TrackRow } from '@/components/TrackRow';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useDownloadMessage } from '@/hooks/useDownloadMessage';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { groupDownloadState, useDownloads } from '@/store/downloads';
import { currentSong, usePlayerStore } from '@/store/player';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';

const WIDTH = Dimensions.get('window').width;
const HEADER_H = Math.min(WIDTH, 360);

export default function ArtistScreen() {
  useSettings((s) => s.accentColor); // re-render when accent changes
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const canFetch = useAuthStore((s) => !!s.auth || s.offline);
  const t = useT();
  const playing = usePlayerStore(currentSong);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const showListArtwork = useSettings((s) => s.showListArtwork);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const sourceHref = usePlayerStore((s) => s.sourceHref);
  const togglePlay = usePlayerStore((s) => s.toggle);
  const playerShuffle = usePlayerStore((s) => s.shuffle);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [songsExpanded, setSongsExpanded] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  // ⋯ menu (imperative: opening/closing doesn't re-render the screen).
  const menuRef = useRef<() => void>(() => {});
  const dominant = useDominantColor(canFetch ? coverArtUrl(id, 400) : undefined);

  // ── Download the discography ────────────────────────────────────────────
  // With `songIds` intentionally empty: `groupDownloadState` can only say
  // "downloaded" by comparing ids against disk, and this screen doesn't have
  // the songs — only the albums. So here the state is two-valued ('none' /
  // 'active'), and songs are fetched on press.
  const offline = useAuthStore((s) => s.offline);
  const download = useDownloads(useShallow((s) => groupDownloadState(s, `artist:${id}`, [])));
  const downloadArtist = useDownloads((s) => s.downloadArtist);
  const cancelDownload = useDownloads((s) => s.cancelDownload);
  const deleteSongs = useDownloads((s) => s.deleteSongs);
  // The boolean, not the map: it is replaced with every song that finishes
  // downloading, so subscribing to it re-rendered the screen on each one (#50).
  const hasDownloads = useDownloads((s) => Object.keys(s.files).length > 0);
  const [confirmDownload, setConfirmDownload] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmDeleteDl, setConfirmDeleteDl] = useState(false);
  /** While fetching each album's songs, before downloading anything. */
  const [gathering, setGathering] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  /** Gathering the discography for a play button that has no popular tracks. */
  const [starting, setStarting] = useState(false);
  /** Songs already gathered, awaiting dialog confirmation. */
  const [pending, setPending] = useState<Song[] | null>(null);
  const downloadMsg = useDownloadMessage(pending ?? []);
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);

  const scrollY = useRef(new Animated.Value(0)).current;
  const barContentOpacity = scrollY.interpolate({
    inputRange: [HEADER_H * 0.45, HEADER_H * 0.75],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const barBgOpacity = scrollY.interpolate({
    inputRange: [0, HEADER_H * 0.75],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const nameOpacity = scrollY.interpolate({
    inputRange: [0, HEADER_H * 0.55],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const imgTranslate = scrollY.interpolate({
    inputRange: [-HEADER_H, 0, HEADER_H],
    outputRange: [HEADER_H / 2, 0, -HEADER_H / 3],
    extrapolate: 'clamp',
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['artist', id],
    queryFn: () => getArtist(id),
    enabled: canFetch && !!id,
  });
  const name = data?.artist.name;

  const { data: topSongs } = useQuery({
    queryKey: ['topSongs', name],
    queryFn: () => getTopSongs(name!, 20),
    enabled: canFetch && !!name,
  });

  const { data: info } = useQuery({
    queryKey: ['artistInfo', id],
    queryFn: () => getArtistInfo(id),
    enabled: canFetch && !!id,
  });

  const { data: appearsOn } = useQuery({
    queryKey: ['appearsOn', id],
    queryFn: () => getAppearsOn(id, name!),
    enabled: canFetch && !!id && !!name,
  });

  // Like in the album: the heart reads from the central favorites list, which
  // does refresh on starring (getArtist's `starred` becomes stale).
  const favArtistIds = useFavoriteIds(canFetch, 'artist');

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={styles.center}>
        <BackButton />
        <Message text={t("Couldn't load the artist.")} onRetry={() => refetch()} />
      </View>
    );
  }

  const top = topSongs ?? [];
  // The header play button doubles as play/pause when the queue currently
  // playing is this artist's (Spotify-style); otherwise it starts the popular
  // tracks. `sourceHref` identifies the context regardless of how it started
  // (the play button and shuffle both set it).
  const isCurrentArtistQueue = sourceHref === `/artist/${id}`;
  const showPause = isCurrentArtistQueue && isPlaying;
  // Shuffle icon lights up (accent) while this artist's queue is the one playing
  // and it's shuffled — same "reflects the live state" idea as the play button.
  const shuffleActive = isCurrentArtistQueue && playerShuffle;
  // Some servers (Navidrome with artist participations on) list collaboration
  // albums inside `getArtist` as well, so "already in the discography" does NOT
  // mean "own album". When the server confirmed a participation we move the
  // album out of the discography instead of dropping it — assuming otherwise is
  // what made "Appears on" never show up on those servers.
  const guests = appearsOn ?? [];
  const confirmedIds = new Set(guests.filter((a) => a.confirmed).map((a) => a.id));
  // Unconfirmed ones are guesses from a name search: there the discography is
  // still the best evidence of what's the artist's own.
  const ownAlbumIds = new Set(data.albums.map((a) => a.id));
  const albums = data.albums
    .filter((a) => !confirmedIds.has(a.id))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const guestAlbums = guests
    .filter((a) => a.confirmed || !ownAlbumIds.has(a.id))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  const headerUri =
    info?.imageUrl ?? coverArtUrl( data.artist.coverArt ?? data.artist.id, 800);

  async function shufflePlay() {
    if (shuffling) return;
    // Shuffle the artist's whole discography (own albums only; "Appears on" is
    // excluded so unrelated tracks don't land in the queue). Falls back to the
    // top tracks when there are no albums to gather.
    // Random initial track and THEN shuffle mode, like the rest of the screens:
    // shuffle mode only shuffles what's left to play, so starting at 0 made the
    // first track always play first. We await playQueue (it resets `shuffle`,
    // hence reading it fresh after).
    if (albums.length === 0) {
      if (top.length === 0) return;
      await playQueue(top, Math.floor(Math.random() * top.length), name, `/artist/${id}`);
      if (!usePlayerStore.getState().shuffle) toggleShuffle();
      return;
    }
    setShuffling(true);
    try {
      const songs = await fetchAlbumSongs();
      if (!songs || songs.length === 0) return;
      await playQueue(songs, Math.floor(Math.random() * songs.length), name, `/artist/${id}`);
      if (!usePlayerStore.getState().shuffle) toggleShuffle();
    } finally {
      setShuffling(false);
    }
  }

  /**
   * Fetches the songs of every album in the discography. Not the "Appears on"
   * ones: those albums belong to another artist, and pulling another artist's
   * full album because this one sings on a track is not what was asked. Shared
   * by download, add-to-playlist and shuffle-all.
   */
  async function fetchAlbumSongs(list: typeof albums = albums): Promise<Song[] | null> {
    try {
      const parts = await Promise.all(
        list.map((a) =>
          // Same cache key as the album screen: if you've already entered one,
          // it comes from cache instead of refetching.
          queryClient.fetchQuery({ queryKey: ['album', a.id], queryFn: () => getAlbum(a.id) }),
        ),
      );
      return parts.flatMap((p) => p.songs);
    } catch {
      toast(t("Couldn't load albums."));
      return null;
    }
  }

  /**
   * `gatherSongs` wraps the fetch in the download button's `gathering` spinner.
   * It covers ONLY this phase: if it stretched to cover the download, the button
   * would be deaf while downloading and couldn't be stopped.
   */
  async function gatherSongs(list: typeof albums = albums) {
    setGathering(true);
    try {
      return await fetchAlbumSongs(list);
    } finally {
      setGathering(false);
    }
  }

  async function addToPlaylist() {
    const songs = await gatherSongs();
    if (songs && songs.length > 0) usePlaylistPicker.getState().open(songs);
  }

  /**
   * ⋯ menu action: play the whole discography in chronological order (earliest
   * album first, undated ones last; track order preserved within each album).
   * The header Play button stays Spotify-like (popular tracks); this is the
   * tucked-away way to hear the catalogue in order (#36). Only reachable when
   * there are albums (the ⋯ button itself is gated on that).
   */
  /** Removes every downloaded song of the discography. The songs come from the
   *  same fetch the download uses, which offline reads the local catalog. */
  async function deleteDiscography() {
    const songs = await gatherSongs();
    if (!songs) return;
    const files = useDownloads.getState().files;
    const ids = songs.filter((s) => files[s.id]).map((s) => s.id);
    if (ids.length === 0) {
      toast(t('Nothing here is downloaded'));
      return;
    }
    await deleteSongs(ids);
    toast(t('{n} songs deleted', { n: ids.length }));
  }

  async function playDiscography() {
    const chrono = [...albums].sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
    const songs = await gatherSongs(chrono);
    if (songs && songs.length > 0) await playQueue(songs, 0, name, `/artist/${id}`);
  }

  async function startDownload() {
    if (!pending) return;
    await downloadArtist(id, pending, albums);
    // Without this notice the download ends silently: the button goes back to
    // its normal icon (here there's no "downloaded" state to show it) and, if
    // everything was already downloaded, `downloadGroup` exits without doing
    // absolutely nothing. If songs remain it means it was stopped, and the
    // store already notifies about that.
    const files = useDownloads.getState().files;
    const left = pending.filter((s) => !files[s.id] && !s.url && !s.localUri);
    if (left.length === 0) toast(t('Downloaded'));
  }

  // Songs are gathered BEFORE asking, not after: so the dialog counts real
  // songs and can estimate the size, like the album and list screens. Counting
  // by `songCount` would have left this screen —the one with the heaviest
  // downloads— as the only one asking blindly.
  async function onDownloadPress() {
    if (gathering) return;
    if (download.status === 'active') {
      setConfirmStop(true);
      return;
    }
    const songs = await gatherSongs();
    if (!songs || songs.length === 0) return;
    setPending(songs);
    setConfirmDownload(true);
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: SCREEN_BOTTOM_PADDING }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
        })}
      >
        <View style={styles.headerWrap}>
          {/* The header fills its space, so a photo that isn't the shape of
              the header loses its edges. Rather than trying to hold every
              shape up there, tapping it opens the whole thing, like a cover. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="imagebutton"
            accessibilityLabel={t('View image')}
            onPress={() => setPhotoOpen(true)}
          >
            <Animated.Image
              source={{ uri: headerUri }}
              style={[styles.headerImg, { transform: [{ translateY: imgTranslate }] }]}
              resizeMode="cover"
            />
          </Pressable>
          {/* Both sit on top of the photo and neither is there to be touched:
              without this they take the tap and it never reaches the image. */}
          <LinearGradient
            pointerEvents="none"
            colors={['transparent', 'transparent', colors.background] as const}
            style={StyleSheet.absoluteFill}
          />
          <Animated.Text
            pointerEvents="none"
            style={[styles.name, { opacity: nameOpacity }]}
            numberOfLines={2}
          >
            {data.artist.name}
          </Animated.Text>
        </View>

        <View style={styles.actions}>
          <FavoriteButton
            id={data.artist.id}
            type="artist"
            starred={favArtistIds ? favArtistIds.has(data.artist.id) : !!data.artist.starred}
            size={30}
          />
          {/* Locally no: what's here is already on the device. Same criteria
              (and same look) as the album and playlist header. */}
          {!offline && albums.length > 0 ? (
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('Download')}
              onPress={onDownloadPress}
              style={styles.downloadWrap}
            >
              {gathering || download.status === 'active' ? (
                <>
                  <ActivityIndicator size="small" color={colors.accent} />
                  {/* Gathering the songs there's no percentage to give yet: progress
                      only exists when the group is already downloading. */}
                  {download.status === 'active' ? (
                    <Text style={[styles.downloadProgress, { color: colors.accent }]}>
                      {Math.round(download.progress * 100)}%
                    </Text>
                  ) : null}
                </>
              ) : (
                <Ionicons name="arrow-down-circle-outline" size={26} color={colors.textSecondary} />
              )}
            </Pressable>
          ) : null}
          {albums.length > 0 ? (
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('More options')}
              onPress={() => menuRef.current()}
            >
              <Ionicons name="ellipsis-horizontal" size={26} color={colors.text} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }} />
          {/* Shuffle sits right next to Play, both on the right (Spotify-style). */}
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('Shuffle')}
            onPress={shufflePlay}
          >
            {shuffling ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Ionicons name="shuffle" size={28} color={shuffleActive ? colors.accent : colors.text} />
            )}
          </Pressable>
          <Pressable
            style={[styles.playButton, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel={showPause ? t('Pause') : t('Play')}
            onPress={() => {
              if (isCurrentArtistQueue) togglePlay();
              else if (top.length > 0) playQueue(top, 0, data.artist.name, `/artist/${id}`);
              // Nothing popular to play: rather than the button doing nothing at
              // all (#79), it falls back to what the ⋯ menu offers, the
              // discography from the earliest album on. A server that tracks no
              // plays has no popular tracks for anybody, so on those this is the
              // button's normal behaviour and not a corner case.
              else if (albums.length > 0 && !starting) {
                setStarting(true);
                void playDiscography().finally(() => setStarting(false));
              }
            }}
          >
            {starting ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Ionicons
                name={showPause ? 'pause' : 'play'}
                size={28}
                color="#000"
                // Optical centring only for the play triangle; pause is symmetric.
                style={showPause ? undefined : { marginLeft: 2 }}
              />
            )}
          </Pressable>
        </View>

        {top.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Popular')}</Text>
            {/* Same horizontal margin as the lists (album/playlist) so the
                rows —and the three-dot button— don't stick to the edge. */}
            <View style={styles.popularRows}>
              {top.slice(0, songsExpanded ? 10 : 5).map((song, i) => (
                <TrackRow
                  key={song.id}
                  song={song}
                  position={i + 1}
                  isCurrent={playing?.id === song.id}
                  showArtwork={showListArtwork}
                  onPress={() => playQueue(top, i, data.artist.name, `/artist/${id}`)}
                />
              ))}
            </View>
            {top.length > 5 ? (
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                onPress={() => setSongsExpanded((v) => !v)}
              >
                <Text style={styles.bioToggle}>
                  {songsExpanded ? t('Show less') : t('Show more')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {albums.length > 0 ? (
          <View style={styles.section}>
            <Link href={`/artist/discography/${id}`} asChild>
              <Pressable style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderTitle}>{t('Discography')}</Text>
                {albums.length > 1 ? (
                  <Text style={styles.showAll}>{t('Show all')}</Text>
                ) : null}
              </Pressable>
            </Link>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
            >
              {albums.slice(0, 10).map((album) => (
                <AlbumCard key={album.id} album={album} width={140} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {guestAlbums.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Appears on')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
            >
              {guestAlbums.slice(0, 10).map((album) => (
                <AlbumCard key={album.id} album={album} width={140} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {info?.biography ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('About::artist')}</Text>
            <Text style={styles.bio} numberOfLines={bioExpanded ? undefined : 4}>
              {info.biography}
            </Text>
            {info.biography.length > 220 ? (
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                onPress={() => setBioExpanded((v) => !v)}
              >
                <Text style={styles.bioToggle}>
                  {bioExpanded ? t('Show less') : t('Show more')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {info && info.similarArtists.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('Similar artists')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.row}
            >
              {info.similarArtists.map((a) => (
                <Link key={a.id} href={`/artist/${a.id}`} asChild>
                  <Pressable style={styles.similar}>
                    <Cover uri={coverArtUrl( a.coverArt ?? a.id, 200)} size={110} rounded />
                    <Text style={styles.similarName} numberOfLines={1}>
                      {a.name}
                    </Text>
                  </Pressable>
                </Link>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </ScrollView>

      {/* Fixed bar: the back button always; background + title + play on collapse. */}
      <View style={[styles.bar, { height: insets.top + 48, paddingTop: insets.top }]}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: dominant, opacity: barBgOpacity }]}
        />
        <Pressable
          style={styles.back}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('Close')}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Animated.Text style={[styles.barTitle, { opacity: barContentOpacity }]} numberOfLines={1}>
          {data.artist.name}
        </Animated.Text>
      </View>

      {/* The same URL as the header, not a larger one: it is already on the
          device, so it opens at once instead of downloading the photo twice. */}
      <CoverViewer
        visible={photoOpen}
        uri={headerUri}
        square={false}
        onClose={() => setPhotoOpen(false)}
      />
      <Dialog
        visible={confirmDownload}
        title={t('Download “{name}”?', { name: data.artist.name })}
        message={downloadMsg.message}
        confirmLabel={t('Download')}
        onCancel={() => setConfirmDownload(false)}
        onConfirm={() => {
          setConfirmDownload(false);
          void startDownload();
        }}
      />
      <Dialog
        visible={confirmDeleteDl}
        title={t('Remove download?')}
        message={t('“{name}” will no longer be available offline.', { name: data.artist.name })}
        confirmLabel={t('Remove')}
        destructive
        onCancel={() => setConfirmDeleteDl(false)}
        onConfirm={() => {
          setConfirmDeleteDl(false);
          void deleteDiscography();
        }}
      />
      <Dialog
        visible={confirmStop}
        title={t('Stop download?')}
        message={t('Songs already downloaded will be kept.')}
        confirmLabel={t('Stop')}
        destructive
        onCancel={() => setConfirmStop(false)}
        onConfirm={() => {
          setConfirmStop(false);
          cancelDownload(`artist:${id}`);
        }}
      />

      <SheetModal openRef={menuRef}>
        {(close) => (
          <>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                void playDiscography();
              }}
            >
              <Ionicons name="play" size={24} color={colors.text} />
              <Text style={styles.actionText}>{t('Play discography')}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                void addToPlaylist();
              }}
            >
              <Ionicons name="add" size={24} color={colors.text} />
              <Text style={styles.actionText}>{t('Add to a playlist')}</Text>
            </Pressable>
            {/* Clearing a whole discography had no path at all offline, where
                the download button isn't there — nor online for a partially
                downloaded artist, since that button only offers to delete once
                everything is in (#47). */}
            {hasDownloads ? (
              <Pressable
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  close();
                  setConfirmDeleteDl(true);
                }}
              >
                <Ionicons name="trash-outline" size={24} color={colors.text} />
                <Text style={styles.actionText}>{t('Delete downloads')}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' },
  // ⋯ menu row (same look as the playlist / media menu).
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.md },
  actionText: { color: colors.text, fontSize: fontSize.md },
  headerWrap: { width: WIDTH, height: HEADER_H, justifyContent: 'flex-end' },
  headerImg: { ...StyleSheet.absoluteFillObject, width: WIDTH, height: HEADER_H },
  name: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  // Same as the album/playlist header, so the button is the same.
  downloadWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  downloadProgress: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  playButton: {
    backgroundColor: colors.accent,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { marginBottom: spacing.xl },
  popularRows: { paddingHorizontal: spacing.lg },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionHeaderTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: '700' },
  showAll: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  bio: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 22,
    paddingHorizontal: spacing.lg,
  },
  bioToggle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  row: { paddingHorizontal: spacing.lg, gap: spacing.md },
  similar: { width: 110, alignItems: 'center', gap: spacing.xs },
  similarName: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  barTitle: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
});
