/**
 * Spotify/Apple Music style lyrics for the player: card below the controls
 * with the cover's dominant color. Inside, karaoke with auto-scroll if the
 * lyrics are synced (tapping a line seeks to that point) and animated focus on
 * the current line (the rest are dimmed). Button to expand to full screen
 * (/lyrics). If the song has no lyrics, nothing is rendered.
 */
import Icon from '@/components/Icon';
import { LinearGradient } from 'expo-linear-gradient';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollViewOffset,
  useSharedValue,
  type SharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { COVER, songCoverUrl } from '@/api/data';
import { useCoverRadius } from '@/components/Cover';
import { type LyricBacking, type LyricLine, type LyricWord } from '@/api/subsonic';
import { useDominantColor } from '@/hooks/useDominantColor';
import { useLyrics } from '@/hooks/useLyrics';
import { useT } from '@/i18n';
import {
  activeIndex,
  clamp01,
  focusIndex,
  hasGapAfter,
  hasIntroGap,
  lineEndMs,
  stanzaBreaks,
  WORD_RISE_PX,
  wordFill,
  wordLift,
} from '@/lib/lyricSweep';
import { wordEnds } from '@/lib/lyricWords';
import { pushOnce } from '@/lib/pushOnce';
import { currentSong, usePlayerStore } from '@/store/player';
import { useSettings } from '@/store/settings';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';
import { motion } from '@/theme/motion';

