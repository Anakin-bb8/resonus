/**
 * The order a browse screen (all artists, albums, songs) opens on, remembered
 * across visits (#226). Only a field: these orders have no direction.
 *
 * A Home shelf that says which order it was showing wins for that visit, but
 * doesn't overwrite what was saved; picking one on the screen does. A saved
 * order the list no longer offers (another server) falls back to `fallback`.
 */
import { useState } from 'react';

import { useSortPrefs, type SortField } from '@/store/sortPrefs';

export function useBrowseSort<T extends string>(
  key: string,
  offered: readonly T[],
  fallback: T,
  fromRoute?: T,
): [T, (next: T) => void] {
  const stored = useSortPrefs((s) => s.prefs[key]?.field) as string | undefined;
  const setPref = useSortPrefs((s) => s.setPref);
  const [picked, setPicked] = useState<T | undefined>(fromRoute);
  const saved = offered.find((s) => s === stored);
  const sort = picked ?? saved ?? fallback;

  function set(next: T) {
    setPicked(next);
    // The store is typed for the list sorts; the browse orders share the map.
    setPref(
      key,
      { field: next as unknown as SortField, dir: 'asc' },
      { field: fallback as unknown as SortField, dir: 'asc' },
    );
  }

  return [sort, set];
}
