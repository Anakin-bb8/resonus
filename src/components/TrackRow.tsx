/** Song row inside a list (album, playlist, search results). */
import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { songCoverUrl, star } from '@/api/data';
import { type Song } from '@/api/subsonic';
import { useFavoriteIds } from '@/hooks/useFavoriteIds';
import { formatDuration } from '@/lib/format';
import { applyStarChange, resyncFavorites, unstarWithUndo } from '@/lib/favoritesCache';
import { useDownloads } from '@/store/downloads';
import { usePlayerStore } from '@/store/player';
import { useSongMenu, type SongMenuContext } from '@/store/songMenu';
import { useSettings, type SwipeAction } from '@/store/settings';
import { haptic } from '@/lib/haptics';
import { useToast } from '@/store/toast';
import { useT } from '@/i18n';
import { colors, fontSize, spacing } from '@/theme';
import { Cover } from './Cover';
import { FavoriteButton } from './FavoriteButton';

interface Props {
  song: Song;
  /**
   * Optional number on the left (e.g. the track number on an album). Coexists
   * with the cover: number then cover (Spotify's "Popular" style).
   */
  position?: number;
  isCurrent?: boolean;
  /** Playlist context (to allow "remove from list" in the menu). */
  menuContext?: SongMenuContext;
  /**
   * Allows showing the heart for favorited songs (default true). Only appears
   * if the song is marked as favorite (Spotify style). Offline passes `false`
   * (no server favorites).
   */
  showFavorite?: boolean;
  /** Shows the ⋯ menu button (default true; works offline too). */
  showMenu?: boolean;
  /** Shows the mini album cover on the left (Spotify style). */
  showArtwork?: boolean;
  /** Multi-select mode: check circle and no swipe/menu/heart. */
  selecting?: boolean;
  /** Marked in selection mode. */
  selected?: boolean;
  onLongPress?: () => void;
  onPress: () => void;
  /** Press start (before onPress/onLongPress); used by the list to discard the
   *  onPress that follows the long-press to enter selection. */
  onPressIn?: () => void;
}

/** Swipe strip icon according to the configured action. */
const SWIPE_ICON: Record<Exclude<SwipeAction, 'off'>, keyof typeof Ionicons.glyphMap> = {
  queue: 'list',
  next: 'play-forward',
  favorite: 'heart',
  menu: 'ellipsis-horizontal',
};

/**
 * Action strip that peeks out behind the row during swipe. Invisible at rest:
 * the row is transparent (lets the header gradient through, Spotify style),
 * so the strip can only exist while the gesture lasts.
 */
function SwipeActionPanel({
  progress,
  icon,
  side,
}: {
  progress: SharedValue<number>;
  icon: keyof typeof Ionicons.glyphMap;
  /** Side where the strip peeks out: the icon sticks to the edge it enters from. */
  side: 'left' | 'right';
}) {
  const visible = useAnimatedStyle(() => ({ opacity: progress.value > 0.01 ? 1 : 0 }));
  return (
    <Reanimated.View
      style={[
        styles.queueAction,
        { backgroundColor: colors.accent, alignItems: side === 'left' ? 'flex-start' : 'flex-end' },
        visible,
      ]}
    >
      <Ionicons name={icon} size={22} color={colors.text} />
    </Reanimated.View>
  );
}

