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
import { type ReactNode, useRef, useState } from 'react';

import { type SongListSort, type SortDirection } from '@/api/subsonic';
import { SortSheet } from '@/components/SortSheet';

/**
 * The same words the playlists use, since it is now the same menu.
 *
 * "Alphabetical" and not "A-Z", which is what the browse chips say: those have
 * no direction to set, so A-Z is the whole truth there. Here it sits above an
 * Ascending / Descending pair, and a label reading A-Z over a list running Z-A
 * contradicts itself. Orders the playlists have no name for bring their own
 * (see `labels`).
 */
const SORT_LABEL: Record<string, string> = {
  server: 'Default',
  recent: 'Recent',
  alpha: 'Alphabetical',
  added: 'Recently added',
  frequent: 'Most played',
  random: 'Shuffle',
  artist: 'Artist',
  year: 'Year',
};

interface SortResult<T> {
  /** The chosen order, to put in the request and in the query key. */
  sort: T;
  /** And which way round, which goes into the request just the same. */
  dir: SortDirection;
  /** Opens the menu. Undefined when there is nothing to choose between. */
  openSort: (() => void) | undefined;
  /** The menu, to render in the tree. */
  sortSheet: ReactNode;
}

/**
 * `sorts` is what the server offers, in the order it should be shown; the first
 * is what the screen opens on. One option, or none, is not a choice, and then
 * there is no menu to open.
 *
 * The menu itself is the one the playlists use, the same component: where the
 * answer goes is this hook's business, what it looks like is not.
 */
export function useServerSort<T extends string = SongListSort>(
  sorts: T[],
  labels: Partial<Record<T, string>> = {},
  /**
   * Which way round each order reads before anybody says otherwise. Without it
   * every one of them would open ascending, and "recently added" oldest first
   * is not an order anybody wants: what the server means by each is the right
   * place to start.
   */
  naturalDir: (sort: T) => SortDirection = () => 'asc',
): SortResult<T> {
  const fallback = (sorts[0] ?? 'server') as T;
  const [pref, setPref] = useState<{ sort: T; dir: SortDirection }>({
    sort: fallback,
    dir: naturalDir(fallback),
  });
  const openRef = useRef<() => void>(() => {});
  // Not persisted, and neither is the library's song browser: an order picked
  // inside one genre is about that visit, and coming back to a screen sorted by
  // something chosen days ago is the kind of surprise nobody asked for.
  if (sorts.length < 2) {
    return { sort: fallback, dir: naturalDir(fallback), openSort: undefined, sortSheet: null };
  }
  const text = { ...SORT_LABEL, ...labels } as Record<string, string>;
  return {
    sort: pref.sort,
    dir: pref.dir,
    openSort: () => openRef.current(),
    sortSheet: (
      <SortSheet
        options={sorts.map((key) => ({ key, label: text[key] ?? key }))}
        field={pref.sort}
        dir={pref.dir}
        onPick={(next, dir) =>
          setPref((cur) =>
            // A different order arrives the way it is meant to be read. The
            // direction is only carried over when the direction is what was
            // picked.
            next === cur.sort
              ? { sort: cur.sort, dir }
              : { sort: next as T, dir: naturalDir(next as T) },
          )
        }
        openRef={openRef}
      />
    ),
  };
}
