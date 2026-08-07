/**
 * How many across a grid is, and the menu that changes it (#109).
 *
 * The choice is saved per screen and remembered, so it is set once rather than
 * every visit. Returns the number, a trigger for the header button, and the
 * menu as a node to render, in the same shape as `useSongSort`, which is the
 * other thing a list header opens.
 *
 * The menu is a bottom sheet like every other menu in the app instead of
 * something anchored under the button: it is the same gesture, opening from
 * the same kind of icon, and it is the one people here have already learnt.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, type ReactNode, useRef } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { SheetModal } from '@/components/SheetModal';
import { useT } from '@/i18n';
import {
  GRID_COLUMN_CHOICES,
  GRID_DEFAULT_COLUMNS,
  useSettings,
  type GridKey,
  type ListLayout,
} from '@/store/settings';
import { colors, fontSize, spacing } from '@/theme';

/**
 * For a screen that can also be drawn as rows. Given one, the menu carries the
 * whole question of how the screen looks: rows, or cards this many across.
 * Without it the menu is only about density, for a grid with no list to be.
 */
interface LayoutOption {
  value: ListLayout;
  set: (value: ListLayout) => void;
}

interface GridColumnsResult {
  /** How many across to lay the grid out. */
  columns: number;
  /** Opens the menu, for the header button. */
  openGridMenu: () => void;
  /** The menu, to render in the tree. */
  gridSheet: ReactNode;
}

/**
 * Its own memoized component, for the reason `useSongSort` gives: with the
 * open state in the screen, opening the menu re-renders the list behind it and
 * the delay shows.
 */
const GridSheet = memo(function GridSheet({
  columns,
  choose,
  layout,
  openRef,
}: {
  columns: number;
  choose: (value: number) => void;
  layout?: LayoutOption;
  openRef: React.MutableRefObject<() => void>;
}) {
  const t = useT();
  const asList = layout?.value === 'list';

  const row = (key: string | number, label: string, active: boolean, pick: () => void) => (
    <Pressable
      key={key}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
      onPress={pick}
    >
      <Text style={[styles.actionText, active && { color: colors.accent }]}>{label}</Text>
      {active ? (
        <Ionicons
          name="checkmark"
          size={20}
          color={colors.accent}
          style={{ marginLeft: 'auto' }}
        />
      ) : null}
    </Pressable>
  );

  return (
    <SheetModal openRef={openRef}>
      {/* Choosing closes it, like the sort menu: one tap is a finished answer
          and leaving it up asks for a second gesture to dismiss what has
          already been decided. */}
      {(close) => (
        <>
          <Text style={styles.sheetTitle}>{layout ? t('View') : t('Columns')}</Text>
          {layout
            ? row('list', t('List'), asList, () => {
                layout.set('list');
                close();
              })
            : null}
          {GRID_COLUMN_CHOICES.map((n) =>
            // While the rows are showing, none of the densities is what you are
            // looking at, so none of them is ticked. Picking one is also how
            // you get back to cards.
            row(n, t('{n} columns', { n }), !asList && columns === n, () => {
              // Only when it is not already cards. Every setter here writes the
              // whole settings blob into SecureStore, which encrypts it, so an
              // "it is already that" write is the kind of work that showed up
              // as a dropped tap in #50.
              if (asList) layout?.set('grid');
              choose(n);
              close();
            }),
          )}
        </>
      )}
    </SheetModal>
  );
});

export function useGridColumns(key: GridKey, layout?: LayoutOption): GridColumnsResult {
  const stored = useSettings((s) => s.gridColumns[key]);
  const setGridColumns = useSettings((s) => s.setGridColumns);
  const openRef = useRef<() => void>(() => {});
  const columns = stored ?? GRID_DEFAULT_COLUMNS[key];

  return {
    columns,
    openGridMenu: () => openRef.current(),
    gridSheet: (
      <GridSheet
        columns={columns}
        choose={(value) => setGridColumns(key, value)}
        layout={layout}
        openRef={openRef}
      />
    ),
  };
}

const styles = StyleSheet.create({
  sheetTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  actionText: { color: colors.text, fontSize: fontSize.md },
});
