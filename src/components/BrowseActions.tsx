/**
 * The row a list of music gets, for the two Library sections that are one.
 *
 * It is the arrangement an album, a playlist and a genre already have, in the
 * same order and to the same margins: what you do to the list on the left,
 * what starts it on the right. Browsing all albums and browsing all songs are
 * two views of the same music, so both get it and both act on the same thing —
 * the library's songs — the way the genre screen shows one row across its own
 * two tabs.
 *
 * What it does NOT carry is the genre's download button. There the set is
 * bounded and a dialog can say what it weighs before you agree to it; here the
 * set is the whole library, and a button that offers to put all of it on the
 * phone is not the same offer.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { getSongList, type Song } from '@/api/data';
import { type SongListSort } from '@/api/subsonic';
import { SheetModal } from '@/components/SheetModal';
import { useAccent } from '@/hooks/useAccent';
import { useT } from '@/i18n';
import { playShuffle } from '@/lib/playShuffle';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { usePlaylistPicker } from '@/store/playlistPicker';
import { useToast } from '@/store/toast';
import { colors, fontSize, radius, spacing, themed } from '@/theme';

/**
 * Songs fetched when Play is pressed. The list on screen is a window on a
 * paginated one, so playing it would mean "the first thirty, and whatever you
 * happened to scroll past"; this asks for a queue's worth in the order the
 * chips are set to, which is what the genre screen does with the same button.
 */
const PLAY_SIZE = 200;

/**
 * And when the whole library has to be read: page by page until the server runs
 * out or the cap is reached. The cap is there because this has to end.
 */
const GATHER_PAGE = 200;
const GATHER_CAP = 5000;

export function BrowseActions({
  sort,
  onScreen,
  source,
  href,
}: {
  /** The song order the screen is set to, where it has one to offer. */
  sort?: SongListSort;
  /** What is on screen when that IS the whole answer (a search): played as it
   *  stands, rather than asking the server for a list nobody is looking at. */
  onScreen?: Song[] | null;
  /** What the player says it is playing from, and where that name leads. */
  source: string;
  href: string;
}) {
  const t = useT();
  const accent = useAccent();
  const toast = useToast((s) => s.show);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const openPlaylistPicker = usePlaylistPicker((s) => s.open);
  const deleteSongs = useDownloads((s) => s.deleteSongs);
  const menuRef = useRef<() => void>(() => {});
  /** A queue's worth is a request, and the play button says so meanwhile. */
  const [starting, setStarting] = useState(false);
  /** Reading the library for the menu's two actions, which is many requests. */
  const [gathering, setGathering] = useState(false);

  async function gather(): Promise<Song[] | null> {
    if (gathering) return null;
    setGathering(true);
    try {
      const all: Song[] = [];
      for (;;) {
        // Always the server's own order, whatever is chosen on screen: a set
        // has none, and paging through a random one hands back the same song
        // twice and misses others.
        const page = await getSongList('server', GATHER_PAGE, all.length);
        all.push(...page);
        if (page.length < GATHER_PAGE || all.length >= GATHER_CAP) break;
      }
      return all;
    } catch {
      toast(t("Couldn't load songs."));
      return null;
    } finally {
      setGathering(false);
    }
  }

  async function onPlay() {
    if (starting) return;
    setStarting(true);
    try {
      const queue = onScreen ?? (await getSongList(sort ?? 'server', PLAY_SIZE, 0));
      if (queue.length === 0) {
        toast(t('Nothing to shuffle yet'));
        return;
      }
      await playQueue(queue, 0, source, href);
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
      await playShuffle();
    } finally {
      setStarting(false);
    }
  }

  async function addToPlaylist() {
    const gathered = await gather();
    if (gathered && gathered.length > 0) openPlaylistPicker(gathered);
  }

  /** Removes whatever of the library is on disk, from the same reading of it. */
  async function deleteDownloads() {
    const gathered = await gather();
    if (!gathered) return;
    const files = useDownloads.getState().files;
    const ids = gathered.filter((s) => files[s.id]).map((s) => s.id);
    if (ids.length === 0) {
      toast(t('Nothing here is downloaded'));
      return;
    }
    await deleteSongs(ids);
    toast(t('{n} songs deleted', { n: ids.length }));
  }

  return (
    <>
      <View style={styles.actions}>
        <Pressable
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('More options')}
          onPress={() => menuRef.current()}
        >
          {/* The spinner takes the icon's place while the library is being
              read: the menu's two actions are a handful of requests, and
              without it the tap looked like it had missed. */}
          {gathering ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Ionicons name="ellipsis-horizontal" size={26} color={colors.textSecondary} />
          )}
        </Pressable>
        <View style={styles.playRow}>
          <Pressable
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('Shuffle')}
            onPress={() => void onShuffle()}
          >
            <Ionicons name="shuffle" size={26} color={colors.textSecondary} />
          </Pressable>
          <Pressable
            style={[styles.playButton, { backgroundColor: accent }]}
            accessibilityRole="button"
            accessibilityLabel={t('Play')}
            onPress={() => void onPlay()}
          >
            {starting ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Ionicons name="play" size={28} color={colors.onAccent} style={{ marginLeft: 3 }} />
            )}
          </Pressable>
        </View>
      </View>

      <SheetModal openRef={menuRef}>
        {(close) => (
          <>
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                void addToPlaylist();
              }}
            >
              <Ionicons name="add-circle-outline" size={22} color={colors.text} />
              <Text style={styles.actionText}>{t('Add to a playlist')}</Text>
            </Pressable>
            {/* Shown whatever is on disk: the screen holds a window on the
                library, so it cannot know whether any of it is downloaded
                without reading the whole thing. It says so when pressed. */}
            <Pressable
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => {
                close();
                void deleteDownloads();
              }}
            >
              {/* Not in red: a download comes back with one tap, and red is
                  kept for what does not. */}
              <Ionicons name="trash-outline" size={22} color={colors.text} />
              <Text style={styles.actionText}>{t('Delete downloads')}</Text>
            </Pressable>
          </>
        )}
      </SheetModal>
    </>
  );
}

const styles = themed((colors) => ({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  playRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  // Same measurements as `TrackListView`, which is what an album and a playlist
  // put in this corner.
  playButton: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
}));
