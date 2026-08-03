/**
 * Album row for lists: small cover art, name, and artist. The list-mode
 * sibling of `AlbumCard`; until now it only existed loose inside the Library.
 *
 * The pin is optional because pinning belongs to the Library: when browsing
 * there are no pinned items to show.
 */
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COVER, coverArtUrl, type Album } from '@/api/data';
import { haptic } from '@/lib/haptics';
import { useMediaMenu } from '@/store/mediaMenu';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing } from '@/theme';
import { Cover } from './Cover';

interface Props {
  album: Album;
  /** Marks the album as pinned, with a pin next to the artist. */
  pinned?: boolean;
}

export function AlbumRow({ album, pinned }: Props) {
  const openMenu = useMediaMenu((s) => s.open);
  // From the store, not `colors.accent`: without a subscription the pin would
  // keep the previous accent color while the screen stays mounted.
  const accent = useSettings((s) => s.accentColor);

  return (
    <Link href={`/album/${album.id}`} asChild>
      <Pressable
        style={styles.row}
        onLongPress={() => {
          haptic('light');
          openMenu({ kind: 'album', album });
        }}
      >
        <Cover uri={coverArtUrl(album.coverArt ?? album.id, COVER.thumb)} size={56} />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {album.name}
          </Text>
          {album.artist || pinned ? (
            <View style={styles.subLine}>
              {pinned ? (
                <MaterialCommunityIcons name="pin" size={13} color={accent} style={styles.pin} />
              ) : null}
              {album.artist ? (
                <Text style={styles.sub} numberOfLines={1}>
                  {album.artist}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1 },
  name: { color: colors.text, fontSize: fontSize.md, fontWeight: '600' },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  sub: { color: colors.textSecondary, fontSize: fontSize.xs },
  // The MCI pin icon is vertical; rotated 45° it looks like Spotify's.
  pin: { transform: [{ rotate: '45deg' }] },
});
