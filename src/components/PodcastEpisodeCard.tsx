/** Episode card for the «Recent episodes» shelf on Home. */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Icon from '@/components/Icon';
import { COVER, coverArtUrl } from '@/api/data';
import { episodeToSong, type RecentEpisode } from '@/api/podcasts';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useEpisodeUnavailable } from '@/hooks/useEpisodeUnavailable';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { useToast } from '@/store/toast';
import { fontSize, spacing, themed, useTheme } from '@/theme';
import { Cover } from './Cover';

interface Props {
  item: RecentEpisode;
  width?: number;
}

export function PodcastEpisodeCard({ item, width = 150 }: Props) {
  const { accent } = useTheme();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const t = useT();
  const toast = useToast((s) => s.show);
  const { episode, channel } = item;
  // Offline and not downloaded: dimmed, tap says so (as `TrackRow` does).
  const unavailable = useEpisodeUnavailable(episode.id);
  // On disk: the ↓ badge, shown online too — the same mark `TrackRow` gives a
  // downloaded song, so a downloaded episode reads as offline-playable.
  const downloaded = useDownloads((s) => !!s.files[episode.id]);
  // The show's artwork: episode art is often missing or the same image.
  const cover = coverArtUrl(channel.imageUrl, COVER.card);

  return (
    <Pressable
      style={StyleSheet.flatten([styles.container, unavailable && styles.dimmed, { width }])}
      accessibilityRole="button"
      onPress={
        unavailable
          ? () => toast(t('Not available offline'))
          : () => {
              haptic('light');
              // Just this episode; the show's screen queues the rest.
              void playQueue(
                [episodeToSong(episode, channel)],
                0,
                channel.title,
                `/podcast/${channel.id}`,
              );
            }
      }
    >
      <Cover uri={cover} size={width} placeholderIcon="headset-outline" />
      {/* Two lines: episode titles are sentences. */}
      <Text style={styles.title} numberOfLines={2}>
        {episode.title}
      </Text>
      <View style={styles.subLine}>
        {downloaded ? <Icon name="arrow-down-circle" size={13} color={accent} /> : null}
        <Text style={styles.sub} numberOfLines={1}>
          {channel.title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = themed((colors) => ({
  container: { gap: spacing.xs },
  // Offline and not downloaded: same dim as `TrackRow`'s.
  dimmed: { opacity: 0.4 },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sub: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    flexShrink: 1,
  },
}));
