/**
 * Settings › Explore chips: draggable list (same engine as the queue and
 * playlists) to show/hide and reorder the Home chips. Changes are applied and
 * saved immediately.
 *
 * With none active the entire row disappears from Home; that's why there's no
 * separate master toggle.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import ReorderableList, {
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useAuthStore } from '@/store/auth';
import { useSettings, type ExploreChip, type ExploreChipKey } from '@/store/settings';
import { colors, fontSize, radius, spacing, SCREEN_BOTTOM_PADDING } from '@/theme';
import { useScreenBottomPadding } from '@/hooks/useScreenBottomPadding';

/** Each chip's label, as an i18n key. The same ones Home draws. */
const LABEL: Record<ExploreChipKey, string> = {
  shuffle: 'Shuffle',
  favorites: 'Favorites',
  albums: 'Albums',
  artists: 'Artists',
  songs: 'Songs',
  genres: 'Genres',
  radio: 'Radio',
  history: 'Recently played',
};

function ChipRow({ chip }: { chip: ExploreChip }) {
  const t = useT();
  const drag = useReorderableDrag();
  const setExploreChip = useSettings((s) => s.setExploreChip);
  // From the store, not `colors.accent`: without subscription the switch would
  // keep the previous accent while the screen stays mounted.
  const accent = useSettings((s) => s.accentColor);
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
        <Ionicons name="reorder-two" size={24} color={colors.textSecondary} />
      </Pressable>
      <Text style={styles.label}>{t(LABEL[chip.key])}</Text>
      <Switch
        value={chip.enabled}
        onValueChange={(v) => setExploreChip(chip.key, v)}
        trackColor={{ false: colors.border, true: accent }}
        thumbColor={colors.text}
      />
    </View>
  );
}

/** Chips that do not exist on a local profile (Home filters them out through
 * OFFLINE_KEYS): a row here would promise something that never turns up. */
const SERVER_ONLY: ExploreChipKey[] = ['genres', 'radio'];

export default function ExploreChipsSettings() {
  const bottomPad = useScreenBottomPadding();
  const t = useT();
  const offline = useAuthStore((s) => s.offline);
  const exploreChips = useSettings((s) => s.exploreChips);
  const setExploreChips = useSettings((s) => s.setExploreChips);
  const visible = offline
    ? exploreChips.filter((c) => !SERVER_ONLY.includes(c.key))
    : exploreChips;

  return (
    <SafeAreaView style={settingsStyles.safe} edges={['top']}>
      <ScreenHeader title={t('Explore chips')} />
      <Text style={styles.hint}>{t('Drag to reorder, toggle to show or hide.')}</Text>
      <ReorderableList
        data={visible}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => <ChipRow chip={item} />}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          const nextVisible = visible.slice();
          const [moved] = nextVisible.splice(from, 1);
          nextVisible.splice(to, 0, moved);
          // Hidden ones go back to their absolute position: reordering locally
          // must not lose or reposition the config of server-only chips.
          let vi = 0;
          const next = exploreChips.map((c) =>
            offline && SERVER_ONLY.includes(c.key) ? c : nextVisible[vi++],
          );
          setExploreChips(next);
        }}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  label: { flex: 1, color: colors.text, fontSize: fontSize.md },
});
