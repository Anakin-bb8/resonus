/**
 * Play and shuffle for a list of music, for the two Library sections that are
 * one.
 *
 * Browsing all albums and browsing all songs are two views of the same music,
 * so both get the same pair and both start the same thing — the library's
 * songs — the way the genre screen shows one row across its own two tabs. It
 * sits under the order chips and over the list, which is what it acts on.
 *
 * What the genre's row also carries and this does not is the download button
 * and the ⋯. Both act on a bounded set there, where a dialog can say what it
 * weighs before you agree to it; here the set is the whole library.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { getSongList, type Song } from '@/api/data';
import { type SongListSort } from '@/api/subsonic';
import { useAccent } from '@/hooks/useAccent';
import { useT } from '@/i18n';
import { playShuffle } from '@/lib/playShuffle';
import { usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { colors, radius, spacing, themed } from '@/theme';

/**
 * Songs fetched when Play is pressed. The list on screen is a window on a
 * paginated one, so playing it would mean "the first thirty, and whatever you
 * happened to scroll past"; this asks for a queue's worth in the order the
 * chips are set to, which is what the genre screen does with the same button.
 */
const PLAY_SIZE = 200;

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
  /** A queue's worth is a request, and the play button says so meanwhile. */
  const [starting, setStarting] = useState(false);

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

  return (
    <View style={styles.actions}>
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
  );
}

const styles = themed(() => ({
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  // Same measurements as `TrackListView`, which is what an album and a playlist
  // put in this corner.
  playButton: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