export function LyricsCard() {
  const t = useT();
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
  const lineStyle = useLyricsLineStyle();
  const centered = useSettings((s) => s.lyricsAlign) === 'center';

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
            contentContainerStyle={[styles.content, centered && styles.contentCentered]}
          >
            <Text style={lineStyle}>{data.lines.map((l) => l.value).join('\n')}</Text>
          </ScrollView>
        )}
      </View>
      <Pressable
        style={({ pressed }) => [styles.expand, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={t('Lyrics')}
        hitSlop={8}
        onPress={() => pushOnce('/lyrics')}
      >
        <Icon name="expand-outline" size={16} color={colors.onInverse} />
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
  const corner = useCoverRadius(size);
  const song = usePlayerStore(currentSong);
  const { data } = useLyrics(song ?? undefined);
  const lineStyle = useLyricsLineStyle();
  const centered = useSettings((s) => s.lyricsAlign) === 'center';

  if (!data) return null;

  return (
    // Transparent background: the lyrics go directly over the player background
    // (the cover is hidden while showing).
    <View style={[styles.coverBox, { width: size, height: size, borderRadius: corner }]}>
      <View style={styles.coverBody}>
        {data.synced ? (
          <SyncedLyricsView lines={data.lines} nested />
        ) : (
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.content, centered && styles.contentCentered]}
          >
            <Text style={lineStyle}>{data.lines.map((l) => l.value).join('\n')}</Text>
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
        <Icon name="image-outline" size={16} color={colors.onInverse} />
      </Pressable>
    </View>
  );
}

/**
 * The Apple/BitChord motion curve every lyric transition shares: rows,
 * scroll, backing lines. One curve so the whole panel moves as one.
 */
const LYRIC_EASING = Easing.bezier(0.41, 0, 0.12, 0.99);
/** How long a row takes to settle into its dim/scale (BitChord `LYRIC_SETTLE_MS`). */
const LYRIC_SETTLE_MS = 400;
/** Stagger between rows arriving one behind another (BitChord `STAGGER_*`). */
const STAGGER_FRACTION = 0.06;
const STAGGER_STEPS = 3;

/**
 * Reusable karaoke list (card and full screen): the current line wipes bright
 * word by word while the rest fall off by distance. Auto-scroll aims slightly
 * ahead so long notes arrive centered. Manual scroll pauses it for a few
 * seconds. Tapping a line seeks to that point in the song.
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
  // Two cursors, like BitChord: `active` drives brightness (never runs ahead
  // of the ear), `focus` drives the scroll (looks slightly ahead so held notes
  // arrive centered). Both move every few seconds, not twice a second.
  const active = usePlayerStore((s) => activeIndex(lines, s.positionSec * 1000 + LINE_LEAD_MS));
  const focus = usePlayerStore((s) => focusIndex(lines, s.positionSec * 1000 + LINE_LEAD_MS));
  // The 60fps word clock, shared by every row: one interval per list, read on
  // the UI thread, so rows animate without re-rendering.
  const pos = useSungPosition();
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
  const [viewH, setViewH] = useState(0);
  /**
   * Bumped when the line being aimed at finally reports where it is.
   *
   * The positioning below waits for that, and reads it out of a ref, and a ref
   * filling up re-renders nothing: opening the lyrics part way through a song
   * left them at the top, because by the time the line answered there was
   * nothing listening. What ran the positioning next was the song moving on a
   * line, so they sat still and then travelled, one line late, every time. Now
   * the measurement says so itself.
   */
  const [placed, setPlaced] = useState(0);
  /** The line already positioned for, so a measurement only speaks up once. */
  const placedFor = useRef(-1);
  /** What `onMeasure` needs to know without being rebuilt on every line. */
  const focusRef = useRef(-1);

  focusRef.current = focus;

  // Apple/BitChord centers the sung line: full-screen anchor is the middle,
  // the small card sits higher.
  const anchor = large ? 0.5 : 0.3;
  // Stanza openings breathe wider above them; the marks come from the
  // source, else from long silences (servers send no stanza info).
  const breaks = useMemo(() => stanzaBreaks(lines), [lines]);
  const centered = useSettings((s) => s.lyricsAlign) === 'center';

  const onMeasure = useCallback((index: number, y: number, h: number) => {
    offsets.current[index] = { y, h };
    // Only the line being waited for, and only until it has been reached: one
    // render, not one per line.
    if (index === focusRef.current && placedFor.current !== index) setPlaced((n) => n + 1);
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
    if (focus < 0 || viewH === 0 || userScroll.current) return;
    const m = offsets.current[focus];
    if (m === undefined) return;
    const dest = Math.max(0, m.y - viewH * anchor);
    cancelAnimation(targetY);
    placedFor.current = focus;
    // We start from the real position (the user may have scrolled) and animate
    // ourselves: same path on any device, regardless of whether the system
    // ignores animations. Opening part way through a song is the same journey
    // as any other, taken as soon as there is somewhere to go rather than at
    // the next line. Same curve as the rows, so panel and text move as one.
    targetY.value = liveY.value;
    targetY.value = withTiming(dest, {
      duration: motion.duration.scroll,
      easing: LYRIC_EASING,
      reduceMotion: motion.reduceMotion.essential,
    });
  }, [focus, viewH, anchor, targetY, liveY, placed]);

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
          centered && styles.contentCentered,
          // Padding so the first/last line can rest at the anchor (center)
          // instead of being stuck at the top/bottom. Full screen only.
          large && viewH > 0 ? { paddingTop: viewH * anchor, paddingBottom: viewH * (1 - anchor) } : null,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {hasIntroGap(lines) && (lines[0].start ?? 0) > 0 ? (
          <GapDots start={0} end={lines[0].start ?? 0} pos={pos} large={large} />
        ) : null}
        {lines.map((line, i) => {
          // Computed here so the leader below reads the same silence the
          // scroll lead was derived from.
          const gap = hasGapAfter(lines, i) ? gapBounds(lines, i) : null;
          return (
          // Fragment, not a View: LyricRow's own onLayout must report `y`
          // relative to the scroll content. A wrapper would reset every row
          // to y≈0 and both auto-scroll and tap-to-seek would aim at the top.
          <Fragment key={i}>
            <LyricRow
              index={i}
              text={line.value.trim() || '♪'}
              words={line.words}
              backing={line.backing}
              active={i === active}
              past={active >= 0 && i < active}
              next={i === active + 1}
              stanza={breaks.has(i)}
              behind={i - focus}
              pos={pos}
              handover={handoverOf(lines, i)}
              large={large}
              centered={centered}
              onMeasure={onMeasure}
            />
            {gap ? <GapDots start={gap.start} end={gap.end} pos={pos} large={large} /> : null}
          </Fragment>
          );
        })}
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

/**
 * A lyric line with animated focus.
 *
 * Like BitChord: the active line is full-size and full-bright, the rest fall
 * off (past nearly as bright, the next semi-dimmed, everything else faint,
 * inactive slightly shrunk). Rows behind the focus arrive staggered, one
 * after another, on the same curve as the scroll.
 */
const LyricRow = memo(({
  index,
  text,
  words,
  backing,
  active,
  past,
  next,
  stanza,
  behind,
  pos,
  handover,
  large,
  centered,
  onMeasure,
}: {
  index: number;
  text: string;
  words?: LyricWord[];
  /** Backing vocals sung under this line, shown only while pronounced. */
  backing?: LyricBacking[];
  active: boolean;
  /** Lines before the current one: same colour as active, slightly dimmer. */
  past: boolean;
  next: boolean;
  /** Opens a new stanza: breathes wider above it. */
  stanza: boolean;
  /** Rows behind the scroll focus, for the stagger. */
  behind: number;
  /** The shared 60fps word clock (one per list). */
  pos: SharedValue<number>;
  /** When the row stops being the active one, in the clock the words fill at. */
  handover?: number;
  large?: boolean;
  centered: boolean;
  onMeasure: (index: number, y: number, h: number) => void;
}) => {
  // Memoized, so the screen repainting is not enough to bring this one along.
  useTheme();
  // No blur on the falloff (as BitChord has): a BlurView per row would not
  // survive Expo Go lists at 60fps. Opacity + scale carry the depth instead.
  const dim = useSharedValue(past ? 0.85 : active ? 1 : next ? 0.55 : 0.3);
  const settled = useSharedValue(active ? 1 : 0);
  // reduceMotion essential: the transition between lines (karaoke) is the
  // essence of the screen; without Never, devices with "reduce motion" skip it.
  const essential = motion.reduceMotion.essential;
  const staggerMs =
    Math.min(Math.max(behind, 0), STAGGER_STEPS) * STAGGER_FRACTION * LYRIC_SETTLE_MS;
  useEffect(() => {
    const targetDim = past ? 0.85 : active ? 1 : next ? 0.55 : 0.3;
    dim.value =
      staggerMs > 0
        ? withDelay(staggerMs, withTiming(targetDim, { duration: LYRIC_SETTLE_MS, easing: LYRIC_EASING, reduceMotion: essential }))
        : withTiming(targetDim, { duration: LYRIC_SETTLE_MS, easing: LYRIC_EASING, reduceMotion: essential });
  }, [active, past, next, staggerMs, dim, essential]);
  useEffect(() => {
    settled.value = withTiming(active ? 1 : 0, {
      duration: LYRIC_SETTLE_MS,
      easing: LYRIC_EASING,
      reduceMotion: essential,
    });
  }, [active, settled, essential]);
  // Inactive rows sit at 98% (BitChord `INACTIVE_SCALE`); the 2% is absorbed
  // by the right margin of `content`, like the 8% growth was before.
  const anim = useAnimatedStyle(() => ({
    opacity: dim.value,
    transform: [{ scale: 0.98 + settled.value * 0.02 }],
  }));
  const rowStyle = lyricsLineStyle(large, centered);
  const backingStyle = lyricsBackingStyle(large, centered);
  return (
    <View
      onLayout={(e) => onMeasure(index, e.nativeEvent.layout.y, e.nativeEvent.layout.height)}
      style={stanza && (large ? styles.stanzaTopLarge : styles.stanzaTop)}
    >
      <Animated.View style={[centered ? styles.centerOrigin : styles.leftOrigin, anim]}>
        {words ? (
          // Only the active row sweeps: every row sweeping cost frames on
          // long songs. Inactive rows render the same words statically — same
          // flex layout, same heights, so activation never shifts spacing.
          active ? (
            <SweptWords words={words} handover={handover} pos={pos} centered={centered} textStyle={rowStyle} />
          ) : (
            <StaticWords words={words} centered={centered} textStyle={rowStyle} />
          )
        ) : (
          <Text style={rowStyle}>{text}</Text>
        )}
        {backing?.map((b, bi) => (
          <BackingLine key={bi} seg={b} pos={pos} textStyle={backingStyle} />
        ))}
      </Animated.View>
    </View>
  );
});
LyricRow.displayName = 'LyricRow';

/** Ahead of the ear, like the line's own advance, but less: a word is short. */
const WORD_LEAD_MS = 100;

/** How far ahead of the ear a line is highlighted as the one being sung. */
const LINE_LEAD_MS = 300;

/**
 * When a line stops being the one on screen, in the clock the words fill at.
 *
 * The line is highlighted LINE_LEAD_MS before its own start and the words
 * fill WORD_LEAD_MS ahead of the ear, so from where the fill reads, the row
 * goes when the next line is LINE_LEAD_MS - WORD_LEAD_MS out. Ending words
 * there rather than at whatever the source says is what keeps the last word
 * of a phrase - the held one, the one this was all asked for - from jumping
 * to full colour (and its shine from vanishing) the moment its row stops
 * being the active one.
 */
function handoverOf(lines: LyricLine[], i: number): number | undefined {
  const next = lines[i + 1]?.start;
  return next === undefined ? undefined : next - LINE_LEAD_MS + WORD_LEAD_MS;
}

/**
 * How often JS reads the position and aims the fill at where the song will
 * be by the next read. Not how often the fill moves: that is every frame, on
 * the UI thread, between one read and the next.
 */
const TICK_MS = 50;

/**
 * The position the words fill at, as a shared value rather than as state.
 *
 * The player moves `positionSec` twice a second, which is fine for a line and
 * far too coarse for a word: a quick one used to light up late or not at all.
 * So between those updates this runs on by itself while playing, never more
 * than a second past the last real one in case they stop coming. Each read is
 * handed over as a timing aimed at where the next read will land, so the
 * value keeps moving at the song's own rate and arrives on every read: the
 * fill neither steps (as a value set raw every 50 ms would) nor lags (as one
 * aimed only at the present would, by a tick).
 */
function useSungPosition(): SharedValue<number> {
  const pos = useSharedValue(usePlayerStore.getState().positionSec * 1000 + WORD_LEAD_MS);
  useEffect(() => {
    let anchor = { sec: usePlayerStore.getState().positionSec, at: Date.now() };
    const unsubscribe = usePlayerStore.subscribe((s, prev) => {
      if (s.positionSec !== prev.positionSec) anchor = { sec: s.positionSec, at: Date.now() };
    });
    const read = () => {
      const { isPlaying, speed } = usePlayerStore.getState();
      const ahead = isPlaying ? Math.min((Date.now() - anchor.at) * (speed || 1), 1000) : 0;
      return anchor.sec * 1000 + ahead + WORD_LEAD_MS;
    };
    let last = pos.value;
    // 20 reads a second nobody watches in the background: on iOS (audio mode)
    // timers keep running out there, so the tick only runs in the foreground.
    // The store subscription above stays always on, so the anchor is fresh on
    // return and the fill resumes without a jump.
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const { isPlaying, speed } = usePlayerStore.getState();
      const target = read() + TICK_MS * (isPlaying ? speed || 1 : 0);
      // A seek is somewhere else entirely: it lands there rather than
      // travelling, which would light up every word on the way through.
      if (Math.abs(target - last) > 1000) pos.value = target;
      else
        pos.value = withTiming(target, {
          duration: TICK_MS,
          easing: Easing.linear,
          // Same answer as the line's own transition: the fill is the
          // karaoke, not something decorating it.
          reduceMotion: motion.reduceMotion.essential,
        });
      last = target;
    };
    const start = () => {
      if (!timer) timer = setInterval(tick, TICK_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    if (AppState.currentState === 'active') start();
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else stop();
    });
    return () => {
      unsubscribe();
      stop();
      appStateSub.remove();
    };
  }, [pos]);
  return pos;
}

