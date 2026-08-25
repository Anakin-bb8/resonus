/** Colored card for a genre, with its first covers fanned out. Links to /genre/[name]. */
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COVER, coverArtUrl } from '@/api/data';
import { Cover } from '@/components/Cover';
import { useGenreArt } from '@/hooks/useGenreArt';
import { albumsLabel } from '@/i18n';
import { useSettings } from '@/store/settings';
import { colors, fontSize, radius, spacing, themed, useThemeMode } from '@/theme';

/**
 * The card's height, and the size of the covers on it. Both fixed: the columns
 * decide how wide a card is (#131), and the art keeps its own proportion at
 * any of those widths.
 */
export const GENRE_CARD_HEIGHT = 108;
const ART_SIZE = 92;

/** Stable hue derived from the genre name. */
function genreHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h) % 360;
}

export function GenreCard({
  name,
  albumCount,
  width,
}: {
  name: string;
  albumCount?: number;
  width?: number;
}) {
  const mode = useThemeMode();
  const lang = useSettings((s) => s.language);
  const albums = useGenreArt(name, albumCount);
  const hue = genreHue(name);
  /**
   * Pale card with dark writing under the dark appearance, deep card with
   * white writing under the light one. The reason is the page behind it: a
   * pale block reads as a card on near-black and disappears on white.
   */
  const dark = mode === 'dark';
  const card = dark ? `hsl(${hue}, 45%, 78%)` : `hsl(${hue}, 50%, 32%)`;
  const ink = dark ? `hsl(${hue}, 45%, 18%)` : colors.onArtwork;
  // An album with no artwork is left out rather than given a placeholder: a
  // grey square is more conspicuous on one of these than a card with no art.
  const art = (albums ?? [])
    .map((a) => coverArtUrl(a.coverArt ?? a.id, COVER.thumb))
    .filter((uri): uri is string => !!uri);

  return (
    <Link href={`/genre/${encodeURIComponent(name)}`} asChild>
      <Pressable
        style={StyleSheet.flatten([
          styles.card,
          { backgroundColor: card },
          width != null ? { width } : { flex: 1 },
        ])}
      >
        {/* Back one first, so the more turned one lands on top of it. The card
            has no padding of its own: these are positioned against its edges,
            and the label carries the insets instead. */}
        {art.map((uri, i) => (
          <View key={i} style={i === 0 ? styles.back : styles.front}>
            <Cover uri={uri} size={ART_SIZE} style={styles.cover} />
          </View>
        ))}
        <View style={styles.label}>
          <Text style={[styles.name, { color: ink }]} numberOfLines={2}>
            {name}
          </Text>
          {albumCount != null ? (
            <Text style={[styles.count, { color: ink }]} numberOfLines={1}>
              {albumsLabel(albumCount, lang)}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = themed((colors) => ({
  card: { height: GENRE_CARD_HEIGHT, borderRadius: radius.lg, overflow: 'hidden' },
  /** The right inset is what keeps the name clear of the covers. */
  label: { paddingTop: spacing.md, paddingLeft: spacing.md, paddingRight: ART_SIZE },
  name: { fontSize: fontSize.md, fontWeight: '600' },
  count: { fontSize: fontSize.sm, marginTop: 2 },
  // Both hang off the right edge and out of the bottom; the card clips them,
  // which is what makes the pair read as a stack rather than as two pictures.
  // The background is not decoration: Android takes the shadow from the view's
  // outline, and a view with nothing behind it has none, so a rounded cover
  // would be given a square one.
  back: {
    position: 'absolute',
    top: 16,
    right: -6,
    transform: [{ rotate: '10deg' }],
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceHighlight,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  front: {
    position: 'absolute',
    top: 28,
    right: -26,
    transform: [{ rotate: '25deg' }],
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceHighlight,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  cover: { borderRadius: radius.lg },
}));
