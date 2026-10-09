/**
 * Settings › Lyrics providers: word-by-word online lyrics, first synced hit
 * wins. Draggable list (same engine as the queue and playlists) to reorder,
 * switches to turn providers on or off. Changes are applied and saved
 * immediately.
 *
 * BiniLyrics (Apple Music TTML), LyricsPlus (the YouLy+ aggregator) and
 * Unison (Better Lyrics) time words; LRCLIB closes the chain and also does
 * plain lines. Only HTTP calls leave the phone: no provider code is vendored.
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
import { useSettings, type LyricProvider, type LyricProviderKey } from '@/store/settings';
import {
  colors,
  fontSize,
  radius,
  spacing,
  SCREEN_BOTTOM_PADDING,
  themed,
  useTheme,
} from '@/theme';

/** What each row says: the name, and what it brings. */
const PROVIDERS: Record<LyricProviderKey, { label: string; blurb: string }> = {
  binilyrics: { label: 'BiniLyrics', blurb: 'Apple Music lyrics, word by word.' },
  lyricsplus: { label: 'LyricsPlus', blurb: 'YouLy+ aggregator: Apple, Spotify, Musixmatch.' },
  unison: { label: 'Unison', blurb: 'Better Lyrics crowdsourced lyrics.' },
  lrclib: { label: 'LRCLIB', blurb: 'Community database, lines or words.' },
};

function ProviderRow({ provider }: { provider: LyricProvider }) {
  const t = useT();
  const drag = useReorderableDrag();
  const setLyricProvider = useSettings((s) => s.setLyricProvider);
  const accent = useAccent();
  const { label, blurb } = PROVIDERS[provider.key];
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
      <View style={styles.texts}>
        <Text style={styles.label}>{t(label)}</Text>
        <Text style={styles.blurb}>{t(blurb)}</Text>
      </View>
      <Switch
        value={provider.enabled}
        onValueChange={(v) => setLyricProvider(provider.key, v)}
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
  const lyricsProviders = useSettings((s) => s.lyricsProviders);
  const setLyricsProviders = useSettings((s) => s.setLyricsProviders);
  return (
    <SettingsSafeArea>
      <ScreenHeader title={t('Lyrics providers')} />
      <Text style={styles.hint}>
        {t('Word-by-word lyrics, tried in order. The first synced hit wins.')}
      </Text>
      <ReorderableList
        data={lyricsProviders}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <ProviderRow provider={item} />}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          const next = lyricsProviders.slice();
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          setLyricsProviders(next);
        }}
        contentContainerStyle={[
          styles.list,
          // Centred once the screen is wider than a list wants to be, like
          // every other settings screen (#131).
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
  texts: { flex: 1 },
  label: { color: colors.text, fontSize: fontSize.md },
  blurb: { color: colors.textSecondary, fontSize: fontSize.xs },
}));