/** The word's own colour at the 40% it waits at, as it always has been. */
function waitingColor(text: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(text);
  if (!m) return `${text}66`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.4)`;
}

/**
 * How long a word is sung before it counts as one sung slowly: nothing for a
 * word got through under a quarter of a second, everything for a note held
 * over a second. The case this was asked for - the last word of a phrase,
 * held while the line waits for the next one - lands at the far end of it.
 */
const QUICK_WORD_MS = 250;
const HELD_WORD_MS = 1200;

/** The shine: how much even a quick word gets, how far it spreads, how bright. */
const BLOOM_FLOOR = 0.2;
const BLOOM_RADIUS = 9;
const BLOOM_ALPHA = 0.6;

/** How long the shine lingers after the word it belongs to is out. */
const BLOOM_FADE_MS = 500;

/**
 * The least it is allowed to linger, for when the row hands over before the
 * full fade would have run: a shine cut off at full strength shows, one
 * dimmed over this is simply gone.
 */
const BLOOM_FADE_MIN_MS = 120;

/**
 * One word, wiped bright for as long as it is sung (BitChord `sweep`).
 *
 * Two copies of the same text: the dim one underneath, the bright one clipped
 * to `fill * width` on top — so the fill moves mid-word at the song's own
 * rate instead of flipping whole words on. The word also lifts slightly while
 * sung (`wordLift`, 2px) and blooms on held notes, like the shine before it.
 * Only the active line mounts these, and widths are measured, never guessed,
 * so any font or size setting stays exact.
 */
const SweptWord = memo(function SweptWord({
  value,
  start,
  end,
  handover,
  pos,
  dimColor,
  litColor,
  textStyle,
}: {
  value: string;
  start: number;
  end: number;
  /** When the row hands over, which the shine never outlives. */
  handover?: number;
  pos: SharedValue<number>;
  dimColor: string;
  litColor: string;
  textStyle: object;
}) {
  const width = useSharedValue(0);
  const dur = Math.max(end - start, 1);
  /** How slowly this word is sung: 0 for a quick one, 1 for a held note. */
  const slow = clamp01((dur - QUICK_WORD_MS) / (HELD_WORD_MS - QUICK_WORD_MS));
  const fadeEnd = Math.min(end + BLOOM_FADE_MS, handover ?? Infinity);
  const fadeStart = Math.min(end, fadeEnd - BLOOM_FADE_MIN_MS);
  const fadeDur = Math.max(fadeEnd - fadeStart, 1);
  // A trailing plain space would collapse inside its own view and glue words
  // together; a non-breaking one never does and measures the same.
  const display = sungDisplay(value);
  const clip = useAnimatedStyle(() => ({ width: width.value * wordFill(start, end, pos.value) }));
  const inner = useAnimatedStyle(() => ({ width: width.value }));
  const lift = useAnimatedStyle(() => {
    const base = wordLift(start, end, pos.value) * WORD_RISE_PX;
    // Held notes swell mid-word: BitChord grows letter by letter
    // (`GrowingWord`); with one view per word the same envelope reads as one
    // pulse — same timing, coarser grain. Gated to held notes like the bloom.
    let scale = 1;
    let extra = 0;
    if (slow > 0.5) {
      const pulse = Math.sin(Math.PI * wordFill(start, end, pos.value));
      scale = 1 + 0.1 * slow * pulse;
      extra = 3 * slow * pulse;
    }
    return { transform: [{ translateY: -(base + extra) }, { scale }] };
  }, [start, end, slow]);
  const glow = useAnimatedStyle(() => {
    const fill = wordFill(start, end, pos.value);
    const after = clamp01((pos.value - fadeStart) / fadeDur);
    const bloom = fill * (1 - after) * (BLOOM_FLOOR + (1 - BLOOM_FLOOR) * slow);
    return {
      textShadowColor: `rgba(255, 255, 255, ${Math.round(bloom * BLOOM_ALPHA * 100) / 100})`,
      textShadowRadius: bloom * BLOOM_RADIUS,
    };
  }, [start, fadeStart, fadeDur, slow]);
  return (
    <Animated.View
      onLayout={(e) => {
        width.value = e.nativeEvent.layout.width;
      }}
      style={lift}
    >
      <Text style={[textStyle, { color: dimColor }]}>{display}</Text>
      <Animated.View style={[styles.sweepClip, clip]}>
        <Animated.Text
          style={[textStyle, { color: litColor }, styles.sweepInner, inner, glow]}
        >
          {display}
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  );
});
SweptWord.displayName = 'SweptWord';

/**
 * Word text as laid out: a trailing plain space would collapse inside its own
 * view and glue words together, so it rides as a non-breaking one, measured
 * the same. Both static and swept rows use it, so their heights always agree.
 */
function sungDisplay(value: string): string {
  return value.endsWith(' ') ? value.slice(0, -1) + ' ' : value;
}

/**
 * A word-timed row at rest: the same words in the same flex layout as the
 * sweep, but plain views with no clock behind them. What activation swaps in
 * is only paint, never layout — spacing does not move.
 */
const StaticWords = memo(function StaticWords({
  words,
  centered,
  textStyle,
}: {
  words: LyricWord[];
  centered: boolean;
  textStyle: object;
}) {
  // Memoized, so the theme has to come in from here (like LyricRow's own).
  const theme = useTheme();
  return (
    <View style={[styles.sweepLine, centered && styles.sweepLineCentered]}>
      {words.map((w, i) => (
        <View key={i}>
          <Text style={[textStyle, { color: theme.text }]}>{sungDisplay(w.value)}</Text>
        </View>
      ))}
    </View>
  );
});
StaticWords.displayName = 'StaticWords';

/**
 * The line being sung, wiped word by word (#165, BitChord sweep): what has
 * been sung is bright and the rest waits, dimmer — each word taking as long
 * to wipe as it takes to sing. Only the active line mounts it.
 */
function SweptWords({
  words,
  handover,
  pos,
  centered,
  textStyle,
}: {
  words: LyricWord[];
  handover?: number;
  pos: SharedValue<number>;
  centered: boolean;
  textStyle: object;
}) {
  // Memoized row, so the theme has to come in from here (like LyricRow's own).
  const theme = useTheme();
  const dimColor = waitingColor(theme.text);
  const litColor = theme.text;
  const ends = wordEnds(words, handover);
  return (
    <View style={[styles.sweepLine, centered && styles.sweepLineCentered]}>
      {words.map((w, i) => (
        <SweptWord
          key={i}
          value={w.value}
          start={w.start}
          end={ends[i]}
          handover={handover}
          pos={pos}
          dimColor={dimColor}
          litColor={litColor}
          textStyle={textStyle}
        />
      ))}
    </View>
  );
}

/** One dot of an instrumental gap leader, lit as the silence travels. */
const GapDot = memo(function GapDot({
  start,
  end,
  dot,
  pos,
  large,
}: {
  start: number;
  end: number;
  dot: number;
  pos: SharedValue<number>;
  large?: boolean;
}) {
  const theme = useTheme();
  const lit = theme.text;
  const style = useAnimatedStyle(() => {
    const through = clamp01((pos.value - start) / Math.max(end - start, 1));
    const litAt = clamp01(through * 3 - dot);
    // Each dot hops as the silence reaches its third of the gap, over a
    // gentle continuous bob tied to the song clock (frozen on pause, like
    // everything else karaoke).
    const hop = Math.sin(Math.PI * clamp01(through * 3 - dot));
    const bob = Math.sin(pos.value / 350 + dot * 2.094);
    return {
      opacity: 0.25 + 0.75 * litAt,
      transform: [{ translateY: -(hop * 4) + bob * 1.5 }, { scale: 0.76 + 0.24 * litAt }],
      backgroundColor: lit,
    };
  }, [start, end, dot, lit]);
  return <Animated.View style={[styles.gapDot, large && styles.gapDotLarge, style]} />;
});
GapDot.displayName = 'GapDot';

/** How early the dots zoom in before the silence, how late they leave after. */
const GAP_LEAD_MS = 400;
const GAP_TAIL_MS = 600;
/** The zoom itself: fast both ways. */
const GAP_ZOOM_MS = 220;

/**
 * Instrumental silence worth showing (BitChord gap, `SWEEP_GAP_MS`): three
 * dots that zoom in just before the silence, ride it out hopping one after
 * another, and zoom away once the singing resumes. The row collapses when
 * closed so the lines below glide instead of jumping over a hole.
 * Full size on the lyrics screen, smaller on cards, relative to the text.
 */
function GapDots({ start, end, pos, large }: { start: number; end: number; pos: SharedValue<number>; large?: boolean }) {
  const height = useSharedValue(0);
  const open = useSharedValue(0);
  const essential = motion.reduceMotion.essential;
  useAnimatedReaction(
    () => (pos.value >= start - GAP_LEAD_MS && pos.value < end + GAP_TAIL_MS ? 1 : 0),
    (show, prev) => {
      if (show !== prev) {
        open.value = withTiming(show, {
          duration: GAP_ZOOM_MS,
          easing: LYRIC_EASING,
          reduceMotion: essential,
        });
      }
    },
  );
  const zoom = useAnimatedStyle(() => ({
    height: height.value * open.value,
    opacity: open.value,
    transform: [{ scale: 0.7 + 0.3 * open.value }],
  }));
  return (
    <Animated.View style={[styles.gapClip, zoom]}>
      <View
        onLayout={(e) => {
          height.value = e.nativeEvent.layout.height;
        }}
        style={[styles.gapRow, large && styles.gapRowLarge]}
      >
        {[0, 1, 2].map((d) => (
          <GapDot key={d} start={start} end={end} dot={d} pos={pos} large={large} />
        ))}
      </View>
    </Animated.View>
  );
}

/** Bounds of the silence after line `i`, for its dot leader. */
function gapBounds(lines: LyricLine[], i: number): { start: number; end: number } {
  const nextStart = lines[i + 1]?.start ?? 0;
  return { start: lineEndMs(lines[i], nextStart) ?? nextStart, end: nextStart };
}

/** How early a backing vocal starts revealing, before it is sung. */
const BACKING_LEAD_MS = 250;
/** Reveal and hide durations (BitChord backing open/close). */
const BACKING_OPEN_MS = 400;
const BACKING_CLOSE_MS = 450;
/** How far above the backing line slides in from. */
const BACKING_RISE_PX = 6;
/** When nothing says when a backing vocal ends, this long it stays. */
const BACKING_TAIL_MS = 2000;

/**
 * A backing vocal / second voice under its lead line.
 *
 * Only mounted while pronounced: it fades in sliding down from above shortly
 * before its entrance, and leaves with the same motion in reverse — sliding
 * back up while fading out. Height is revealed rather than snapped so the
 * rows below glide instead of jumping. Driven by the shared word clock, so no
 * re-render is involved.
 */
const BackingLine = memo(function BackingLine({
  seg,
  pos,
  textStyle,
}: {
  seg: LyricBacking;
  pos: SharedValue<number>;
  textStyle: object;
}) {
  const height = useSharedValue(0);
  const open = useSharedValue(0);
  const end = seg.end ?? seg.start + BACKING_TAIL_MS;
  const essential = motion.reduceMotion.essential;
  useAnimatedReaction(
    () => (pos.value >= seg.start - BACKING_LEAD_MS && pos.value < end ? 1 : 0),
    (due, prev) => {
      if (due !== prev) {
        open.value = withTiming(due, {
          duration: due ? BACKING_OPEN_MS : BACKING_CLOSE_MS,
          easing: LYRIC_EASING,
          reduceMotion: essential,
        });
      }
    },
  );
  const reveal = useAnimatedStyle(() => ({
    height: height.value * open.value,
    opacity: open.value,
    transform: [{ translateY: (1 - open.value) * -BACKING_RISE_PX }],
  }));
  return (
    <Animated.View style={[styles.backingClip, reveal]}>
      <View
        onLayout={(e) => {
          height.value = e.nativeEvent.layout.height;
        }}
      >
        <Text style={textStyle}>{seg.value}</Text>
      </View>
    </Animated.View>
  );
});
BackingLine.displayName = 'BackingLine';

/** Typography shared by the card and the full screen. */
export const lyricsStyles = themed((colors) => ({
  line: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 30,
    fontWeight: '500',
    paddingVertical: spacing.xs,
  },
  lineApple: {
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '800',
    paddingVertical: spacing.sm,
  },
  lineBacking: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    paddingTop: spacing.xs,
  },
  lineAppleBacking: {
    fontSize: 23,
    lineHeight: 30,
    paddingTop: spacing.sm,
  },
  centered: { textAlign: 'center' },
}));

/**
 * The line style: Apple/BitChord sizing on the full screen (`large`), the
 * compact style on cards and covers, alignment everywhere lyrics are shown.
 */
export function useLyricsLineStyle(large?: boolean) {
  const centered = useSettings((s) => s.lyricsAlign) === 'center';
  return lyricsLineStyle(large, centered);
}

function lyricsLineStyle(large: boolean | undefined, centered: boolean) {
  return [lyricsStyles.line, large && lyricsStyles.lineApple, centered && lyricsStyles.centered];
}

/**
 * Backing vocal style: smaller than the lead line it sits under, bold enough
 * to read as sung rather than printed.
 */
function lyricsBackingStyle(large: boolean | undefined, centered: boolean) {
  return [
    lyricsStyles.lineBacking,
    large && lyricsStyles.lineAppleBacking,
    centered && lyricsStyles.centered,
  ];
}

const CARD_BODY_H = 280;

const styles = themed((colors) => ({
  card: {
    borderRadius: radius.lg,
    marginTop: spacing.lg,
    // The player no longer has global horizontal padding (because of the
    // slider): the card supplies its own margin.
    marginHorizontal: spacing.lg,
    padding: spacing.lg,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500', marginBottom: spacing.sm },
  body: { height: CARD_BODY_H, overflow: 'hidden' },
  // Lyrics in place of the cover: box exactly the size of the cover.
  coverBox: { overflow: 'hidden', padding: spacing.lg },
  coverBody: { flex: 1, overflow: 'hidden' },
  wrap: { flex: 1 },
  // Right margin so the active line, settling from 98%, doesn't sit against
  // the edge.
  content: { paddingBottom: spacing.xl, paddingRight: '10%' },
  leftOrigin: { transformOrigin: 'left center' },
  centerOrigin: { transformOrigin: 'center center' },
  // Centred, the scale settles to both sides, so the margin is split.
  contentCentered: { paddingRight: '5%', paddingLeft: '5%' },
  // A stanza opening breathes wider above it; lines inside one sit tighter.
  stanzaTop: { paddingTop: spacing.md },
  stanzaTopLarge: { paddingTop: spacing.xl },
  // The wiped words: a wrapping row of measured words, centred when asked.
  sweepLine: { flexDirection: 'row', flexWrap: 'wrap' },
  sweepLineCentered: { justifyContent: 'center' },
  // The bright copy, clipped to the sung width. Absolute over the dim word,
  // fixed to the measured width so it never reflows as the wipe travels.
  sweepClip: { position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' },
  sweepInner: { textShadowOffset: { width: 0, height: 0 } },
  // Backing vocals reveal their height instead of snapping it.
  backingClip: { overflow: 'hidden' },
  // Instrumental gap leaders zoom their whole row, so it collapses too.
  gapClip: { overflow: 'hidden' },
  // Instrumental gap leader: three dots travelling with the silence.
  gapRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md, paddingLeft: spacing.xs },
  gapRowLarge: { gap: spacing.md, paddingVertical: spacing.lg },
  gapDot: { width: 8, height: 8, borderRadius: 4 },
  gapDotLarge: { width: 14, height: 14, borderRadius: 7 },
  fade: { position: 'absolute', left: 0, right: 0 },
  expand: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
