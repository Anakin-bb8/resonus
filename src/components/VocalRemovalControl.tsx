/**
 * The vocal-removal controls on the lyrics surfaces: a compact mic toggle for
 * the lyrics card and a slider for the full lyrics screen. Both disappear
 * entirely when the feature cannot run (no iOS 18, no module, no model), so
 * nothing here needs a platform check at the call sites.
 */
import Slider from '@react-native-community/slider';
import { Platform, Pressable, Text, View } from 'react-native';

import Icon from '@/components/Icon';
import { useT } from '@/i18n';
import { colors, fontSize, spacing, themed, useTheme } from '@/theme';
import { useVocalRemoval } from '@/store/vocalRemoval';

/** Whether the controls should show at all: the module works and a model is in. */
export function useVocalRemovalAvailable(): boolean {
  return useVocalRemoval((s) => s.supported && s.modelReady);
}

/** Compact mic toggle for the lyrics card's header. */
export function VocalRemovalButton({ tint }: { tint?: string }) {
  useTheme();
  const available = useVocalRemovalAvailable();
  const enabled = useVocalRemoval((s) => s.enabled);
  const setEnabled = useVocalRemoval((s) => s.setEnabled);
  const t = useT();
  if (!available) return null;
  return (
    <Pressable
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: enabled }}
      accessibilityLabel={t('Vocal removal')}
      onPress={() => setEnabled(!enabled)}
      style={({ pressed }) => [pressed && { opacity: 0.6 }]}
    >
      <Icon
        name={enabled ? 'mic-off' : 'mic-outline'}
        size={18}
        color={enabled ? (tint ?? colors.text) : colors.textSecondary}
      />
    </Pressable>
  );
}

/** The mix slider, for the full lyrics screen: 0 background to 1 vocals. */
export function VocalRemovalSlider({ tint }: { tint?: string }) {
  useTheme();
  const available = useVocalRemovalAvailable();
  const enabled = useVocalRemoval((s) => s.enabled);
  const mix = useVocalRemoval((s) => s.mix);
  const setMix = useVocalRemoval((s) => s.setMix);
  const t = useT();
  if (!available) return null;
  const accent = tint ?? colors.text;
  return (
    <View style={[styles.row, !enabled && styles.disabled]}>
      <Icon name="mic-off-outline" size={16} color={colors.textSecondary} />
      <Slider
        style={styles.slider}
        thumbSize={Platform.OS === 'ios' ? 12 : undefined}
        minimumValue={0}
        maximumValue={1}
        value={mix}
        disabled={!enabled}
        onValueChange={setMix}
        minimumTrackTintColor={accent}
        maximumTrackTintColor={colors.mediaTrack}
        thumbTintColor={accent}
      />
      <Text style={styles.value} numberOfLines={1}>
        {mix <= 0 ? t('Instrumental') : mix >= 1 ? t('Vocals') : `${Math.round(mix * 100)}%`}
      </Text>
    </View>
  );
}

const styles = themed((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  disabled: { opacity: 0.5 },
  slider: { flex: 1, marginHorizontal: -10 },
  value: {
    color: colors.textTime,
    fontSize: fontSize.xs,
    minWidth: 72,
    textAlign: 'right',
  },
}));
