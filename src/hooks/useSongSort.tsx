/**
 * Reusable sort for a song list (Recent/Alphabetical + direction) with its
 * bottom sheet menu. Used by playlist and favorites.
 *
 * Returns the already-sorted list, the mapping to original indices (for actions
 * like "remove from list"), a trigger to open the menu, and the menu itself as
 * a node to render. With `persistKey` the chosen sort is saved to disk and
 * remembered across visits.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, type ReactNode, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type Song } from '@/api/subsonic';
import { SheetModal } from '@/components/SheetModal';
import { useT } from '@/i18n';
import { useDownloads } from '@/store/downloads';
import {
  DEFAULT_SORT,
  useSortPrefs,
  type SortDir,
  type SortField,
  type SortPref,
} from '@/store/sortPrefs';
import { colors, fontSize, radius, spacing } from '@/theme';

const SORT_LABEL: Record<SortField, string> = {
  recent: 'Recent',
  added: 'Recently added',
  alpha: 'Alphabetical',
  artist: 'Artist',
  album: 'Album',
  downloaded: 'Downloaded',
};

/** Default offered fields (favorites): 'recent' = server order. */
const DEFAULT_FIELDS: SortField[] = ['recent', 'alpha', 'artist', 'album', 'downloaded'];

interface SortOptions {
  /** Which fields to offer and in which order (the first is equivalent to "unsorted"). */
  fields?: SortField[];
  /** Custom labels per field (e.g. 'recent' → "Custom" in playlists). */
  labels?: Partial<Record<SortField, string>>;
  /** Default sort if the user hasn't chosen one. */
  defaultSort?: SortPref;
}

interface SortResult {
  /** Songs in the visible order. */
  songs: Song[];
  /** Original index (on the server) of each visible song. */
  indices: number[];
  /** Opens the sort menu. */
  openSort: () => void;
  /** The sort menu, to render in the tree. */
  sortSheet: ReactNode;
  /** Current sort preference (field + direction). */
  sort: SortPref;
  /** Changes the sort preference (e.g. force manual order). */
  setSort: (pref: SortPref) => void;
}

/**
 * The menu lives in its own component (SheetModal, with its state inside):
 * opening or closing it only re-renders the modal, not the screen (with its
 * list) that uses the hook. That re-render was a visible delay when pressing
 * "Sort".
 */
