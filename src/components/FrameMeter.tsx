/**
 * The UI thread's half of the frame count in the diagnostics report (see
 * "Frames" in perfLog). Draws nothing. With measuring off the frame callback
 * is not even running, since a running one keeps the UI thread drawing frames
 * nobody asked for.
 */
import { useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { addUiFrames, AWAY_GAP_MS, LATE_MS, setPerfScreen, VERY_LATE_MS } from '@/lib/perfLog';
import { useSettings } from '@/store/settings';

/** Totals are read across threads once a second, not once per frame. */
const FLUSH_MS = 1000;

export function FrameMeter() {
  const on = useSettings((s) => s.diagnostics);
  const segments = useSegments() as string[];
  // `album/[id]`, without the `(tabs)` groups: the screen, not the address.
  const screen = segments.filter((s) => !s.startsWith('(')).join('/') || 'home';

  const frames = useSharedValue(0);
  const late = useSharedValue(0);
  const veryLate = useSharedValue(0);
  const worst = useSharedValue(0);
  const read = useRef({ frames: 0, late: 0, veryLate: 0 });

  const meter = useFrameCallback((info) => {
    'worklet';
    const dt = info.timeSincePreviousFrame;
    if (dt === null || dt > AWAY_GAP_MS) return;
    frames.value += 1;
    if (dt > LATE_MS) late.value += 1;
    if (dt > VERY_LATE_MS) veryLate.value += 1;
    if (dt > worst.value) worst.value = dt;
  }, false);

  // Cumulative on the UI thread, differenced here, so nothing counted between
  // a read and a reset is lost. Only the worst is reset, and losing one frame
  // to that race is not losing the pattern.
  const flush = () => {
    const now = { frames: frames.get(), late: late.get(), veryLate: veryLate.get() };
    const prev = read.current;
    addUiFrames({
      frames: now.frames - prev.frames,
      late: now.late - prev.late,
      veryLate: now.veryLate - prev.veryLate,
      worstMs: Math.round(worst.get()),
    });
    worst.set(0);
    read.current = now;
  };

  useEffect(() => {
    meter.setActive(on);
    if (!on) return;
    const id = setInterval(flush, FLUSH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  // What was counted on the old screen goes to the old screen.
  useEffect(() => {
    if (on) flush();
    setPerfScreen(screen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  return null;
}
