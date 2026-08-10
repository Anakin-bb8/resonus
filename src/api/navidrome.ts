/**
 * Minimal Navidrome native API client (non-Subsonic). Only used for what the
 * Subsonic API doesn't cover: custom cover art for playlists (≥ 0.61) and for
 * radio stations, whether a share allows downloading, and listing songs and
 * albums in an order Subsonic has no way to ask for. Requires cleartext
 * username and password to obtain a JWT (`auth.ndPassword`); see SubsonicAuth.
 */
// Not the global `fetch`: it never resolves in the background. See the note
// in `src/api/subsonic.ts`.
import { fetch } from 'expo/fetch';
import { type Album, type Song, type SortDirection, type SubsonicAuth } from './subsonic';
import { assertCanRequest } from './netGate';

/** Typed error to provide useful messages in the UI. */
export class NavidromeError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'forbidden' | 'unsupported' | 'other',
  ) {
    super(message);
  }
}

/**
 * The JWT for the profile last logged in, so paging through a list is one
 * request per page and not two. Navidrome's tokens outlive this by a long way;
 * half an hour is short enough that nothing has to watch them expire, and a
 * rejected one is thrown away and asked for again (see `ndJson`).
 */
let cached: { key: string; token: string; at: number } | null = null;
const TOKEN_TTL = 30 * 60 * 1000;

function tokenKey(auth: SubsonicAuth): string {
  return `${auth.serverUrl}|${auth.username}`;
}

/** Logs into the native API and returns the JWT. */
async function ndLogin(auth: SubsonicAuth, fresh = false): Promise<string> {
  // `password` is there when the profile authenticates in cleartext, and it is
  // the same password: no reason to ask for it twice.
  const password = auth.ndPassword ?? auth.password;
  if (!password) throw new NavidromeError('Sin contraseña guardada', 'auth');
  const key = tokenKey(auth);
  if (!fresh && cached?.key === key && Date.now() - cached.at < TOKEN_TTL) return cached.token;
  // Offline mode stops here, before the socket (see netGate).
  assertCanRequest();
  let res: Response;
  try {
    res = await fetch(`${auth.serverUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: auth.username, password }),
    });
  } catch {
    throw new NavidromeError('No se pudo conectar con el servidor', 'other');
  }
  if (res.status === 401) throw new NavidromeError('Credenciales incorrectas', 'auth');
  if (!res.ok) throw new NavidromeError(`Error de red (${res.status})`, 'other');
  const json = (await res.json()) as { token?: string };
  if (!json.token) throw new NavidromeError('Respuesta inesperada del servidor', 'other');
  cached = { key, token: json.token, at: Date.now() };
  return json.token;
}

/** Authenticated request to the native API, with errors mapped to NavidromeError. */
async function ndFetch(auth: SubsonicAuth, path: string, init: RequestInit): Promise<void> {
  const token = await ndLogin(auth, true);
  let res: Response;
  try {
    res = await fetch(`${auth.serverUrl}${path}`, {
      ...init,
      headers: { ...init.headers, 'x-nd-authorization': `Bearer ${token}` },
    });
  } catch {
    throw new NavidromeError('No se pudo conectar con el servidor', 'other');
  }
  if (res.ok) return;
  if (res.status === 401) throw new NavidromeError('Credenciales incorrectas', 'auth');
  if (res.status === 403) throw new NavidromeError('Subida de carátulas deshabilitada', 'forbidden');
  if (res.status === 404 || res.status === 405) {
    throw new NavidromeError('El servidor no soporta carátulas', 'unsupported');
  }
  throw new NavidromeError(`Error del servidor (${res.status})`, 'other');
}

/**
 * Lets a share be downloaded, not just listened to.
 *
 * Subsonic's `createShare` takes an id, a description and an expiry and nothing
 * else, so this is the only way to reach that flag. The share is still created
 * through Subsonic, which is what returns the public link the server wants
 * handed out (it honours `ND_SHAREURL`, which we would have no way of guessing);
 * this only edits the one field afterwards.
 *
 * The description goes along because Navidrome writes both columns from what it
 * is sent, so leaving it out would blank the one just set.
 */
export async function setShareDownloadable(
  auth: SubsonicAuth,
  id: string,
  downloadable: boolean,
  description?: string,
): Promise<void> {
  await ndFetch(auth, `/api/share/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ downloadable, description: description ?? '' }),
  });
}

/** What the image belongs to; both live under the same native API shape. */
export type CoverKind = 'playlist' | 'radio';

/**
 * Uploads a local image as the cover art of a playlist or a radio station.
 * Endpoint: POST /api/{kind}/{id}/image, multipart with "image" field
 * (jpeg/png/gif/webp). 403 if upload is disabled or the item doesn't belong
 * to the user; 404 on servers too old for it.
 */
export async function uploadCoverImage(
  auth: SubsonicAuth,
  kind: CoverKind,
  id: string,
  image: { uri: string; name: string; type: string },
): Promise<void> {
  const form = new FormData();
  // RN supports local files in FormData with {uri, name, type}.
  form.append('image', image as unknown as Blob);
  await ndFetch(auth, `/api/${kind}/${encodeURIComponent(id)}/image`, {
    method: 'POST',
    body: form,
  });
}

