/**
 * Bottom sheet with quick actions for an album or playlist (opened via
 * long-press on its cards/rows): play, shuffle, queue, download, and
 * favorite, without entering the screen. Songs are fetched when the action
 * is chosen (same query the screen uses, so cache is shared).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { coverArtUrl, getAlbum, getPlaylist, star, unstar, type Song } from '@/api/data';
import { useBottomSheetAnim } from '@/hooks/useBottomSheetAnim';
import { useDownloadMessage } from '@/hooks/useDownloadMessage';
import { queryClient } from '@/lib/query';
import { songsLabel, useT } from '@/i18n';
import { useAuthStore } from '@/store/auth';
import { useDownloads } from '@/store/downloads';
import { useMediaMenu, type MediaMenuItem } from '@/store/mediaMenu';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { MAX_PINS, usePins } from '@/store/pins';
import { usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing } from '@/theme';
import { Cover } from './Cover';
import { Dialog } from './Dialog';

function Action({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={24} color={colors.text} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

/** Album/playlist songs, sharing cache with its screen. */
async function fetchSongs(item: MediaMenuItem): Promise<Song[]> {
  if (item.kind === 'album') {
    const data = await queryClient.fetchQuery({
      queryKey: ['album', item.album.id],
      queryFn: () => getAlbum(item.album.id),
    });
    return data.songs;
  }
  const data = await queryClient.fetchQuery({
    queryKey: ['playlist', item.playlist.id],
    queryFn: () => getPlaylist(item.playlist.id),
  });
  return data.songs;
}

