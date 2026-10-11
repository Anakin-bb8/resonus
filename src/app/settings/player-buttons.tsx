/**
 * Settings › Player › Bottom row: the buttons under the player's controls, and
 * in what order. The same draggable list as the Home buttons, with no
 * exemption: every one of them has another way in.
 */
import Icon from '@/components/Icon';
import { Pressable, Switch, Text, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { ScreenHeader, SelectList, SettingsSafeArea, SwitchList } from '@/components/SettingsUI';
import { useAccent } from '@/hooks/useAccent';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useSettings, type PlayerButton, type PlayerButtonKey } from '@/store/settings';
import {
  colors,
  fontSize,
  radius,
  spacing,
  SCREEN_BOTTOM_PADDING,
  themed,
  useTheme,
} from '@/theme';

/** The icon each one wears in the player, so the list reads like the row. */
const BUTTONS: Record<PlayerButtonKey, { label: string; icon: keyof typeof Icon.glyphMap }> = {
  devices: { label: 'Devices', icon: 'laptop-outline' },
  lyrics: { label: 'Lyrics', icon: 'mic-outline' },
  speed: { label: 'Playback speed', icon: 'speedometer-outline' },
  sleep: { label: 'Sleep timer', icon: 'moon-outline' },
  queue: { label: 'Queue', icon: 'layers-outline' },
};

function ButtonRow({ button, capped }: { button: PlayerButton; capped: boolean }) {
  const t = useT();
  const drag = useReorderableDrag();
  const setPlayerButton = useSettings((s) => s.setPlayerButton);
  const setShowDeviceName = useSettings((s) => s.setShowDeviceName);
  const accent = useAccent();
  const { label, icon } = BUTTONS[button.key];
  return (
    <View style={styles.row}>
      <Pressable
        hitSlop={8}
        onPressIn={() => {
          haptic('medium');
          drag();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('Reorder')}
      >
        <Icon name="reorder-two" size={24} color={colors.textSecondary} />
      </Pressable>
      <Icon name={icon} size={22} color={colors.textSecondary} />
      <View style={styles.text}>
        <Text style={styles.label}>{t(label)}</Text>
      </View>
      <Switch
        value={button.enabled}
        disabled={capped}
        onValueChange={(v) => {
          setPlayerButton(button.key, v);
          // The name hangs off the devices button: with it gone the toggle
          // has nothing to name, so it goes off too instead of freezing on.
          if (button.key === 'devices' && !v) setShowDeviceName(false);
        }}
        trackColor={{ false: colors.control, true: accent }}
        thumbColor={colors.knob}
      />
    </View>
  );
}

export default function PlayerButtonsSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const { width } = useScreenSize();
  const t = useT();
  const playerButtons = useSettings((s) => s.playerButtons);
  const setPlayerButtons = useSettings((s) => s.setPlayerButtons);
  const layout = useSettings((s) => s.playerButtonsLayout);
  const setLayout = useSettings((s) => s.setPlayerButtonsLayout);
  const showDeviceName = useSettings((s) => s.showDeviceName);
  const setShowDeviceName = useSettings((s) => s.setShowDeviceName);
  const showLosslessTag = useSettings((s) => s.showLosslessTag);
  const setShowLosslessTag = useSettings((s) => s.setShowLosslessTag);
  // Device extras widen the row: with any of them on the row is always
  // spread, and holds at most three buttons (two when both are on) — the
  // player enforces the same cap, so a saved row from before still fits.
  const extrasOn = (showDeviceName ? 1 : 0) + (showLosslessTag ? 1 : 0);
  const maxEnabled = extrasOn === 2 ? 2 : extrasOn === 1 ? 3 : playerButtons.length;
  const enabledCount = playerButtons.filter((b) => b.enabled).length;
  // The device name hangs off the devices button: without it the toggle has
  // nothing to name and stays greyed out.
  const devicesEnabled = playerButtons.some((b) => b.key === 'devices' && b.enabled);
  return (
    <SettingsSafeArea>
      <ScreenHeader title={t('Bottom row')} />
      <View style={[styles.layout, { paddingHorizontal: centredPadding(width, spacing.lg) }]}>
        <SelectList
          label={t('Arrangement')}
          value={extrasOn > 0 ? 'spread' : layout}
          onChange={setLayout}
          disabled={extrasOn > 0}
          disabledLabel={t('Spread across the width')}
          options={[
            { value: 'centered', label: t('Grouped in the middle') },
            { value: 'spread', label: t('Spread across the width') },
          ]}
        />
      </View>
      <View style={[styles.toggles, { paddingHorizontal: centredPadding(width, spacing.lg) }]}>
        <SwitchList
          options={[
            {
              label: t('Show device name'),
              description: t('Show the output name beside the devices button.'),
              value: showDeviceName,
              onChange: setShowDeviceName,
              disabled: !devicesEnabled,
            },
            {
              label: t('Show lossless tag'),
              description: t('Show a lossless badge beside the output when the stream is bit-perfect.'),
              value: showLosslessTag,
              onChange: setShowLosslessTag,
            },
          ]}
        />
      </View>
      <Text style={styles.hint}>
        {extrasOn > 0
          ? t('With device info on, the row holds at most {n} buttons, spread across the width.', {
              n: maxEnabled,
            })
          : t('Drag to reorder, toggle to show or hide.')}
      </Text>
      <ReorderableList
        data={playerButtons}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <ButtonRow button={item} capped={!item.enabled && enabledCount >= maxEnabled} />
        )}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          const next = playerButtons.slice();
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          setPlayerButtons(next);
        }}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: bottomPad, paddingHorizontal: centredPadding(width, spacing.lg) },
        ]}
      />
    </SettingsSafeArea>
  );
}

const styles = themed((colors) => ({
  layout: { marginBottom: spacing.md },
  // A step between the arrangement card and the toggles below it.
  toggles: { marginTop: spacing.lg },
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: SCREEN_BOTTOM_PADDING },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  text: { flex: 1 },
  label: { color: colors.text, fontSize: fontSize.md },
}));