function TrackRowBase({
  song,
  position,
  isCurrent,
  menuContext,
  showFavorite = true,
  showMenu = true,
  showArtwork = false,
  selecting = false,
  selected = false,
  onLongPress,
  onPress,
  onPressIn,
}: Props) {
  const openMenu = useSongMenu((s) => s.open);
  const t = useT();
  const showDuration = useSettings((s) => s.showSongDuration);
  const showRating = useSettings((s) => s.showListRating);
  const swipeAction = useSettings((s) => s.swipeAction);
  const swipeLeftAction = useSettings((s) => s.swipeLeftAction);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const toast = useToast((s) => s.show);
  const swipeRef = useRef<SwipeableMethods>(null);

  // Favorite: the central favorites list (`favIds`) is the reliable source —
  // it reflects mark/unmark upon invalidation. The song's `starred` (which
  // getAlbum fetches but does NOT refresh) is only used as a fallback while that
  // list is still loading; otherwise, unmarking on an album would keep the heart
  // visible (the OR with `song.starred` never became false).
  const favIds = useFavoriteIds(showFavorite);
  const favorited = showFavorite && (favIds ? favIds.has(song.id) : !!song.starred);
  const downloaded = useDownloads((s) => !!s.files[song.id]);
  // Not downloaded in the offline mirror: visible but grayed out and not playable.
  const unavailable = !!song.unavailable;

  // Swipe right = configurable action (Spotify-style gesture). The row returns
  // on its own; the background strip only peaks during the gesture.
  // NOTE: the gesture only coexists well with scroll if the parent list uses
  // react-native-gesture-handler (FlatList/ScrollView from that library).
  async function toggleFavoriteSwipe() {
    // Removing is deferred behind «Undo»; the heart here reads from the cached
    // list, so there is no state of its own to put back.
    if (favorited) {
      unstarWithUndo('song', song.id);
      return;
    }
    try {
      await star(song.id, 'song');
      // The cached list is patched, not thrown away: see `favoritesCache`.
      applyStarChange('song', song.id, true, song);
      toast(t('Added to favorites'));
    } catch {
      resyncFavorites();
      toast(t("Couldn't complete the action"));
    }
  }

  function runSwipeAction(action: SwipeAction) {
    haptic('light');
    swipeRef.current?.close();
    switch (action) {
      case 'queue':
        addToQueue(song);
        toast(t('Added to queue'));
        break;
      case 'next':
        playNext(song);
        toast(t('Playing next'));
        break;
      case 'favorite':
        void toggleFavoriteSwipe();
        break;
      case 'menu':
        openMenu(song, menuContext);
        break;
      default:
        break;
    }
  }

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      // The left strip is opened by swiping RIGHT (and vice versa).
      renderLeftActions={(progress) =>
        swipeAction === 'off' ? null : (
          <SwipeActionPanel progress={progress} icon={SWIPE_ICON[swipeAction]} side="left" />
        )
      }
      renderRightActions={(progress) =>
        swipeLeftAction === 'off' ? null : (
          <SwipeActionPanel progress={progress} icon={SWIPE_ICON[swipeLeftAction]} side="right" />
        )
      }
      // Intentionally less sensitive: `dragOffsetFrom…Edge` requires a clear
      // horizontal path before activating (so a vertical scroll with some
      // lateral movement no longer triggers it accidentally), and the
      // `threshold` requires a substantial drag to confirm the action.
      dragOffsetFromLeftEdge={30}
      dragOffsetFromRightEdge={30}
      leftThreshold={90}
      rightThreshold={90}
      friction={1}
      overshootLeft={false}
      overshootRight={false}
      enabled={!selecting && !unavailable && (swipeAction !== 'off' || swipeLeftAction !== 'off')}
      onSwipeableWillOpen={(direction) => {
        // `direction` is the GESTURE direction (not the panel side):
        // swiping right (opens the left strip) arrives as RIGHT.
        if (direction === SwipeDirection.RIGHT) runSwipeAction(swipeAction);
        else if (direction === SwipeDirection.LEFT) runSwipeAction(swipeLeftAction);
      }}
    >
    <Pressable
      // No visual feedback on press (like Spotify): the "pressed" effect
      // triggered while scrolling and made it look like rows were being tapped.
      // Not downloaded: dimmed and with warning on tap OUTSIDE selection; inside
      // selection it behaves normally (long-press enters, tap marks) so it can
      // be added to a list even though it can't be played.
      style={[styles.row, unavailable && !selecting && styles.dimmed]}
      onPressIn={unavailable && !selecting ? undefined : onPressIn}
      onPress={unavailable && !selecting ? () => toast(t('Not available offline')) : onPress}
      onLongPress={onLongPress}
    >
      {selecting ? (
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={selected ? colors.accent : colors.textMuted}
        />
      ) : null}
      {position !== undefined ? (
        <Text style={[styles.position, styles.leftSlot]}>{position}</Text>
      ) : null}
      {showArtwork ? (
        <View style={styles.artwork}>
          <Cover uri={songCoverUrl(song, 100)} size={44} />
        </View>
      ) : null}

      <View style={styles.info}>
        <Text
          style={[styles.title, isCurrent && { color: colors.accent }]}
          numberOfLines={1}
        >
          {song.title}
        </Text>
        {downloaded || song.artist ? (
          <View style={styles.subRow}>
            {downloaded ? (
              <Ionicons name="arrow-down-circle" size={13} color={colors.accent} />
            ) : null}
            {song.artist ? (
              <Text style={styles.artist} numberOfLines={1}>
                {song.artist}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {favorited && !selecting && !unavailable ? (
        <FavoriteButton id={song.id} starred undo size={20} />
      ) : null}
      {showRating && song.userRating ? (
        <View style={styles.rating} accessibilityLabel={t('Rate {n} stars', { n: song.userRating })}>
          {Array.from({ length: song.userRating }).map((_, i) => (
            <Ionicons key={i} name="star" size={12} color={colors.accent} />
          ))}
        </View>
      ) : null}
      {showDuration ? <Text style={styles.duration}>{formatDuration(song.duration)}</Text> : null}
      {showMenu && !selecting && !unavailable ? (
        <Pressable
          hitSlop={8}
          style={styles.menuButton}
          accessibilityRole="button"
          accessibilityLabel={t('More options')}
          onPress={() => openMenu(song, menuContext)}
        >
          <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </Pressable>
    </ReanimatedSwipeable>
  );
}

function sameMenuContext(a?: SongMenuContext, b?: SongMenuContext): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.playlistId === b.playlistId && a.index === b.index;
}

/**
 * `memo` comparison: re-renders only if something the row paints or how it
 * behaves changes. Callbacks (`onPress`/`onPressIn`) are recreated on every
 * parent render, but their behavior depends only on `song` and on the state
 * already compared here (selecting/selected), not on their identity, so that
 * is intentionally ignored; for `onLongPress` only whether it's active (allows
 * entering selection) matters. Without this, changing the current song would
 * re-render ALL visible rows (each receives new closures), not just the two
 * whose `isCurrent` changes. Internal subscriptions (downloads, settings,
 * favorites) keep re-rendering their row on their own when needed.
 */
function propsEqual(a: Props, b: Props): boolean {
  return (
    a.song === b.song &&
    a.position === b.position &&
    a.isCurrent === b.isCurrent &&
    a.showFavorite === b.showFavorite &&
    a.showMenu === b.showMenu &&
    a.showArtwork === b.showArtwork &&
    a.selecting === b.selecting &&
    a.selected === b.selected &&
    !!a.onLongPress === !!b.onLongPress &&
    sameMenuContext(a.menuContext, b.menuContext)
  );
}

export const TrackRow = memo(TrackRowBase, propsEqual);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
    // Transparent: the header color gradient (album/playlist) seeps through
    // the first rows, like Spotify. The swipe action no longer needs to be
    // covered: it hides on its own at rest (see QueueAction).
  },
  queueAction: {
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.accent,
  },
  position: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  leftSlot: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Separates the three-dot icon from the right edge and expands the touch area
  // (Spotify style): the vertical padding makes almost the entire row height
  // on that side tappable, so it's much easier to hit with a finger.
  menuButton: {
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
    paddingVertical: spacing.md,
  },
  artwork: {
    width: 44,
    height: 44,
  },
  info: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.md,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  artist: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    flexShrink: 1,
  },
  duration: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  rating: {
    flexDirection: 'row',
    gap: 1,
  },
  // Song not available offline (mirror): dimmed and not tappable.
  dimmed: {
    opacity: 0.4,
  },
});
