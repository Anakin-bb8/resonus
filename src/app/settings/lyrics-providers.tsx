/**
 * Settings › Player › Lyrics › Providers: the online services lyrics are
 * looked up on, each on or off, asked from the top down. The same draggable
 * list as the bottom row's buttons: the order is the priority.
 */
import Icon from '@/components/Icon';
import { Pressable, Switch, Text, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { ScreenHeader, SettingsSafeArea } from '@/components/SettingsUI';
import { useAccent } from '@/hooks/useAccent';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';
import { centredPadding, useScreenSize } from '@/hooks/useScreenSize';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import {
  LYRICS_PROVIDER_NAMES,
  useSettings,
  type LyricsProvider,
  type LyricsProviderKey,
} from '@/store/settings';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING, themed, useTheme } from '@/theme';

/** What each one looks up by, which is what tells them apart. */
const DESCRIPTIONS: Record<LyricsProviderKey, string> = {
  lrcRed: 'Finds the song by its ISRC code. Often timed word by word.',
  lrclib: 'Searches by artist and title.',
};

function ProviderRow({ provider }: { provider: LyricsProvider }) {
  const t = useT();
  const drag = useReorderableDrag();
  const setLyricsProvider = useSettings((s) => s.setLyricsProvider);
  const accent = useAccent();
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
      <View style={styles.text}>
        <Text style={styles.label}>{LYRICS_PROVIDER_NAMES[provider.key]}</Text>
        <Text style={styles.description}>{t(DESCRIPTIONS[provider.key])}</Text>
      </View>
      <Switch
        value={provider.enabled}
        onValueChange={(v) => setLyricsProvider(provider.key, v)}
        trackColor={{ false: colors.control, true: accent }}
        thumbColor={colors.knob}
      />
    </View>
  );
}

export default function LyricsProvidersSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const bottomPad = useScreenBottomPadding();
  const { width } = useScreenSize();
  const t = useT();
  const providers = useSettings((s) => s.lyricsProviders);
  const setProviders = useSettings((s) => s.setLyricsProviders);
  return (
    <SettingsSafeArea>
      <ScreenHeader title={t('Providers')} />
      <Text style={styles.hint}>
        {t('Asked from the top down until one has the lyrics. Drag to change the order.')}
      </Text>
      <ReorderableList
        data={providers}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <ProviderRow provider={item} />}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          const next = providers.slice();
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          setProviders(next);
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
  text: { flex: 1, gap: 2 },
  label: { color: colors.text, fontSize: fontSize.md },
  description: { color: colors.textMuted, fontSize: fontSize.xs },
}));
