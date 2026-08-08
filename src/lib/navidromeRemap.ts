/**
 * Where the server's ids actually live, and how to rewrite each shape.
 *
 * `navidromeIds.ts` answers what an id becomes. This answers *which strings are
 * ids*, which turns out to be the harder half and the one that can quietly
 * destroy data.
 *
 * Everything here enumerates its fields by hand. Walking an object and
 * rewriting anything that looks like an id is the obvious implementation and it
 * is wrong: a `Song` carries `musicBrainzId` three fields away from `albumId`,
 * an MBID is 36 characters with a UUID's dashes, and the transform cannot tell
 * the two apart. Navidrome exempts its own `mbz_*` columns for exactly this
 * reason. A generic walk would rewrite every MusicBrainz id in the catalog into
 * a plausible-looking value that matches nothing, and nothing downstream would
 * report an error.
 *
 * The remap function is a parameter rather than `canonicalId` reached for
 * directly. It keeps this file testable without the transform, and it is what
 * lets the same code run a repair backwards from the saved original ids if a
 * server is ever rolled back to a version from before the migration.
 */
import type { Album, Song } from '@/api/subsonic';

/** Rewrites one id. In practice `canonicalId`, or its inverse when undoing. */
export type Remap = (id: string) => string;

/**
 * A playlist created while offline holds a made-up id until it reaches the
 * server (`tmp_…`, from `api/data.ts`). It is not the server's to rewrite.
 *
 * Today these are safe by accident: the underscore is not a base62 character,
 * so the transform passes them through. That is a property of an id format
 * chosen for other reasons and it should not be what protects the outbox, so
 * every caller that can meet one checks here instead.
 */
export function isTemporaryId(id: string): boolean {
  return id.startsWith('tmp_');
}

function map(id: string | undefined, f: Remap): string | undefined {
  if (id === undefined || isTemporaryId(id)) return id;
  return f(id);
}

/** `{ id, name }` as it arrives in `artists` and `albumArtists`. */
function remapNamed<T extends { id: string }>(list: T[] | undefined, f: Remap): T[] | undefined {
  return list?.map((entry) => ({ ...entry, id: f(entry.id) }));
}

/**
 * A song, with every id the server owns rewritten and everything else left
 * exactly as it was.
 *
 * NOT rewritten, deliberately: `musicBrainzId` and the other recording
 * identifiers, which belong to MusicBrainz and not to this server; `url`,
 * which is a stream address for radio and carries no catalog id; and
 * `localUri`, which is where the downloaded file sits on this phone. That last
 * one is why a remap does not have to touch the disk at all: files are found
 * through the path saved next to them, never by recomputing anything from the
 * id, so the bytes stay where they are under the name they already have.
 */
export function remapSong(song: Song, f: Remap): Song {
  return {
    ...song,
    id: f(song.id),
    albumId: map(song.albumId, f),
    artistId: map(song.artistId, f),
    artists: remapNamed(song.artists, f),
    albumArtists: remapNamed(song.albumArtists, f),
  };
}

/** An album, on the same terms as `remapSong`. */
export function remapAlbum(album: Album, f: Remap): Album {
  return {
    ...album,
    id: f(album.id),
    artistId: map(album.artistId, f),
    artists: remapNamed(album.artists, f),
  };
}

/**
 * The keys of an `id → value` map, for the several stores shaped that way:
 * pinned times, play counts, last played, queued favourites and ratings, the
 * set of songs downloaded automatically.
 *
 * Two ids can collide onto one after the transform only if they were the same
 * id twice, which a map cannot hold, so a later key never silently eats an
 * earlier one.
 */
export function remapKeys<V>(record: Record<string, V>, f: Remap): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [key, value] of Object.entries(record)) out[map(key, f) as string] = value;
  return out;
}

/** A list of ids: a playlist's tracklist, an offline edit's final order. */
export function remapIds(ids: string[], f: Remap): string[] {
  return ids.map((id) => map(id, f) as string);
}

/**
 * A pin's key, which is not an id but a kind and an id joined by a colon
 * (`album:…`, `playlist:…`, `radio:…`). Splitting on the first colon only:
 * the kind never contains one and the id is whatever follows.
 *
 * A key in any other shape is left alone rather than guessed at. Radio ids do
 * get rewritten by the server, so they are not an exception here.
 */
export function remapPinKey(key: string, f: Remap): string {
  const colon = key.indexOf(':');
  if (colon <= 0) return key;
  const id = key.slice(colon + 1);
  if (!id || isTemporaryId(id)) return key;
  return `${key.slice(0, colon)}:${f(id)}`;
}