const SortSheet = memo(function SortSheet({
  fields,
  labels,
  field,
  dir,
  update,
  openRef,
}: {
  fields: SortField[];
  labels?: Partial<Record<SortField, string>>;
  field: SortField;
  dir: SortDir;
  update: (next: SortPref) => void;
  openRef: React.MutableRefObject<() => void>;
}) {
  const t = useT();
  const labelFor = (f: SortField) => t(labels?.[f] ?? SORT_LABEL[f]);

  return (
    <SheetModal openRef={openRef}>
      {() => (
        <>
        <Text style={styles.sheetTitle}>{t('Sort by')}</Text>
        {fields.map((f) => {
          const active = field === f;
          return (
            <Pressable
              key={f}
              style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
              onPress={() => update({ field: f, dir })}
            >
              <Text style={[styles.actionText, active && { color: colors.accent }]}>
                {labelFor(f)}
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

        <View style={styles.divider} />
        <Text style={styles.sheetTitle}>{t('Direction')}</Text>
        <View style={styles.dirRow}>
          {(['asc', 'desc'] as SortDir[]).map((d) => {
            const active = dir === d;
            return (
              <Pressable
                key={d}
                style={[styles.dirChip, active && { backgroundColor: colors.accent }]}
                onPress={() => update({ field, dir: d })}
              >
                <Ionicons
                  name={d === 'asc' ? 'arrow-up' : 'arrow-down'}
                  size={16}
                  color={active ? '#000' : colors.text}
                />
                <Text style={[styles.dirChipText, active && { color: '#000' }]}>
                  {d === 'asc' ? t('Ascending') : t('Descending')}
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

/** Stable stand-in for the downloads map when the sort doesn't look at it: a
 *  fresh `{}` each time would defeat the whole point. */
const NO_FILES: Record<string, string> = {};

export function useSongSort(
  source: Song[],
  persistKey?: string,
  options?: SortOptions,
): SortResult {
  const fields = options?.fields ?? DEFAULT_FIELDS;
  const fallback = options?.defaultSort ?? DEFAULT_SORT;
  const stored = useSortPrefs((s) => (persistKey ? s.prefs[persistKey] : undefined));
  const setPref = useSortPrefs((s) => s.setPref);
  const [local, setLocal] = useState<SortPref>(fallback);
  const openRef = useRef<() => void>(() => {});

  const { field, dir } = persistKey ? (stored ?? fallback) : local;
  // For the 'downloaded' sort (group downloaded songs together), and ONLY for
  // it. The map is replaced with every song that finishes downloading, and it
  // feeds the memo below, so subscribing to it always meant re-mapping and
  // re-sorting the whole list on each one, on every screen that sorts, plus new
  // array identities for the FlatList to chew on. On a long list with
  // auto-download on that is thousands of full sorts (#50). Sorting BY
  // downloads does have to follow them, and there the re-sort is the point.
  const files = useDownloads((s) => (field === 'downloaded' ? s.files : NO_FILES));
  function update(next: SortPref) {
    if (persistKey) setPref(persistKey, next, fallback);
    else setLocal(next);
  }

  // 'recent' leaves the raw server order (= manual playlist order).
  // Memoized: sorting on every render is noticeable in large lists.
  const ordered = useMemo(() => {
    const cmp = (a?: string, b?: string) => (a ?? '').localeCompare(b ?? '');
    const arr = source.map((song, idx) => ({ song, idx }));
    // 'added' = order in which they are added to the playlist. The server adds
    // them at the end, so their position already encodes it: reverse = latest on top.
    if (field === 'added') arr.reverse();
    if (field === 'alpha') arr.sort((a, b) => cmp(a.song.title, b.song.title));
    if (field === 'artist')
      arr.sort((a, b) => cmp(a.song.artist, b.song.artist) || cmp(a.song.title, b.song.title));
    if (field === 'album')
      // albumId separates same-name albums from different artists; disc before
      // track because in multi-disc albums `track` values repeat per disc,
      // and without that key the songs interleave "randomly".
      arr.sort(
        (a, b) =>
          cmp(a.song.album, b.song.album) ||
          cmp(a.song.albumId, b.song.albumId) ||
          (a.song.discNumber ?? 0) - (b.song.discNumber ?? 0) ||
          (a.song.track ?? 0) - (b.song.track ?? 0) ||
          cmp(a.song.title, b.song.title),
      );
    // 'downloaded' groups downloaded songs at the top preserving the original
    // order within each group (stable sort in Hermes). With dir 'desc' they go to the bottom.
    if (field === 'downloaded')
      arr.sort((a, b) => (files[a.song.id] ? 0 : 1) - (files[b.song.id] ? 0 : 1));
    if (dir === 'desc') arr.reverse();
    return arr;
  }, [source, field, dir, files]);

  const sortSheet = (
    <SortSheet
      fields={fields}
      labels={options?.labels}
      field={field}
      dir={dir}
      update={update}
      openRef={openRef}
    />
  );

  // Stable identity so the FlatList that receives them doesn't re-evaluate rows.
  const songs = useMemo(() => ordered.map((o) => o.song), [ordered]);
  const indices = useMemo(() => ordered.map((o) => o.idx), [ordered]);

  return {
    songs,
    indices,
    openSort: () => openRef.current(),
    sortSheet,
    sort: { field, dir },
    setSort: update,
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
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  dirRow: { flexDirection: 'row', gap: spacing.sm },
  dirChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHighlight,
  },
  dirChipText: { color: colors.text, fontSize: fontSize.sm, fontWeight: '600' },
});
