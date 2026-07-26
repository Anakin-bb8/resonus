/**
 * Has this album got anything downloaded?
 *
 * Asked of the downloads catalog, which is already in memory, and answered by
 * album id: a downloaded song keeps the album it came from, unlike its artist,
 * which gets re-pegged to a local id built from the name.
 *
 * Only albums. A playlist is whatever songs it happens to hold, so the same
 * question can't be answered without fetching it, and the playlist screen
 * answers it there instead, where the songs are already at hand.
 */
import { useEffect, useState } from 'react';

import { getDownloadsCatalog, useDownloads } from '@/store/downloads';

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
    void getDownloadsCatalog()
      .then((catalog) => {
        if (alive) setHas(catalog.songs.some((s) => s.albumId === albumId));
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
