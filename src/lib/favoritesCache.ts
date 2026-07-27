/**
 * Keeping the cached favourites list in step without asking for it again.
 *
 * `['starred']` is the whole list of favourite songs, albums and artists, full
 * objects and no pagination, and `useFavoriteIds` mounts it on every song row
 * in the app. Invalidating it on each heart meant downloading and parsing the
 * entire list to record that one item changed, which on a large one is several
 * MB on the JS thread every time somebody taps (#50).
 *
 * Removing is exact: filter by id. Adding needs the object, and where the
 * caller has it (a song row, the song menu) it goes straight in. Where it
 * doesn't, it falls back to asking again, exactly as before: nothing here is
 * allowed to leave the list less up to date than it used to be.
 */
import type { Album, Artist, Song, StarType, Starred } from '@/api/subsonic';
import { queryClient } from './query';

const KEY = ['starred'];

export function applyStarChange(
  type: StarType,
  id: string,
  added: boolean,
  item?: Song | Album | Artist,
): void {
  const prev = queryClient.getQueryData<Starred>(KEY);
  if (!prev) return;

  if (!added) {
    queryClient.setQueryData<Starred>(KEY, {
      songs: type === 'song' ? prev.songs.filter((x) => x.id !== id) : prev.songs,
      albums: type === 'album' ? prev.albums.filter((x) => x.id !== id) : prev.albums,
      artists: type === 'artist' ? prev.artists.filter((x) => x.id !== id) : prev.artists,
    });
    return;
  }

  const starred = new Date().toISOString();
  if (type === 'song' && item && !prev.songs.some((x) => x.id === id)) {
    queryClient.setQueryData<Starred>(KEY, {
      ...prev,
      songs: [{ ...(item as Song), starred }, ...prev.songs],
    });
    return;
  }
  if (type === 'album' && item && !prev.albums.some((x) => x.id === id)) {
    queryClient.setQueryData<Starred>(KEY, {
      ...prev,
      albums: [{ ...(item as Album), starred }, ...prev.albums],
    });
    return;
  }
  if (type === 'artist' && item && !prev.artists.some((x) => x.id === id)) {
    queryClient.setQueryData<Starred>(KEY, {
      ...prev,
      artists: [{ ...(item as Artist), starred }, ...prev.artists],
    });
    return;
  }
  // Nothing to insert: ask for the list again, as it always did.
  void queryClient.invalidateQueries({ queryKey: KEY });
}

/** After a failed star/unstar, the cache may be telling a lie: ask again. */
export function resyncFavorites(): void {
  void queryClient.invalidateQueries({ queryKey: KEY });
}
