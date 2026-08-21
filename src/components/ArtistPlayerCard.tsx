import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COVER, coverArtUrl, getArtistInfo } from '@/api/data';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useT } from '@/i18n';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors, fontSize, spacing, themed } from '@/theme';

export function ArtistPlayerCard() {
  const t = useT();
  const router = useRouter();
  const song = usePlayerStore(currentSong);
  const artistId = song?.artistId;

  // Bio state: default false to show up to 3 lines
  const [bioExpanded, setBioExpanded] = useState(false);

  // Background color option matching LyricsCard
  const tinted = useSettings((s) => s.lyricsCardBackground) !== 'none';

  // Fetch artist biography and imagery metadata
  const { data: info } = useQuery({
    queryKey: ['artistInfo', artistId],
    queryFn: () => getArtistInfo(artistId!),
    enabled: !!artistId,
  });

  const imageUri =
    info?.imageUrl ?? (artistId ? coverArtUrl(artistId, COVER.full) : undefined);

  // Extract dominant color for card background if enabled
  const dominant = useDominantColor(
    tinted && artistId ? coverArtUrl(artistId, COVER.card) : undefined,
  );
  const bg = tinted ? dominant : colors.surface;

  if (!song || !artistId) return null;

  return (
    <View style={[styles.card, { backgroundColor: bg }]}>
      {/* Landscape Header Image Box */}
      <View style={styles.imageContainer}>
        {imageUri && (
          <Image
            source={{ uri: imageUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        )}
        {/* Top-left label overlaid on the image */}
        <Text style={styles.headerLabel}>{t('About the artist')}</Text>
      </View>

      {/* Dark Footer Panel */}
      <View style={styles.footerPanel}>
        {/* Artist Name Header */}
        <Text style={styles.artistName} numberOfLines={1}>
          {song.artist}
        </Text>

        {/* Biography Text (truncated at 3 lines unless expanded) */}
        {info?.biography ? (
          <View style={styles.bioContainer}>
            <Text
              style={styles.bioText}
              numberOfLines={bioExpanded ? undefined : 3}
            >
              {info.biography}
            </Text>
            <Pressable
              hitSlop={8}
              onPress={() => {
                if (bioExpanded) {
                  // Collapse back to 3 lines
                  setBioExpanded(false);
                } else {
                  // Navigate to full artist page
                  router.push(`/artist/${artistId}`);
                }
              }}
            >
              <Text style={styles.moreInfo}>
                {bioExpanded ? t('less information') : t('more information')}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = themed((colors) => ({
  card: {
    borderRadius: 16,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  imageContainer: {
    height: 180,
    width: '100%',
    position: 'relative',
    backgroundColor: colors.surface,
  },
  headerLabel: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  footerPanel: {
    backgroundColor: '#121212', // Dark background bar
    padding: spacing.lg,
  },
  artistName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  bioContainer: {
    marginTop: spacing.xs,
  },
  bioText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  moreInfo: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
}));