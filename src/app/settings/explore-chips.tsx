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

function ChipRow({ chip, disabled }: { chip: ExploreChip; disabled?: boolean }) {
  const t = useT();
  const drag = useReorderableDrag();
  const setExploreChip = useSettings((s) => s.setExploreChip);
  // From the store, not `colors.accent`: without subscription the switch would
  // keep the previous accent while the screen stays mounted.
  const accent = useSettings((s) => s.accentColor);
  return (
    // Still draggable while greyed out: where it goes is a preference about the
    // Home screen you get back, and it costs nothing to set now.
    <View style={[styles.row, disabled && { opacity: 0.5 }]}>
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
        disabled={disabled}
        trackColor={{ false: colors.border, true: accent }}
        thumbColor={colors.text}
      />
    </View>
  );
}

/** Chips Home does not draw without a connection (it filters them out through
 * OFFLINE_KEYS). Their rows stay here, greyed out, so the list is the same list
 * whichever mode you are in (#114). */
const SERVER_ONLY: ExploreChipKey[] = ['genres', 'radio'];

export default function ExploreChipsSettings() {
  const bottomPad = useScreenBottomPadding();
  const t = useT();
  const offline = useAuthStore((s) => s.offline);
  const exploreChips = useSettings((s) => s.exploreChips);
  const setExploreChips = useSettings((s) => s.setExploreChips);
  return (
    <SafeAreaView style={settingsStyles.safe} edges={['top']}>
      <ScreenHeader title={t('Explore chips')} />
      <Text style={styles.hint}>{t('Drag to reorder, toggle to show or hide.')}</Text>
      <ReorderableList
        data={exploreChips}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <ChipRow chip={item} disabled={offline && SERVER_ONLY.includes(item.key)} />
        )}
        onReorder={({ from, to }: ReorderableListReorderEvent) => {
          // Every chip is on screen, so the positions dragged are the positions
          // stored. Holding back the server-only ones used to mean mapping one
          // list onto the other, which was the price of hiding them.
          const next = exploreChips.slice();
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
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
