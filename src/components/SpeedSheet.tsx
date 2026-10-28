/**
 * The menu for choosing how fast what is playing runs (#151).
 *
 * Chips rather than a list of rows: the seven speeds are two characters each,
 * and a row apiece would make a sheet you have to scroll to reach double speed.
 * Laid out like this the whole range is in view, which matters for a control
 * you tap two or three times in a row until it sits where you want it.
 *
 * Unlike every other sheet in the app, choosing does NOT close it: the change
 * is heard on the spot, so closing after each pick would mean reopening to
 * correct it. The grabber and the backdrop are the way out, as always.
 *
 * In its own component, and memoized, because it holds its own visibility:
 * opening it re-renders the modal instead of the player behind it.
 *
 * Above the chips, a slider and two buttons that move it a hundredth at a
 * time, and below them the pitch switch (#277): turning it off is varispeed,
 * the pitch going with the speed like a record on a turntable. When the song carries a BPM
 * tag, the tempo it plays at now is shown next to it.
 */
import Slider from '@react-native-community/slider';
import { memo } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';

import Icon from '@/components/Icon';
import { SheetModal } from '@/components/SheetModal';
import { useT } from '@/i18n';
import { PLAYBACK_SPEEDS, usePlayerStore } from '@/store/player';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

export const SpeedSheet = memo(function SpeedSheet({
  openRef,
}: {
  openRef: React.MutableRefObject<() => void>;
}) {
  const t = useT();
  // Memoized, so the player repainting is not enough to bring this one along.
  useTheme();
  const speed = usePlayerStore((s) => s.speed);
  const setSpeed = usePlayerStore((s) => s.setSpeed);
  const varispeed = usePlayerStore((s) => s.varispeed);
  const setVarispeed = usePlayerStore((s) => s.setVarispeed);
  const bpm = usePlayerStore((s) => s.queue[s.index]?.bpm);
  const step = (by: number) => setSpeed(speed + by);
  return (
    <SheetModal openRef={openRef}>
      {() => (
        <>
          <Text style={styles.title}>{t('Playback speed')}</Text>
          <View style={styles.fine}>
            <Pressable
              style={({ pressed }) => [styles.stepButton, pressed && { opacity: 0.6 }]}
              hitSlop={8}
              disabled={speed <= MIN}
              accessibilityRole="button"
              accessibilityLabel={t('Slower')}
              onPress={() => step(-STEP)}
            >
              <Icon name="remove" size={22} color={speed <= MIN ? colors.textMuted : colors.text} />
            </Pressable>
            <View style={styles.readout}>
              <Text style={styles.value}>{`${speed.toFixed(2)}×`}</Text>
              {/* The tempo it plays at, from the tag: speed scales it either
                  way, since varispeed only decides what the pitch does. */}
              {bpm ? (
                <Text style={styles.bpm}>
                  {`${formatBpm(bpm * speed)} ${t('BPM')}`}
                  {speed !== 1 ? <Text style={styles.bpmFrom}>{`  ·  ${formatBpm(bpm)}`}</Text> : null}
                </Text>
              ) : null}
            </View>
            <Pressable
              style={({ pressed }) => [styles.stepButton, pressed && { opacity: 0.6 }]}
              hitSlop={8}
              disabled={speed >= MAX}
              accessibilityRole="button"
              accessibilityLabel={t('Faster')}
              onPress={() => step(STEP)}
            >
              <Icon name="add" size={22} color={speed >= MAX ? colors.textMuted : colors.text} />
            </Pressable>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={MIN}
            maximumValue={MAX}
            step={STEP}
            value={speed}
            onValueChange={setSpeed}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.mediaTrack}
            thumbTintColor={colors.accent}
            accessibilityLabel={t('Playback speed')}
          />
          <View style={styles.row}>
            {PLAYBACK_SPEEDS.map((v) => {
              const active = v === speed;
              return (
                <Pressable
                  key={v}
                  style={({ pressed }) => [
                    styles.chip,
                    active && { backgroundColor: colors.accent },
                    pressed && { opacity: 0.6 },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setSpeed(v)}
                >
                  <Text style={[styles.chipText, active && { color: colors.onAccent }]}>
                    {`${v}×`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            style={({ pressed }) => [styles.switchRow, pressed && { opacity: 0.6 }]}
            accessibilityRole="switch"
            accessibilityState={{ checked: !varispeed }}
            onPress={() => setVarispeed(!varispeed)}
          >
            <Text style={[styles.switchLabel, styles.switchText]}>{t('Preserve pitch')}</Text>
            <Switch
              value={!varispeed}
              onValueChange={(keep) => setVarispeed(!keep)}
              trackColor={{ false: colors.control, true: colors.accent }}
              thumbColor={colors.knob}
            />
          </Pressable>
        </>
      )}
    </SheetModal>
  );
});

/** The ends the player accepts (see `setSpeed`), and the slider's step. */
const MIN = 0.5;
const MAX = 2;
const STEP = 0.01;

/** 128, 126.72: as many decimals as it needs, two at most. */
function formatBpm(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const styles = themed((colors) => ({
  title: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginBottom: spacing.md,
  },
  // Wraps: seven chips do not fit across a phone, and the second line is where
  // the fast half of the range lands, which is the half used least.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  chipText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '500' },
  fine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readout: { alignItems: 'center' },
  value: { color: colors.text, fontSize: fontSize.xl, fontWeight: '600', fontVariant: ['tabular-nums'] },
  bpm: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2, fontVariant: ['tabular-nums'] },
  bpmFrom: { color: colors.textMuted },
  slider: { marginVertical: spacing.md },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  switchText: { flex: 1 },
  switchLabel: { color: colors.text, fontSize: fontSize.md },
}));
