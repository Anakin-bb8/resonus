/**
 * Primuse-style word lyrics for React Native.
 *
 * The motion design is adapted from Primuse's MIT-licensed KaraokeLineView
 * (Copyright (c) 2026 Welape): a soft word-internal sweep, a small bottom-
 * anchored bounce, and layout-stable word wrapping. See THIRD_PARTY_NOTICES.md.
 */
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { LyricWord } from '@/api/subsonic';
import {
  lyricWordDurationMs,
  MIN_WORD_TRANSITION_MS,
  WORD_BOUNCE_SCALE,
  WORD_SWEEP_EDGE_FRACTION,
  WORD_SWEEP_LEAD_MS,
} from '@/lib/lyricMotion';
import { usePlayerStore } from '@/store/player';

const CLOCK_RUNWAY_MS = 1200;

/**
 * Held-note shine: below this a word is got through too fast to glow, above
 * a second it blooms fully. What is sung slowly shines while it is sung and
 * lets go shortly after, never past the next row.
 */
const QUICK_WORD_MS = 250;
const HELD_WORD_MS = 1200;
/** How far the shine spreads at full bloom, how bright it gets. */
const BLOOM_RADIUS = 12;
const BLOOM_ALPHA = 1;
/** How long the shine lingers after the word it belongs to is out. */
const BLOOM_FADE_MS = 500;

interface KaraokeWordsProps {
  words: LyricWord[];
  active: boolean;
  centered: boolean;
  textStyle: StyleProp<TextStyle>;
  activeColor: string;
  inactiveColor: string;
  paddingVertical: number;
}

/**
 * Uses the same word-flow layout in active and inactive rows. Switching the
 * active line therefore never changes wrapping or measured row height.
 */
export const KaraokeWords = memo(function KaraokeWords({
  words,
  active,
  centered,
  textStyle,
  activeColor,
  inactiveColor,
  paddingVertical,
}: KaraokeWordsProps) {
  const label = words.map((word) => word.value).join('');
  const content = active ? (
    <ActiveWordFlow
      words={words}
      textStyle={textStyle}
      activeColor={activeColor}
      inactiveColor={inactiveColor}
    />
  ) : (
    words.map((word, index) => (
      <Text key={index} accessible={false} style={[textStyle, { color: activeColor }]}>
        {word.value}
      </Text>
    ))
  );

  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        styles.flow,
        centered && styles.flowCentered,
        { paddingVertical },
      ]}
    >
      {content}
    </View>
  );
});

function ActiveWordFlow({
  words,
  textStyle,
  activeColor,
  inactiveColor,
}: Omit<KaraokeWordsProps, 'active' | 'centered' | 'paddingVertical'>) {
  const positionSec = usePlayerStore((s) => s.positionSec);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const speed = usePlayerStore((s) => s.speed);
  const reduceMotion = useReducedMotion();
  const clockMs = useSharedValue(positionSec * 1000);

  useEffect(() => {
    cancelAnimation(clockMs);
    const start = positionSec * 1000;
    clockMs.value = start;
    if (isPlaying) {
      clockMs.value = withTiming(start + CLOCK_RUNWAY_MS * (speed || 1), {
        duration: CLOCK_RUNWAY_MS,
        easing: Easing.linear,
        // Highlight progress carries timing information and must not jump even
        // when decorative motion is disabled at the system level.
        reduceMotion: ReduceMotion.Never,
      });
    }
  }, [clockMs, isPlaying, positionSec, speed]);

  return words.map((word, index) => (
    <TimedWord
      key={index}
      word={word}
      durationMs={lyricWordDurationMs(words, index)}
      clockMs={clockMs}
      animateBounce={isPlaying && !reduceMotion}
      textStyle={textStyle}
      activeColor={activeColor}
      inactiveColor={inactiveColor}
    />
  ));
}