/** Removes the custom cover art; Navidrome falls back to its own default. */
export async function deleteCoverImage(
  auth: SubsonicAuth,
  kind: CoverKind,
  id: string,
): Promise<void> {
  await ndFetch(auth, `/api/${kind}/${encodeURIComponent(id)}/image`, {
    method: 'DELETE',
  });
}

// ── Listing songs ───────────────────────────────────────────────────────────

/**
 * What Navidrome's REST layer accepts for ordering media files. Subsonic has no
 * endpoint that lists songs in any order at all, and this one sorts and pages
 * like any other list, which is the whole reason to come down here.
 */
export type NdSongSort =
  | 'title'
  | 'album'
  | 'recently_added'
  | 'play_date'
  | 'play_count'
  | 'random';

/**
 * Which way round an order is meant to be read, before anybody says otherwise.
 *
 * A-Z for the ones that read as a list, newest first for the ones about time.
 * `album` is the first kind: it expands, server side, to the album's sort name
 * and then disc and track, so ascending is the record played in order. Only a
 * default: the menu can flip any of them.
 */
export function naturalSongDir(sort: NdSongSort): SortDirection {
  return sort === 'recently_added' || sort === 'play_date' || sort === 'play_count'
    ? 'desc'
    : 'asc';
}

/** The same question for albums; only the year and the arrival read backwards. */
export function naturalAlbumDir(sort: NdAlbumSort): SortDirection {
  return sort === 'recently_added' || sort === 'max_year' ? 'desc' : 'asc';
}

/** The fields of a media file this app has any use for. */
interface NdSong {
  id: string;
  title?: string;
  album?: string;
  albumId?: string;
  artist?: string;
  artistId?: string;
  trackNumber?: number;
  discNumber?: number;
  year?: number;
  duration?: number;
  suffix?: string;
  bitRate?: number;
  bitDepth?: number;
  sampleRate?: number;
  channels?: number;
  genre?: string;
  comment?: string;
  size?: number;
  playCount?: number;
  starred?: boolean;
  starredAt?: string;
  rating?: number;
  rgTrackGain?: number;
  rgTrackPeak?: number;
  rgAlbumGain?: number;
  rgAlbumPeak?: number;
}

/** Native song into the shape the rest of the app speaks (Subsonic's). */
function toSong(m: NdSong): Song {
  const gain = m.rgTrackGain ?? m.rgAlbumGain ?? m.rgTrackPeak ?? m.rgAlbumPeak;
  return {
    id: m.id,
    title: m.title ?? '',
    album: m.album,
    albumId: m.albumId,
    artist: m.artist,
    artistId: m.artistId,
    // Ids are the same ones Subsonic uses here, so the cover, the stream and
    // everything else keep working through the usual endpoints.
    coverArt: m.albumId ?? m.id,
    duration: m.duration,
    track: m.trackNumber,
    discNumber: m.discNumber,
    year: m.year,
    suffix: m.suffix,
    bitRate: m.bitRate,
    bitDepth: m.bitDepth,
    samplingRate: m.sampleRate,
    channelCount: m.channels,
    genre: m.genre,
    comment: m.comment,
    playCount: m.playCount,
    starred: m.starred ? (m.starredAt ?? new Date().toISOString()) : undefined,
    userRating: m.rating || undefined,
    ...(gain === undefined
      ? {}
      : {
          replayGain: {
            trackGain: m.rgTrackGain,
            albumGain: m.rgAlbumGain,
            trackPeak: m.rgTrackPeak,
            albumPeak: m.rgAlbumPeak,
          },
        }),
  };
}

/** Authenticated GET returning JSON, retrying once with a fresh token. */
async function ndJson<T>(auth: SubsonicAuth, path: string): Promise<T> {
  for (const fresh of [false, true]) {
    const token = await ndLogin(auth, fresh);
    let res: Response;
    try {
      res = await fetch(`${auth.serverUrl}${path}`, {
        headers: { 'x-nd-authorization': `Bearer ${token}` },
      });
    } catch {
      throw new NavidromeError('No se pudo conectar con el servidor', 'other');
    }
    // A token this old server no longer accepts: drop it and ask for another,
    // once. Anything else is an answer, good or bad.
    if (res.status === 401 && !fresh) continue;
    if (res.status === 401) throw new NavidromeError('Credenciales incorrectas', 'auth');
    if (res.status === 403) throw new NavidromeError('Sin permiso', 'forbidden');
    if (res.status === 404) throw new NavidromeError('El servidor no lo soporta', 'unsupported');
    if (!res.ok) throw new NavidromeError(`Error del servidor (${res.status})`, 'other');
    return (await res.json()) as T;
  }
  throw new NavidromeError('Credenciales incorrectas', 'auth');
}

