/**
 * One radio: what its Home card opens — the tracks it is about to play over
 * the seed's colour, with the two buttons Spotify puts there (shuffle beside
 * play, both on the right).
 *
 * The definition comes from what Home saved when it has it and is built here
 * when it doesn't (a deep link, or the section turned off); the tracks are
 * fetched fresh every time the list goes stale, so the radio plays the
 * library as it is now rather than a queue someone wrote down last month.
 */
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Icon from '@/components/Icon';
import { COVER, coverArtUrl, getArtist } from '@/api/data';
import { AlbumCardsSkeleton } from '@/components/AlbumCardsSkeleton';
import { BackChevron } from '@/components/BackChevron';
import { Message } from '@/components/Message';
import { RadioArt } from '@/components/RadioCard';
import { TrackRow } from '@/components/TrackRow';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useScreenSize } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { textOn } from '@/lib/radioArt';
import { buildRadioDef, radioTracks } from '@/lib/radioBuild';
import { currentSong, usePlayerStore } from '@/store/player';
import { useRadios, type RadioDef } from '@/store/radios';
import { useSettings } from '@/store/settings';
import { useSongMenu } from '@/store/songMenu';
import { colors, fontSize, radius, spacing, themed, useTheme, tracking } from '@/theme';

/** Fisher–Yates, so shuffle plays this radio's own list in another order
 *  (the queue shows exactly what is playing, which a mode flag wouldn't). */
function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function ArtistRadioScreen() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const { width } = useScreenSize();
  const { id } = useLocalSearchParams<{ id: string }>();
  const radioId = id ?? '';
  const t = useT();
  const openSongMenu = useSongMenu((s) => s.open);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const playing = usePlayerStore(currentSong);
  const showListArtwork = useSettings((s) => s.showListArtwork);

  const defQuery = useQuery({
    queryKey: ['radio-def', radioId],
    queryFn: async (): Promise<RadioDef> => {
      const saved = useRadios.getState().defs.find((d) => d.seed.id === radioId);
      if (saved) return saved;
      // Straight into the screen without Home having built anything: make
      // just this one (and leave it out of the store — the section's own
      // refresh decides what belongs there).
      const { artist } = await getArtist(radioId);
      const built = await buildRadioDef({ id: radioId, name: artist.name, coverArt: artist.coverArt });
      if (!built) throw new Error('radio');
      return built;
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
  const def = defQuery.data;

  const tracksQuery = useQuery({
    queryKey: ['radio-tracks', radioId],
    queryFn: () => radioTracks(def as RadioDef),
    enabled: !!def,
    staleTime: 10 * 60 * 1000,
  });
  const tracks = tracksQuery.data ?? [];

  const color = useDominantColor(
    coverArtUrl(def?.seed.coverArt ?? def?.seed.id, COVER.thumb),
    true,
  );
  const ink = textOn(color);
  const title = t('The {artist} Radio', { artist: def?.seed.name ?? '' });
  const href = `/artist-radio/${radioId}`;
  const similarNames = def?.similar.slice(0, 3).map((a) => a.name).join(', ');
  const artWidth = Math.min(260, width - spacing.lg * 2);

  const play = (index: number, shuffledFirst = false) => {
    if (tracks.length === 0) return;
    haptic('medium');
    const list = shuffledFirst ? shuffled(tracks) : tracks;
    void playQueue(list, index, title, href);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <LinearGradient colors={[color, colors.background]} style={styles.header}>
          <View style={styles.backRow}>
            <BackChevron color={ink} />
          </View>
          {def ? (
            <RadioArt def={def} width={artWidth} />
          ) : (
            <View style={[styles.artPlaceholder, { width: artWidth, height: artWidth }]} />
          )}
        </LinearGradient>

        <View style={styles.meta}>
          {def ? (
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
          ) : null}
          {similarNames ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {t('With {artists} and more', { artists: similarNames })}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              hitSlop={10}
              disabled={tracks.length === 0}
              accessibilityRole="button"
              accessibilityLabel={t('Shuffle')}
              onPress={() => play(0, true)}
            >
              <Icon
                name="shuffle"
                size={26}
                color={tracks.length === 0 ? colors.textMuted : colors.text}
              />
            </Pressable>
            <Pressable
              style={[styles.play, { backgroundColor: colors.accent }]}
              disabled={tracks.length === 0}
              accessibilityRole="button"
              accessibilityLabel={t('Play')}
              onPress={() => play(0)}
            >
              {/* Shoved a pixel right of centre: the glyph's own art sits
                  slightly left in the icon font, like the artist screen's. */}
              <Icon
                name="play"
                size={28}
                color={colors.onAccent}
                style={{ marginLeft: 3 }}
              />
            </Pressable>
          </View>
        </View>

        {defQuery.isLoading || tracksQuery.isLoading ? (
          <View style={styles.loading}>
            <AlbumCardsSkeleton horizontal />
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : defQuery.isError ? (
          <Message text={t("Couldn't build the radio.")} onRetry={() => void defQuery.refetch()} />
        ) : tracks.length === 0 ? (
          <Message text={t("Couldn't load songs.")} onRetry={() => void tracksQuery.refetch()} />
        ) : (
          <View style={styles.rows}>
            {tracks.map((song, i) => (
              <TrackRow
                key={song.id}
                song={song}
                isCurrent={song.id === playing?.id}
                showArtwork={showListArtwork}
                onPress={() => play(i)}
                onLongPress={() => {
                  haptic('light');
                  openSongMenu(song);
                }}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed((t) => ({
  safe: { flex: 1, backgroundColor: t.background },
  content: { paddingBottom: spacing.xxl },
  header: {
    alignItems: 'center',
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  backRow: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  artPlaceholder: {
    borderRadius: radius.md,
    backgroundColor: t.surface,
  },
  meta: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    color: t.text,
    fontSize: fontSize.xxl,
    letterSpacing: tracking.display,
    fontWeight: '600',
  },
  subtitle: {
    color: t.textSecondary,
    fontSize: fontSize.sm,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  play: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { gap: spacing.lg, paddingTop: spacing.xl, paddingHorizontal: spacing.lg },
  rows: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.xs },
}));
