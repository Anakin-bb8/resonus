/**
 * Spotify/Apple Music style lyrics for the player: card below the controls
 * with the cover's dominant color. Inside, karaoke with auto-scroll if the
 * lyrics are synced (tapping a line seeks to that point) and animated focus on
 * the current line (the rest are dimmed). Button to expand to full screen
 * (/lyrics). If the song has no lyrics, nothing is rendered.
 */
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollViewOffset,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { COVER, songCoverUrl } from '@/api/data';
import { type LyricLine } from '@/api/subsonic';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useLyrics } from '@/hooks/useLyrics';
import { useT } from '@/i18n';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors, fontSize, radius, spacing } from '@/theme';

export function LyricsCard() {
  const t = useT();
  const router = useRouter();
  const song = usePlayerStore(currentSong);
  const { data } = useLyrics(song ?? undefined);
  // Same setting as the full screen; without color, neutral gray (surface)
  // so the card still stands out from the player background.
  // Its own setting (no blurred-cover option): `bg` doubles as the solid
  // `fadeColor` the synced lyrics fade into, which an image can't provide.
  const tinted = useSettings((s) => s.lyricsCardBackground) !== 'none';
  const dominant = useDominantColor(
    // Without color the palette is not extracted (same savings the player does).
    tinted ? song ? songCoverUrl(song, COVER.card) : undefined : undefined,
  );
  const bg = tinted ? dominant : colors.surface;

  if (!data) return null;

  return (
    <View style={[styles.card, { backgroundColor: bg }]}>
      <Text style={styles.title}>{t('Lyrics')}</Text>
      <View style={styles.body}>
        {data.synced ? (
          <SyncedLyricsView lines={data.lines} nested fadeColor={bg} />
        ) : (
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <Text style={lyricsStyles.line}>{data.lines.map((l) => l.value).join('\n')}</Text>
          </ScrollView>
        )}
      </View>
      <Pressable
        style={({ pressed }) => [styles.expand, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={t('Lyrics')}
        hitSlop={8}
        onPress={() => router.push('/lyrics')}
      >
        <MaterialIcons name="open-in-full" size={16} color="#000" />
      </Pressable>
    </View>
  );
}

/**
 * Lyrics in place of the cover art ("Lyrics on the cover" setting): occupies
 * the same box as the player cover. Same karaoke as the card, with a button
 * in the corner to go back to the cover. If there are no lyrics, nothing is
 * rendered (the caller only mounts it when lyrics exist).
 */
export function CoverLyrics({ size, onClose }: { size: number; onClose: () => void }) {
  const t = useT();
  const song = usePlayerStore(currentSong);
  const { data } = useLyrics(song ?? undefined);

  if (!data) return null;

  return (
    // Transparent background: the lyrics go directly over the player background
    // (the cover is hidden while showing).
    <View style={[styles.coverBox, { width: size, height: size }]}>
      <View style={styles.coverBody}>
        {data.synced ? (
          <SyncedLyricsView lines={data.lines} nested />
        ) : (
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <Text style={lyricsStyles.line}>{data.lines.map((l) => l.value).join('\n')}</Text>
          </ScrollView>
        )}
      </View>
      <Pressable
        style={({ pressed }) => [styles.expand, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={t('Show cover')}
        hitSlop={8}
        onPress={onClose}
      >
        <MaterialIcons name="image" size={16} color="#000" />
      </Pressable>
    </View>
  );
}

/**
 * Reusable karaoke list (card and full screen): the current line lights up
 * and grows a little (spring), the rest are dimmed. Auto-scroll keeps the
 * focus above; manual scroll pauses it for a few seconds. Tapping a line
 * seeks to that point in the song.
 */
export function SyncedLyricsView({
  lines,
  large,
  nested,
  fadeColor,
}: {
  lines: LyricLine[];
  /** Large typography (full screen). */
  large?: boolean;
  /** Inside another scroll (the player card). */
  nested?: boolean;
  /** Color to which the top/bottom edges fade (the background). */
  fadeColor?: string;
}) {
  const positionSec = usePlayerStore((s) => s.positionSec);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  // Real scroll position (regardless of who moved it: user or auto-scroll).
  const liveY = useScrollViewOffset(scrollRef);
  // Auto-scroll target. Animated with Reanimated (not native smooth-scroll) for
  // two reasons: native respects the system animation scale (with "reduced
  // motion" it snaps abruptly) and while running, the ScrollView swallows taps
  // on the lines.
  const targetY = useSharedValue(0);
  const offsets = useRef<{ y: number; h: number }[]>([]);
  const userScroll = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The first positioning jumps directly to the current line (no animation),
  // to avoid a quick, ugly scroll from the top on open. From then on, the
  // advance from one line to the next IS animated.
  const didInitialScroll = useRef(false);
  const [viewH, setViewH] = useState(0);
  /**
   * Bumped when the line we are trying to reach finally reports where it is.
   *
   * The positioning below reads those places out of a ref, and a ref filling up
   * re-renders nothing, so opening the lyrics part way through a song left them
   * sitting at the very top: the view had been measured and the right line was
   * known, but its position had not arrived yet, and nothing asked again. They
   * stayed there until the song moved on a line, which is the next thing that
   * runs the effect, and only then did they travel. Now the measurement itself
   * says so, once, and only while there is still a first jump to make.
   */
  const [placed, setPlaced] = useState(0);
  /** What `onMeasure` needs to know without being rebuilt on every line. */
  const currentRef = useRef(-1);

  // Small advance so the highlight doesn't lag behind the ear.
  const posMs = positionSec * 1000 + 300;
  let current = -1;
  for (let i = 0; i < lines.length && (lines[i].start ?? 0) <= posMs; i++) current = i;
  currentRef.current = current;

  // In full screen we anchor the active line near the center (and pad
  // top/bottom) so that when the song starts, the lyrics begin centered and
  // readable, not stuck to the top edge. On the small card, higher up.
  const anchor = large ? 0.42 : 0.3;

  const onMeasure = useCallback((index: number, y: number, h: number) => {
    offsets.current[index] = { y, h };
    if (!didInitialScroll.current && index === currentRef.current) setPlaced((n) => n + 1);
  }, []);

  // Each targetY change pushes the scroll from the UI thread.
  useAnimatedReaction(
    () => targetY.value,
    (y, prev) => {
      if (prev !== null && y !== prev) scrollTo(scrollRef, 0, y, false);
    },
  );

  // Tapping a line is an intentional seek: we cancel the auto-scroll pause
  // triggered by manual scroll (the user usually scrolled to reach this
  // line), so the focus recenters on the chosen line instantly.
  const onLineTap = useCallback(
    (sec: number) => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      userScroll.current = false;
      seekTo(sec);
    },
    [seekTo],
  );

  // Taps are detected with a separate gesture (not each line's onPress): the
  // gesture coexists with scroll and works even while auto-scroll is active.
  // The line is located by vertical position using actual measurements.
  const handleTap = useCallback(
    (yInView: number) => {
      const contentY = yInView + liveY.value;
      for (let i = 0; i < lines.length; i++) {
        const m = offsets.current[i];
        if (m && contentY >= m.y && contentY < m.y + m.h) {
          if (lines[i].start !== undefined) onLineTap(lines[i].start! / 1000);
          return;
        }
      }
    },
    [lines, onLineTap, liveY],
  );

  const tapGesture = Gesture.Tap()
    .maxDuration(300)
    .onEnd((e) => {
      scheduleOnRN(handleTap, e.y);
    });

  useEffect(() => {
    if (current < 0 || viewH === 0 || userScroll.current) return;
    const m = offsets.current[current];
    if (m === undefined) return;
    const dest = Math.max(0, m.y - viewH * anchor);
    cancelAnimation(targetY);
    if (!didInitialScroll.current) {
      targetY.value = dest; // direct jump, without animating
      didInitialScroll.current = true;
      return;
    }
    // We start from the real position (the user may have scrolled) and animate
    // ourselves: same path on any device, regardless of whether the system
    // ignores animations.
    targetY.value = liveY.value;
    targetY.value = withTiming(dest, {
      duration: 450,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.Never,
    });
  }, [current, viewH, anchor, targetY, liveY, placed]);

  // Another song's lyrics are another first positioning: the places measured
  // for the last one mean nothing here, and without this the jump to the top of
  // a new song was animated as if it were a line advancing, which is a long
  // ride up from wherever the last one had got to.
  useEffect(() => {
    didInitialScroll.current = false;
    offsets.current = [];
  }, [lines]);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );

  const fadeH = large ? 56 : 36;

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={tapGesture}>
      <Animated.ScrollView
        ref={scrollRef}
        nestedScrollEnabled={nested}
        onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
        onScrollBeginDrag={() => {
          userScroll.current = true;
          cancelAnimation(targetY);
          if (resumeTimer.current) clearTimeout(resumeTimer.current);
        }}
        onScrollEndDrag={() => {
          resumeTimer.current = setTimeout(() => {
            userScroll.current = false;
          }, 3000);
        }}
        contentContainerStyle={[
          styles.content,
          // Padding so the first/last line can rest at the anchor (center)
          // instead of being stuck at the top/bottom. Full screen only.
          large && viewH > 0 ? { paddingTop: viewH * anchor, paddingBottom: viewH * (1 - anchor) } : null,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {lines.map((line, i) => (
          <LyricRow
            key={i}
            index={i}
            text={line.value.trim() || '♪'}
            active={i === current}
            next={i === current + 1}
            large={large}
            onMeasure={onMeasure}
          />
        ))}
      </Animated.ScrollView>
      </GestureDetector>
      {fadeColor ? (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={[fadeColor, `${fadeColor}00`]}
            style={[styles.fade, { top: 0, height: fadeH }]}
          />
          <LinearGradient
            pointerEvents="none"
            colors={[`${fadeColor}00`, fadeColor]}
            style={[styles.fade, { bottom: 0, height: fadeH }]}
          />
        </>
      ) : null}
    </View>
  );
}

/** A lyric line with animated focus (spring on activation). */
const LyricRow = memo(({
  index,
  text,
  active,
  next,
  large,
  onMeasure,
}: {
  index: number;
  text: string;
  active: boolean;
  next: boolean;
  large?: boolean;
  onMeasure: (index: number, y: number, h: number) => void;
}) => {
  // Only the active line grows (spring) and is visible at 100%. The rest are
  // dimmed: the next one about to play a little, the others much more.
  const focus = useSharedValue(active ? 1 : 0);
  const dim = useSharedValue(active ? 1 : next ? 0.55 : 0.3);
  // reduceMotion Never: the transition between lines (karaoke) is the essence
  // of the screen; without this, devices with "reduce motion" skip it.
  useEffect(() => {
    focus.value = withSpring(active ? 1 : 0, {
      damping: 20,
      stiffness: 180,
      mass: 0.5,
      reduceMotion: ReduceMotion.Never,
    });
  }, [active, focus]);
  useEffect(() => {
    dim.value = withTiming(active ? 1 : next ? 0.55 : 0.3, {
      duration: 300,
      reduceMotion: ReduceMotion.Never,
    });
  }, [active, next, dim]);
  // The growth (8%) is compensated by the right margin of `content` so the
  // active line, scaling from the left, doesn't overflow the edge.
  const anim = useAnimatedStyle(() => ({
    opacity: dim.value,
    transform: [{ scale: 1 + focus.value * 0.08 }],
  }));
  return (
    <View
      onLayout={(e) => onMeasure(index, e.nativeEvent.layout.y, e.nativeEvent.layout.height)}
    >
      <Animated.Text style={[lyricsStyles.line, large && lyricsStyles.lineLarge, styles.leftOrigin, anim]}>
        {text}
      </Animated.Text>
    </View>
  );
});
LyricRow.displayName = 'LyricRow';

/** Typography shared by the card and the full screen. */
export const lyricsStyles = StyleSheet.create({
  line: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 30,
    fontWeight: '700',
    paddingVertical: spacing.xs,
  },
  lineLarge: { fontSize: 28, lineHeight: 40, paddingVertical: spacing.sm },
});

const CARD_BODY_H = 280;

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
    // The player no longer has global horizontal padding (because of the
    // slider): the card supplies its own margin.
    marginHorizontal: spacing.xl,
    padding: spacing.lg,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '700', marginBottom: spacing.sm },
  body: { height: CARD_BODY_H, overflow: 'hidden' },
  // Lyrics in place of the cover: box exactly the size of the cover.
  coverBox: { borderRadius: radius.md, overflow: 'hidden', padding: spacing.lg },
  coverBody: { flex: 1, overflow: 'hidden' },
  wrap: { flex: 1 },
  // Right margin so the active line (which grows 8% from the left) doesn't get
  // clipped against the edge.
  content: { paddingBottom: spacing.xl, paddingRight: '10%' },
  leftOrigin: { transformOrigin: 'left center' },
  fade: { position: 'absolute', left: 0, right: 0 },
  expand: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