/**
 * A page of the library's songs, ordered by the server.
 *
 * Endpoint: GET /api/song, which takes `_sort`, `_order`, `_start` and `_end`
 * the way every list in Navidrome's own web UI does, plus a `library_id` per
 * library to keep to the ones that are turned on. It pages properly, so an alphabetical listing of a six-figure
 * library costs one page at a time and nothing is pulled onto the phone to be
 * sorted here.
 */
export async function listSongs(
  auth: SubsonicAuth,
  sort: NdSongSort = 'title',
  count = 50,
  offset = 0,
  libraryIds?: string[],
  genreId?: string,
  dir?: SortDirection,
): Promise<Song[]> {
  const order = (dir ?? naturalSongDir(sort)) === 'asc' ? 'ASC' : 'DESC';
  const q = new URLSearchParams({
    _sort: sort,
    _order: order,
    _start: String(offset),
    _end: String(offset + count),
  });
  // Narrowing to one genre is the same list with a filter on it, which is what
  // makes a genre's songs sortable at all: Subsonic's own endpoint for them
  // takes no order, so the only alternative was to sort the page that happened
  // to be loaded and call it alphabetical.
  if (genreId) q.set('genre_id', genreId);
  // Navidrome's own name for what Subsonic calls a music folder, and the ids
  // are the same ones, so a library turned off in the app stays off here.
  // Repeated, one per library: the REST layer turns a parameter given more than
  // once into a list, and the filter becomes an `IN`, so several libraries are
  // still one request and still one sorted list.
  for (const id of libraryIds ?? []) q.append('library_id', id);
  const rows = await ndJson<NdSong[]>(auth, `/api/song?${q.toString()}`);
  return Array.isArray(rows) ? rows.map(toSong) : [];
}

/**
 * What Navidrome's REST layer accepts for ordering albums. A shorter list than
 * the songs one, and deliberately only the names its own sort mappings
 * declare: an unknown one falls through to a column name, which either works
 * or sorts by nothing, and neither is worth offering as a menu entry.
 */
export type NdAlbumSort = 'name' | 'artist' | 'max_year' | 'recently_added' | 'random';

/** The fields of an album this app has any use for. */
interface NdAlbum {
  id: string;
  name?: string;
  albumArtist?: string;
  albumArtistId?: string;
  artist?: string;
  artistId?: string;
  maxYear?: number;
  minYear?: number;
  songCount?: number;
  createdAt?: string;
  playCount?: number;
  playDate?: string;
  genre?: string;
}

function toAlbum(a: NdAlbum): Album {
  return {
    id: a.id,
    name: a.name ?? '',
    // The album artist is what an album is filed under; `artist` on this model
    // is the track artist and would put a compilation under whoever happened to
    // sing first.
    artist: a.albumArtist ?? a.artist,
    artistId: a.albumArtistId ?? a.artistId,
    // Same ids as Subsonic, so covers keep coming from the usual endpoint.
    coverArt: a.id,
    songCount: a.songCount,
    // The year an album is shown by is the one it finished on, which is what
    // Subsonic's `year` means here too.
    year: a.maxYear ?? a.minYear,
    created: a.createdAt,
    played: a.playDate,
    playCount: a.playCount,
    genre: a.genre,
  };
}

/**
 * A page of albums, ordered by the server, optionally narrowed to one genre.
 *
 * Same reasoning as `listSongs`: Subsonic's `getAlbumList2` takes one of its
 * own fixed types OR a genre, never both, so a genre's albums arrive in
 * whatever order that server felt like and no client can ask for another.
 */
export async function listAlbums(
  auth: SubsonicAuth,
  sort: NdAlbumSort = 'name',
  count = 30,
  offset = 0,
  libraryIds?: string[],
  genreId?: string,
  dir?: SortDirection,
): Promise<Album[]> {
  const order = (dir ?? naturalAlbumDir(sort)) === 'asc' ? 'ASC' : 'DESC';
  const q = new URLSearchParams({
    _sort: sort,
    _order: order,
    _start: String(offset),
    _end: String(offset + count),
  });
  for (const id of libraryIds ?? []) q.append('library_id', id);
  if (genreId) q.set('genre_id', genreId);
  const rows = await ndJson<NdAlbum[]>(auth, `/api/album?${q.toString()}`);
  return Array.isArray(rows) ? rows.map(toAlbum) : [];
}

/** A genre as this server names it. The id is what its own filters take. */
export interface NdGenre {
  id: string;
  name: string;
}

/**
 * Every genre the server knows.
 *
 * Subsonic hands back genre NAMES and nothing else, which is what the app
 * routes by, and Navidrome's own lists filter by id. So the name has to be
 * turned into one before a genre's songs can be asked for in any order. The
 * whole list comes in one request and is small enough to keep: a library with
 * a thousand distinct genres is already unusual, and this is a name and an id
 * each.
 */
export async function listGenres(auth: SubsonicAuth): Promise<NdGenre[]> {
  const rows = await ndJson<NdGenre[]>(auth, '/api/genre?_sort=name&_start=0&_end=1000');
  return Array.isArray(rows) ? rows.filter((g) => g?.id && g?.name) : [];
}
