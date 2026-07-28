/**
 * Has this album got anything downloaded?
 *
 * Answered by album id: a downloaded song keeps the album it came from, unlike
 * its artist, which gets re-pegged to a local id built from the name.
 *
 * It used to build the entire downloads catalog, every song and every album,
 * and search it. Opening an album screen did that, online or offline, and on a
 * large library it was the better part of a quarter second each time.
 *
 * Only albums. A playlist is whatever songs it happens to hold, so the same
 * question can't be answered without fetching it, and the playlist screen
 * answers it there instead, where the songs are already at hand.
 */
import { useEffect, useState } from 'react';

import { albumHasDownloads, useDownloads } from '@/store/downloads';

export function useAlbumDownloads(albumId: string | undefined): boolean {
  // Re-checked when downloads change, so deleting the last song of an album
  // takes the option away without leaving the menu.
  const files = useDownloads((s) => s.files);
  const [has, setHas] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!albumId) {
      setHas(false);
      return;
    }
    void albumHasDownloads(albumId)
      .then((found) => {
        if (alive) setHas(found);
      })
      .catch(() => {
        // Catalog unreadable: better an option that reports nothing to delete
        // than no way to delete at all.
        if (alive) setHas(true);
      });
    return () => {
      alive = false;
    };
  }, [albumId, files]);

  return has;
}
