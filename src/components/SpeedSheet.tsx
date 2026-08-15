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
 */
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

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
  return (
    <SheetModal openRef={openRef}>
      {() => (
        <>
          <Text style={styles.title}>{t('Playback speed')}</Text>
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
        </>
      )}
    </SheetModal>
  );
});

const styles = themed((colors) => ({
  title: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
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
  chipText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
}));
