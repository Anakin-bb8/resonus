/**
 * Podcast row for lists: small cover, name, and one line under it. The list-
 * mode sibling of the Library's grid card.
 *
 * A row is either a show or a single hearted episode, and the tap follows: a
 * show taps to its screen, an episode plays itself (like Home's shelf). The
 * long-press hands over the matching menu — the show's sheet or the song
 * sheet, since an episode plays as a song.
 *
 * The line under the title is passed already worded: each screen phrases it
 * its own way (an episode count, a show name, "Podcast · Ada"), and pinning
 * is optional because it belongs to the Library, as it does in `AlbumRow`.
 */
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import Icon from '@/components/Icon';
import { COVER, coverArtUrl } from '@/api/data';
import { episodeToSong, type PodcastChannel, type PodcastEpisode } from '@/api/podcasts';
import { haptic } from '@/lib/haptics';
import { bump } from '@/lib/perfLog';
import { usePlayerStore } from '@/store/player';
import { useSongMenu } from '@/store/songMenu';
import { usePodcastMenu } from '@/store/podcastMenu';
import { fontSize, spacing, themed, useTheme } from '@/theme';
import { Cover } from './Cover';

interface Props {
  /** The show the row is about; without one there is nothing to show. */
  channel?: PodcastChannel;
  /** With it, the row is one hearted episode: a tap plays just that one. */
  episode?: PodcastEpisode;
  /** The line under the title, already worded by the caller. */
  sub?: string;
  /** Marks the row as pinned, with a pin next to the line. */
  pinned?: boolean;
}

export function PodcastRow({ channel, episode, sub, pinned }: Props) {
  bump('render · PodcastRow');
  // Subscribed, not read straight off `colors`: the pin keeps the current
  // accent while the screen stays mounted (as in `AlbumRow`).
  const { accent } = useTheme();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const openSongMenu = useSongMenu((s) => s.open);
  const openShowMenu = usePodcastMenu((s) => s.open);
  if (!channel) return null;
  const href = `/podcast/${channel.id}`;
  // An episode row plays itself; a show row taps to its screen.
  const song = episode ? episodeToSong(episode, channel) : undefined;

  const row = (
    <Pressable
      style={styles.row}
      onPress={
        song
          ? () => {
              haptic('light');
              void playQueue([song], 0, channel.title, href);
            }
          : undefined
      }
      onLongPress={() => {
        haptic('light');
        if (song) openSongMenu(song);
        else openShowMenu(channel);
      }}
    >
      <Cover
        uri={coverArtUrl(channel.imageUrl, COVER.thumb)}
        size={56}
        placeholderIcon="headset-outline"
      />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {episode ? episode.title : channel.title}
        </Text>
        {sub || pinned ? (
          <View style={styles.subLine}>
            {pinned ? <Icon name="pin" size={13} color={accent} /> : null}
            {sub ? (
              <Text style={styles.sub} numberOfLines={1}>
                {sub}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
  // A row that acts on tap (an episode plays itself) is not a link; otherwise
  // the tap navigates to the show's screen.
  return song ? row : <Link href={href} asChild>{row}</Link>;
}

const styles = themed((colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1 },
  name: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  sub: { color: colors.textSecondary, fontSize: fontSize.xs, flexShrink: 1 },
}));
