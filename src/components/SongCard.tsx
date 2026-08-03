/**
 * Song as a card, for the grid in browsing songs. The row (`TrackRow`) is what
 * every other list uses; this is the same song drawn for a grid, so the screen
 * can offer both views like browsing albums and artists do.
 *
 * Tapping plays, holding starts selecting: what the rows do, so switching view
 * doesn't change what your fingers already know.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { songCoverUrl, type Song } from '@/api/data';
import { colors, fontSize, radius, spacing } from '@/theme';
import { Cover } from './Cover';

interface Props {
  song: Song;
  width: number;
  /** Playing right now: the title takes the accent, as in the rows. */
  isCurrent?: boolean;
  accent: string;
  selecting?: boolean;
  selected?: boolean;
  onPress?: () => void;
  onPressIn?: () => void;
  onLongPress?: () => void;
}

export const SongCard = memo(function SongCard({
  song,
  width,
  isCurrent,
  accent,
  selecting,
  selected,
  onPress,
  onPressIn,
  onLongPress,
}: Props) {
  return (
    <Pressable
      style={[styles.container, { width }]}
      onPress={onPress}
      onPressIn={onPressIn}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={selecting ? { selected: !!selected } : undefined}
    >
      <View>
        <Cover uri={songCoverUrl(song, 300)} size={width} />
        {/* Only while selecting: a tick on every cover the rest of the time
            would be noise on top of the artwork. */}
        {selecting ? (
          <View style={[styles.check, selected && { backgroundColor: accent }]}>
            {selected ? <Ionicons name="checkmark" size={16} color="#000" /> : null}
          </View>
        ) : null}
        {/* Dimmed rather than hidden: it is in the library, it just isn't on
            this device, same as the rows show it. */}
        {song.unavailable ? <View style={[styles.veil, { width, height: width }]} /> : null}
      </View>
      <Text style={[styles.title, isCurrent && { color: accent }]} numberOfLines={1}>
        {song.title}
      </Text>
      {song.artist ? (
        <Text style={styles.artist} numberOfLines={1}>
          {song.artist}
        </Text>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  title: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  artist: { color: colors.textSecondary, fontSize: fontSize.xs },
  check: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  veil: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: radius.md,
    backgroundColor: 'rgba(18,18,18,0.6)',
  },
});