export function MediaMenuSheet() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const lang = useSettings((s) => s.language);
  const toast = useToast((s) => s.show);
  const offline = useAuthStore((s) => s.offline);
  const item = useMediaMenu((s) => s.item);
  const closeNow = useMediaMenu((s) => s.close);
  const { dismiss, backdropStyle, sheetStyle, onSheetLayout } = useBottomSheetAnim(!!item);
  const pins = usePins((s) => s.pins);
  const togglePin = usePins((s) => s.toggle);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Songs gathered for the download dialog (its size needs them). */
  const [pending, setPending] = useState<Song[] | null>(null);
  const downloadMsg = useDownloadMessage(pending ?? []);
  const downloadAlbum = useDownloads((s) => s.downloadAlbum);
  const downloadPlaylist = useDownloads((s) => s.downloadPlaylist);
  const deleteSongs = useDownloads((s) => s.deleteSongs);
  const files = useDownloads((s) => s.files);
  const hasDownloads = Object.keys(files).length > 0;

  if (!item) return null;

  const close = () => dismiss(closeNow);
  const album = item.kind === 'album' ? item.album : null;
  const playlist = item.kind === 'playlist' ? item.playlist : null;
  const name = album ? album.name : playlist!.name;
  const subtitle = album ? album.artist : songsLabel(playlist!.songCount ?? 0, lang);
  const coverId = album ? (album.coverArt ?? album.id) : (playlist!.coverArt ?? playlist!.id);
  const href = album ? `/album/${album.id}` : `/playlist/${playlist!.id}`;
  const pinKey = album ? `album:${album.id}` : `playlist:${playlist!.id}`;
  const pinned = !!pins[pinKey];

  /** Fetches the songs WITHOUT closing, so the dialog has a size to show.
   *  They usually come from the cache: same query key the screens use. */
  async function askDownload() {
    try {
      const songs = await fetchSongs(item!);
      if (songs.length > 0) setPending(songs);
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  /** Closes, fetches the songs, and runs the action (with toast on failure). */
  async function withSongs(fn: (songs: Song[]) => void) {
    close();
    try {
      const songs = await fetchSongs(item!);
      if (songs.length > 0) fn(songs);
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  async function toggleFavorite() {
    if (!album) return;
    close();
    try {
      if (album.starred) {
        await unstar(album.id, 'album');
        // Without favorite the album no longer appears in the Library, so its
        // pin would be orphaned taking up a slot: we release it on unfavorite.
        if (pins[pinKey]) togglePin(pinKey);
        toast(t('Removed from favorites'));
      } else {
        await star(album.id, 'album');
        toast(t('Added to favorites'));
      }
      void queryClient.invalidateQueries({ queryKey: ['starred'] });
      void queryClient.invalidateQueries({ queryKey: ['album', album.id] });
    } catch {
      toast(t("Couldn't complete the action"));
    }
  }

  return (
    <Modal transparent animationType="none" visible onRequestClose={close}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }, sheetStyle]}
        onLayout={onSheetLayout}
      >
        <View style={styles.headerRow}>
          <Cover uri={coverArtUrl(coverId, 100)} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {name}
            </Text>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.divider} />

        <Action
          icon="play"
          label={t('Play')}
          onPress={() => withSongs((songs) => void playQueue(songs, 0, name, href))}
        />
        <Action
          icon="shuffle"
          label={t('Shuffle')}
          onPress={() =>
            withSongs((songs) => {
              // Same as the screen buttons: random starting track and shuffle
              // mode active (playQueue resets it, hence the order).
              void playQueue(songs, Math.floor(Math.random() * songs.length), name, href);
              if (!usePlayerStore.getState().shuffle) usePlayerStore.getState().toggleShuffle();
            })
          }
        />
        <Action
          icon="list"
          label={t('Add to queue')}
          onPress={() =>
            withSongs((songs) => {
              for (const song of songs) addToQueue(song);
              toast(t('Added to queue'));
            })
          }
        />
        <Action
          icon="add"
          label={t('Add to a playlist')}
          onPress={() => withSongs((songs) => usePlaylistPicker.getState().open(songs))}
        />
        {!offline ? (
          <Action
            icon="download-outline"
            label={t('Download')}
            // Asks with the size, like the button on the album's own screen:
            // the same action shouldn't warn down one path and not the other.
            onPress={() => void askDownload()}
          />
        ) : null}
        {/* The header button only turns into "delete" once EVERYTHING is
            downloaded, and offline there is no header button at all — so a
            half-downloaded album could only be cleared song by song (#47).
            Shown whenever this profile has downloads; whether these songs are
            among them takes fetching them, which is what the press does. */}
        {hasDownloads ? (
          <Action
            icon="trash-outline"
            label={t('Delete downloads')}
            onPress={() => setConfirmDelete(true)}
          />
        ) : null}
        {album ? (
          <Action
            icon={album.starred ? 'heart' : 'heart-outline'}
            label={album.starred ? t('Remove from favorites') : t('Add to favorites')}
            onPress={() => void toggleFavorite()}
          />
        ) : null}
        {/* Diagonal pin (MaterialCommunity), like Spotify's; the Ionicons one
            is something else and looks weird. Only makes sense if the item can
            appear in the Library: playlists always do, but albums only if
            favorited (the list comes from getStarred). */}
        {playlist || album?.starred ? (
          <Pressable
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
            onPress={() => {
              const ok = togglePin(pinKey);
              close();
              if (!ok) toast(t('You can pin up to {n} items.', { n: MAX_PINS }));
            }}
          >
            <MaterialCommunityIcons
              name={pinned ? 'pin' : 'pin-outline'}
              size={24}
              color={colors.text}
              style={styles.pinIcon}
            />
            <Text style={styles.actionText}>{pinned ? t('Unpin') : t('Pin to top')}</Text>
          </Pressable>
        ) : null}
      </Animated.View>

      {/* Over the sheet, which stays open behind it: closing it would take the
          dialog with it. How many of these songs are actually downloaded takes
          fetching them, so the question is asked before, not after. */}
      <Dialog
        visible={!!pending}
        title={t('Download “{name}”?', { name })}
        message={downloadMsg.message}
        confirmLabel={t('Download')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const songs = pending ?? [];
          setPending(null);
          close();
          if (album) void downloadAlbum(album, songs);
          else void downloadPlaylist(playlist!, songs);
          toast(t('Downloading…'));
        }}
      />

      <Dialog
        visible={confirmDelete}
        title={t('Remove download?')}
        message={t('“{name}” will no longer be available offline.', { name })}
        confirmLabel={t('Remove')}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void withSongs((songs) => {
            const ids = songs.filter((s) => files[s.id]).map((s) => s.id);
            if (ids.length === 0) {
              toast(t('Nothing downloaded here'));
              return;
            }
            void deleteSongs(ids);
            toast(t('{n} songs deleted', { n: ids.length }));
          });
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700' },
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
  // The MCI pin comes vertical; rotated 45° it looks like Spotify's.
  pinIcon: { transform: [{ rotate: '45deg' }] },
});
