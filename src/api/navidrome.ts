/**
 * Minimal Navidrome native API client (non-Subsonic). Only used for what the
 * Subsonic API doesn't cover: custom cover art for playlists (≥ 0.61) and for
 * radio stations, whether a share allows downloading, and listing songs in an
 * order Subsonic has no way to ask for. Requires cleartext username and
 * password to obtain a JWT (`auth.ndPassword`); see SubsonicAuth.
 */
import { type Song, type SubsonicAuth } from './subsonic';
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
export type NdSongSort = 'title' | 'recently_added' | 'play_date' | 'play_count' | 'random';

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
): Promise<Song[]> {
  const order = sort === 'title' || sort === 'random' ? 'ASC' : 'DESC';
  const q = new URLSearchParams({
    _sort: sort,
    _order: order,
    _start: String(offset),
    _end: String(offset + count),
  });
  // Navidrome's own name for what Subsonic calls a music folder, and the ids
  // are the same ones, so a library turned off in the app stays off here.
  // Repeated, one per library: the REST layer turns a parameter given more than
  // once into a list, and the filter becomes an `IN`, so several libraries are
  // still one request and still one sorted list.
  for (const id of libraryIds ?? []) q.append('library_id', id);
  const rows = await ndJson<NdSong[]>(auth, `/api/song?${q.toString()}`);
  return Array.isArray(rows) ? rows.map(toSong) : [];
}
