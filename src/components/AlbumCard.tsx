/** Album card for home and search grids/carousels. */
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { COVER, coverArtUrl, type Album } from '@/api/data';
import { useMediaMenu } from '@/store/mediaMenu';
import { haptic } from '@/lib/haptics';
import { colors, fontSize, spacing } from '@/theme';
import { Cover } from './Cover';

interface Props {
  album: Album;
  width?: number;
  /** Called when the card is tapped (in addition to navigating to the album). */
  onPress?: () => void;
}

export function AlbumCard({ album, width = 150, onPress }: Props) {
  const cover = coverArtUrl(album.coverArt ?? album.id, COVER.card);
  const openMenu = useMediaMenu((s) => s.open);

  return (
    <Link href={`/album/${album.id}`} asChild>
      {/* expo-router merges the Link style into this child; it must be a
          single object, not an array, so we flatten it. */}
      <Pressable
        style={StyleSheet.flatten([styles.container, { width }])}
        onPress={onPress}
        onLongPress={() => {
          haptic('light');
          openMenu({ kind: 'album', album });
        }}
      >
        <Cover uri={cover} size={width} />
        <Text style={styles.title} numberOfLines={1}>
          {album.name}
        </Text>
        {album.artist ? (
          <Text style={styles.artist} numberOfLines={1}>
            {album.artist}
          </Text>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
});
