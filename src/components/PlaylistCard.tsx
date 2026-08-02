/** Tarjeta de playlist para los carruseles del inicio (fila «Playlists»). */
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { coverArtUrl, type Playlist } from '@/api/data';
import { songsLabel } from '@/i18n';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing } from '@/theme';
import { Cover } from './Cover';

interface Props {
  playlist: Playlist;
  width?: number;
}

export function PlaylistCard({ playlist, width = 150 }: Props) {
  const lang = useSettings((s) => s.language);
  const cover = coverArtUrl(playlist.coverArt ?? playlist.id, 300);

  return (
    <Link href={`/playlist/${playlist.id}`} asChild>
      {/* expo-router fusiona el estilo del Link en este hijo: un único objeto. */}
      <Pressable style={StyleSheet.flatten([styles.container, { width }])}>
        <Cover uri={cover} size={width} />
        <Text style={styles.title} numberOfLines={1}>
          {playlist.name}
        </Text>
        {playlist.songCount !== undefined ? (
          <Text style={styles.sub} numberOfLines={1}>
            {songsLabel(playlist.songCount, lang)}
          </Text>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  sub: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
});
