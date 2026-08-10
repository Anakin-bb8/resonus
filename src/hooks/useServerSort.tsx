/**
 * Choosing among the orders a SERVER can give, with its bottom sheet menu.
 *
 * The other sort hook, `useSongSort`, reorders a list the screen already holds,
 * which is right when the screen holds all of it: a playlist, an album, the
 * favourites. This one is for the lists that arrive a page at a time, where
 * that would be a lie. Sorting the fifty songs a server happened to send first
 * is not the fifty that come first alphabetically, and the list reshuffles
 * itself as each new page lands. So the order goes into the request instead,
 * and the caller puts it in the query key so paging starts again from the top.
 *
 * Which orders exist is not this hook's to say. It is asked of the data layer
 * (`genreSongSorts` and its like), because the answer belongs to whichever
 * server is connected, and an empty answer means the screen shows no control
 * at all rather than one that promises an order nobody can deliver.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, type ReactNode, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { type SongListSort } from '@/api/subsonic';
import { SheetModal } from '@/components/SheetModal';
import { useT } from '@/i18n';
import { colors, fontSize, spacing } from '@/theme';

/**
 * Same words the library's song browser uses, since it is the same question.
 * Album orders it has no name for bring their own (see `labels`).
 */
const SORT_LABEL: Record<string, string> = {
  server: 'Default',
  recent: 'Recent',
  alpha: 'A-Z',
  added: 'Recently added',
  frequent: 'Most played',
  random: 'Shuffle',
  artist: 'Artist',
  year: 'Year',
};

interface SortResult<T> {
  /** The chosen order, to put in the request and in the query key. */
  sort: T;
  setSort: (next: T) => void;
  /** Opens the menu. Undefined when there is nothing to choose between. */
  openSort: (() => void) | undefined;
  /** The menu, to render in the tree. */
  sortSheet: ReactNode;
}

/**
 * In its own component, like the other sort sheet: opening or closing it then
 * re-renders the modal instead of the screen and the long list inside it.
 */
const ServerSortSheet = memo(function ServerSortSheet({
  sorts,
  labels,
  sort,
  onPick,
  openRef,
}: {
  // Plain strings here on purpose: `memo` erases a generic, and the union is
  // the caller's business anyway. The hook below puts it back on.
  sorts: string[];
  labels: Record<string, string>;
  sort: string;
  onPick: (next: string) => void;
  openRef: React.MutableRefObject<() => void>;
}) {
  const t = useT();
  return (
    <SheetModal openRef={openRef}>
      {(close) => (
        <>
          <Text style={styles.sheetTitle}>{t('Sort by')}</Text>
          {sorts.map((key) => {
            const active = key === sort;
            return (
              <Pressable
                key={key}
                style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
                onPress={() => {
                  onPick(key);
                  close();
                }}
              >
                <Text style={[styles.actionText, active && { color: colors.accent }]}>
                  {t(labels[key] ?? key)}
                </Text>
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
          })}
        </>
      )}
    </SheetModal>
  );
});

/**
 * `sorts` is what the server offers, in the order it should be shown; the first
 * is what the screen opens on. One option, or none, is not a choice, and then
 * there is no menu to open.
 */
export function useServerSort<T extends string = SongListSort>(
  sorts: T[],
  labels: Partial<Record<T, string>> = {},
): SortResult<T> {
  const fallback = (sorts[0] ?? 'server') as T;
  const [sort, setSort] = useState<T>(fallback);
  const openRef = useRef<() => void>(() => {});
  // Not persisted, and neither is the library's song browser: an order picked
  // inside one genre is about that visit, and coming back to a screen sorted by
  // something chosen days ago is the kind of surprise nobody asked for.
  if (sorts.length < 2) {
    return { sort: fallback, setSort, openSort: undefined, sortSheet: null };
  }
  return {
    sort,
    setSort,
    openSort: () => openRef.current(),
    sortSheet: (
      <ServerSortSheet
        sorts={sorts}
        labels={{ ...SORT_LABEL, ...labels }}
        sort={sort}
        onPick={(next) => setSort(next as T)}
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