const TimedWord = memo(function TimedWord({
  word,
  durationMs,
  clockMs,
  animateBounce,
  textStyle,
  activeColor,
  inactiveColor,
}: {
  word: LyricWord;
  durationMs: number;
  clockMs: SharedValue<number>;
  animateBounce: boolean;
  textStyle: StyleProp<TextStyle>;
  activeColor: string;
  inactiveColor: string;
}) {
  const width = useSharedValue(0);
  const height = useSharedValue(0);

  const motionStyle = useAnimatedStyle(() => {
    if (!animateBounce) return { transform: [{ scale: 1 }] };
    const duration = Math.max(MIN_WORD_TRANSITION_MS, durationMs);
    const raw = Math.max(0, Math.min(1, (clockMs.value - word.start) / duration));
    const lift = Math.sin(raw * Math.PI);
    // iOS rasterizes the masked word once, so magnifying it turns the glyphs
    // soft: there the bounce only lifts, small like the old word rise.
    // Shifting a layer stays sharp.
    if (Platform.OS === 'ios') {
      return { transform: [{ translateY: -height.value * 0.05 * lift }] };
    }
    const scale = 1 + WORD_BOUNCE_SCALE * lift;
    return {
      transform: [
        { translateY: -height.value * (scale - 1) * 0.5 },
        { scale },
      ],
    };
  });

  const solidStyle = useAnimatedStyle(() => {
    const duration = Math.max(MIN_WORD_TRANSITION_MS, durationMs);
    const start = word.start - WORD_SWEEP_LEAD_MS;
    const end = word.start + duration;
    const raw = Math.max(0, Math.min(1, (clockMs.value - start) / (end - start)));
    const eased = 1 - (1 - raw) * (1 - raw);
    const edge = width.value * WORD_SWEEP_EDGE_FRACTION;
    return { width: Math.max(0, width.value * eased - edge * 0.5) };
  });

  const edgeStyle = useAnimatedStyle(() => {
    const duration = Math.max(MIN_WORD_TRANSITION_MS, durationMs);
    const start = word.start - WORD_SWEEP_LEAD_MS;
    const end = word.start + duration;
    const raw = Math.max(0, Math.min(1, (clockMs.value - start) / (end - start)));
    const eased = 1 - (1 - raw) * (1 - raw);
    const filled = width.value * eased;
    const edge = width.value * WORD_SWEEP_EDGE_FRACTION;
    const left = Math.max(0, filled - edge * 0.5);
    return {
      left,
      width: Math.min(edge, Math.max(0, filled * 2), Math.max(0, width.value - left)),
    };
  });

  // Held notes bloom: a halo around the word while it is sung, stronger the
  // longer the note, gone shortly after. Quick words barely light.
  const glowStyle = useAnimatedStyle(() => {
    if (!animateBounce) return { textShadowColor: 'transparent', textShadowRadius: 0 };
    const duration = Math.max(MIN_WORD_TRANSITION_MS, durationMs);
    const slow = Math.max(0, Math.min(1, (duration - QUICK_WORD_MS) / (HELD_WORD_MS - QUICK_WORD_MS)));
    if (slow <= 0) return { textShadowColor: 'transparent', textShadowRadius: 0 };
    const wordEnd = word.end ?? word.start + duration;
    const fill = Math.max(0, Math.min(1, (clockMs.value - word.start) / duration));
    const after = Math.max(0, Math.min(1, (clockMs.value - wordEnd) / BLOOM_FADE_MS));
    const bloom = fill * (1 - after) * slow;
    return {
      textShadowColor: `rgba(255, 255, 255, ${(bloom * BLOOM_ALPHA).toFixed(2)})`,
      textShadowRadius: bloom * BLOOM_RADIUS,
    };
  });

  return (
    <Animated.View
      style={motionStyle}
      onLayout={(event) => {
        width.value = event.nativeEvent.layout.width;
        height.value = event.nativeEvent.layout.height;
      }}
    >
      <Animated.Text
        accessible={false}
        style={[textStyle, { color: inactiveColor, textShadowOffset: { width: 0, height: 0 } }, glowStyle]}
      >
        {word.value}
      </Animated.Text>
      <MaskedView
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        maskElement={(
          <Text accessible={false} style={textStyle}>
            {word.value}
          </Text>
        )}
      >
        <View style={styles.sweepCanvas}>
          <Animated.View style={[styles.sweepSolid, { backgroundColor: activeColor }, solidStyle]} />
          <Animated.View style={[styles.sweepEdge, edgeStyle]}>
            <LinearGradient
              colors={[activeColor, `${activeColor}00`]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
      </MaskedView>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  flow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  flowCentered: { justifyContent: 'center' },
  sweepCanvas: { flex: 1 },
  sweepSolid: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  sweepEdge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
});
