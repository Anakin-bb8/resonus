/**
 * The seek bar drawn as a waveform: bars, bright up to where the song is and
 * dim after it (Settings › Player › Progress bar).
 *
 * The shape is not the song's sound. No Subsonic server hands one over, and
 * working it out means decoding the whole file, which for a stream is
 * downloading it a second time. So it is drawn from the song's id: the same
 * song always has the same shape, quieter at both ends the way a track is.
 *
 * Two layers of the same bars, the bright one clipped to the progress: a tick
 * changes one width, not sixty views.
 */
import { useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { waveShape } from '@/lib/waveShape';
import { colors, radius, themed } from '@/theme';

const BAR_W = 3;
const GAP = 2;
const HEIGHT = 32;

export function WaveformBar({
  id,
  progress,
  onSeekStart,
  onSeekMove,
  onSeekEnd,
}: {
  /** What the shape is drawn from. */
  id: string;
  /** 0 to 1. */
  progress: number;
  onSeekStart: () => void;
  /** The finger's place along the bar, 0 to 1. */
  onSeekMove: (fraction: number) => void;
  onSeekEnd: (fraction: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const count = width > 0 ? Math.floor((width + GAP) / (BAR_W + GAP)) : 0;
  const shape = useMemo(() => waveShape(id, count), [id, count]);
  const fraction = (x: number) => (width > 0 ? Math.min(1, Math.max(0, x / width)) : 0);

  // Sideways only, so the screen still scrolls and the player still closes
  // when the finger goes up or down. A tap jumps straight there.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onStart((e) => {
      onSeekStart();
      onSeekMove(fraction(e.x));
    })
    .onUpdate((e) => onSeekMove(fraction(e.x)))
    .onEnd((e) => onSeekEnd(fraction(e.x)));
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => {
      onSeekStart();
      onSeekEnd(fraction(e.x));
    });

  // Built once per shape and colour: a tick only moves the clip below.
  const dim = colors.mediaTrack;
  const bright = colors.text;
  const [dimBars, brightBars] = useMemo(
    () =>
      [dim, bright].map((color) =>
        shape.map((h, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { height: Math.max(2, Math.round(h * HEIGHT)), backgroundColor: color },
            ]}
          />
        )),
      ),
    [shape, dim, bright],
  );

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View
        style={styles.wrap}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        hitSlop={{ top: 10, bottom: 10 }}
      >
        <View style={styles.row}>{dimBars}</View>
        <View style={[styles.played, { width: `${Math.min(1, Math.max(0, progress)) * 100}%` }]}>
          <View style={[styles.row, { width }]}>{brightBars}</View>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = themed(() => ({
  wrap: { height: HEIGHT, justifyContent: 'center', marginVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: GAP, height: HEIGHT },
  played: { position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' },
  bar: { width: BAR_W, borderRadius: radius.pill },
}));
