/**
 * Resolves which artist(s) a song or album can navigate to. A single
 * option navigates directly; multiple (collaborations) opens the picker.
 */
import type { Album, Song } from '@/api/subsonic';

export interface ArtistTarget {
  id: string;
  name: string;
}

/** Navigable artist list, no duplicates or empty ids, remixers last (#215). */
export function artistTargets(
  item: Pick<Song | Album, 'artist' | 'artistId' | 'artists'> & Pick<Song, 'contributors'>,
): ArtistTarget[] {
  let list = (item.artists ?? []).filter((a) => a.id);
  if (list.length === 0 && item.artistId) list = [{ id: item.artistId, name: item.artist ?? '' }];
  const remixers = (item.contributors ?? []).filter((c) => c.role === 'remixer' && c.artist.id);
  const seen = new Set<string>();
  return [...list, ...remixers.map((c) => c.artist)].filter((a) =>
    seen.has(a.id) ? false : (seen.add(a.id), true),
  );
}
