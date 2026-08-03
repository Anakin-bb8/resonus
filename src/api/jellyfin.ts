/**
 * Minimal Jellyfin API client (native API, not Subsonic-compatible).
 *
 * Session-based authentication: on login (`makeAuth`),
 * `/Users/AuthenticateByName` is called and the token and user id are saved in
 * the profile (`jfToken`/`jfUserId`); each request carries the
 * `Authorization: MediaBrowser ... Token="..."` header. URLs consumed by
 * native views (cover art, streaming) cannot carry headers, so they use the
 * `api_key` parameter.
 *
 * The exported functions mirror the signatures of `subsonic.ts`; the
 * `backend.ts` module picks one implementation or the other based on server
 * type.
 */
import * as Crypto from 'expo-crypto';

import {
  CLIENT_NAME,
  normalizeUrl,
  SubsonicRequestError,
  type Album,
  type AlbumListType,
  type Artist,
  type ArtistInfo,
  type Genre,
  type GuestAlbum,
  type MusicFolder,
  type Playlist,
  type RadioStation,
  type SavedQueue,
  type ScanStatus,
  type SearchResult,
  type Song,
  type SongListSort,
  type SongLyrics,
  type StarType,
  type Starred,
  type SubsonicAuth,
} from './subsonic';

const CLIENT_VERSION = '1.0';
const REQUEST_TIMEOUT_MS = 15000;

/** A Jellyfin tick is 100 ns; API times come in ticks. */
const TICKS_PER_SECOND = 10_000_000;
const TICKS_PER_MS = 10_000;

/** Extra fields that must be requested explicitly for each item type. */
const ALBUM_FIELDS = 'ChildCount,DateCreated,Genres';
const SONG_FIELDS = 'MediaSources,DateCreated,NormalizationGain,Genres';
const PLAYLIST_FIELDS = 'ChildCount,DateCreated,DateLastMediaAdded';

/** Subset of BaseItemDto that the app uses. */
interface JfItem {
  Id: string;
  Name?: string;
  Overview?: string;
  Album?: string;
  AlbumId?: string;
  AlbumArtist?: string;
  AlbumArtists?: { Id: string; Name?: string }[];
  Artists?: string[];
  ArtistItems?: { Id: string; Name?: string }[];
  RunTimeTicks?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ProductionYear?: number;
  ChildCount?: number;
  DateCreated?: string;
  DateLastMediaAdded?: string;
  Genres?: string[];
  ImageTags?: { Primary?: string };
  AlbumPrimaryImageTag?: string;
  UserData?: { IsFavorite?: boolean; LastPlayedDate?: string; PlayCount?: number };
  /** Normalization gain in dB (server LUFS analysis, 10.9+). */
  NormalizationGain?: number;
  MediaSources?: {
    Container?: string;
    Bitrate?: number;
    MediaStreams?: { Type?: string; BitDepth?: number; SampleRate?: number }[];
  }[];
}

interface JfItems {
  Items?: JfItem[];
}

function randomHex(bytes: number): string {
  return Array.from(Crypto.getRandomBytes(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function authHeader(auth: SubsonicAuth): string {
  return (
    `MediaBrowser Client="${CLIENT_NAME}", Device="Android", ` +
    `DeviceId="${auth.jfDeviceId}", Version="${CLIENT_VERSION}", Token="${auth.jfToken}"`
  );
}

type Params = Record<string, string | number | boolean | undefined>;

function buildUrl(auth: SubsonicAuth, path: string, params: Params = {}): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) q.set(key, String(value));
  }
  const qs = q.toString();
  return `${auth.serverUrl}${path}${qs ? `?${qs}` : ''}`;
}

/** Authenticated request; returns the JSON (or undefined if no body). */
async function request<T>(
  auth: SubsonicAuth,
  path: string,
  params: Params = {},
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(buildUrl(auth, path, params), {
      method: init.method ?? 'GET',
      headers: {
        Authorization: authHeader(auth),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new SubsonicRequestError('El servidor tardó demasiado en responder', true);
    }
    throw new SubsonicRequestError('No se pudo conectar con el servidor', true);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    throw new SubsonicRequestError('Sesión caducada: vuelve a iniciar sesión', false);
  }
  if (!res.ok) throw new SubsonicRequestError(`Error de red (${res.status})`, false);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Logs in against `/Users/AuthenticateByName` and builds the profile.
 * The device id is generated here and kept in the profile (Jellyfin
 * associates the session with that id).
 */
export async function makeAuth(
  serverUrl: string,
  username: string,
  password: string,
): Promise<SubsonicAuth> {
  const url = normalizeUrl(serverUrl);
  const deviceId = randomHex(16);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${url}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          `MediaBrowser Client="${CLIENT_NAME}", Device="Android", ` +
          `DeviceId="${deviceId}", Version="${CLIENT_VERSION}"`,
      },
      body: JSON.stringify({ Username: username, Pw: password }),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new Error('El servidor tardó demasiado en responder');
    }
    throw new Error('No se pudo conectar con el servidor');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) throw new Error('Usuario o contraseña incorrectos');
  if (!res.ok) throw new Error(`Error de red (${res.status})`);
  const data = (await res.json()) as { AccessToken?: string; User?: { Id?: string } };
  if (!data.AccessToken || !data.User?.Id) {
    throw new Error('Respuesta inesperada del servidor');
  }
  return {
    serverUrl: url,
    username,
    token: '',
    salt: '',
    serverType: 'jellyfin',
    jfToken: data.AccessToken,
    jfUserId: data.User.Id,
    jfDeviceId: deviceId,
  };
}

/** Checks that the session token is still valid. */
export async function ping(auth: SubsonicAuth): Promise<void> {
  await request(auth, '/Users/Me');
}

// ── Mapping BaseItemDto to app models ──

/**
 * Our model marks favorites with the date they were set; Jellyfin does not
 * expose it, so the item's creation date is used as an approximation.
 */
function favDate(it: JfItem): string | undefined {
  return it.UserData?.IsFavorite ? (it.DateCreated ?? '1970-01-01T00:00:00.000Z') : undefined;
}

function toSong(it: JfItem): Song {
  const src = it.MediaSources?.[0];
  const audio = src?.MediaStreams?.find((s) => s.Type === 'Audio');
  return {
    id: it.Id,
    title: it.Name ?? '',
    album: it.Album,
    artist: it.Artists?.length ? it.Artists.join(', ') : it.AlbumArtist,
    albumId: it.AlbumId,
    artistId: it.ArtistItems?.[0]?.Id ?? it.AlbumArtists?.[0]?.Id,
    artists: (it.ArtistItems ?? it.AlbumArtists)?.map((a) => ({ id: a.Id, name: a.Name ?? '' })),
    // A song's cover art is usually its album's; its own only if
    // the file has embedded art.
    coverArt:
      it.AlbumPrimaryImageTag && it.AlbumId
        ? it.AlbumId
        : it.ImageTags?.Primary
          ? it.Id
          : undefined,
    genre: it.Genres?.[0],
    duration: it.RunTimeTicks ? Math.round(it.RunTimeTicks / TICKS_PER_SECOND) : undefined,
    track: it.IndexNumber,
    discNumber: it.ParentIndexNumber,
    starred: favDate(it),
    suffix: src?.Container,
    bitRate: src?.Bitrate ? Math.round(src.Bitrate / 1000) : undefined,
    bitDepth: audio?.BitDepth,
    samplingRate: audio?.SampleRate,
    year: it.ProductionYear,
    // Jellyfin does not expose per-track/per-album ReplayGain; its
    // NormalizationGain (LUFS) serves the same role as track gain.
    replayGain:
      typeof it.NormalizationGain === 'number'
        ? { trackGain: it.NormalizationGain }
        : undefined,
  };
}

function toAlbum(it: JfItem): Album {
  return {
    id: it.Id,
    name: it.Name ?? '',
    artist: it.AlbumArtist ?? it.Artists?.join(', '),
    artistId: it.AlbumArtists?.[0]?.Id,
    artists: it.AlbumArtists?.map((a) => ({ id: a.Id, name: a.Name ?? '' })),
    coverArt: it.ImageTags?.Primary ? it.Id : undefined,
    songCount: it.ChildCount,
    year: it.ProductionYear,
    starred: favDate(it),
    created: it.DateCreated,
    played: it.UserData?.LastPlayedDate,
    playCount: it.UserData?.PlayCount,
    genres: it.Genres?.map((name) => ({ name })),
  };
}

function toArtist(it: JfItem): Artist {
  return {
    id: it.Id,
    name: it.Name ?? '',
    coverArt: it.ImageTags?.Primary ? it.Id : undefined,
    starred: favDate(it),
  };
}

function toPlaylist(it: JfItem): Playlist {
  return {
    id: it.Id,
    name: it.Name ?? '',
    // What Subsonic calls the playlist's comment. Jellyfin lets it be written
    // with markup, and the header is one plain line: the same stripping the
    // artist biography already gets.
    comment: it.Overview?.replace(/<[^>]+>/g, '').trim() || undefined,
    songCount: it.ChildCount,
    coverArt: it.ImageTags?.Primary ? it.Id : undefined,
    created: it.DateCreated,
    changed: it.DateLastMediaAdded,
  };
}

// ── Catalog ──

const ALBUM_SORT: Record<AlbumListType, { SortBy: string; SortOrder?: string; Filters?: string }> =
  {
    newest: { SortBy: 'DateCreated', SortOrder: 'Descending' },
    recent: { SortBy: 'DatePlayed', SortOrder: 'Descending' },
    frequent: { SortBy: 'PlayCount', SortOrder: 'Descending' },
    random: { SortBy: 'Random' },
    alphabeticalByName: { SortBy: 'SortName' },
    alphabeticalByArtist: { SortBy: 'AlbumArtist,SortName' },
    starred: { SortBy: 'SortName', Filters: 'IsFavorite' },
  };

/** Jellyfin has its own libraries, but folder filtering is Subsonic. */
export async function getMusicFolders(_auth: SubsonicAuth): Promise<MusicFolder[]> {
  return [];
}

export async function getAlbumList(
  auth: SubsonicAuth,
  type: AlbumListType = 'newest',
  size = 20,
  offset = 0,
  _musicFolderId?: string,
): Promise<Album[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'MusicAlbum',
    Recursive: true,
    Limit: size,
    StartIndex: offset,
    Fields: ALBUM_FIELDS,
    ...ALBUM_SORT[type],
  });
  return (res.Items ?? []).map(toAlbum);
}

export async function getGenres(auth: SubsonicAuth): Promise<Genre[]> {
  const res = await request<JfItems>(auth, '/MusicGenres', {
    UserId: auth.jfUserId,
    SortBy: 'SortName',
  });
  return (res.Items ?? [])
    .map((it) => ({ value: it.Name ?? '' }))
    .filter((g) => g.value);
}

export async function getAlbumsByGenre(
  auth: SubsonicAuth,
  genre: string,
  size = 30,
  offset = 0,
  _musicFolderId?: string,
): Promise<Album[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'MusicAlbum',
    Recursive: true,
    Genres: genre,
    Limit: size,
    StartIndex: offset,
    SortBy: 'SortName',
    Fields: ALBUM_FIELDS,
  });
  return (res.Items ?? []).map(toAlbum);
}

/** Songs tagged with a genre (Jellyfin filters items by genre directly). */
const SONG_SORT: Record<SongListSort, { SortBy: string; SortOrder?: string }> = {
  // Jellyfin has no "the order they are in" to speak of, so its own idea of
  // order is the alphabet. It never offers this one anyway (see backend.ts).
  server: { SortBy: 'SortName' },
  recent: { SortBy: 'DatePlayed', SortOrder: 'Descending' },
  alpha: { SortBy: 'SortName' },
  added: { SortBy: 'DateCreated', SortOrder: 'Descending' },
  frequent: { SortBy: 'PlayCount', SortOrder: 'Descending' },
  random: { SortBy: 'Random' },
};

/** The library's songs, a page at a time and in the order asked for. */
export async function getSongList(
  auth: SubsonicAuth,
  sort: SongListSort = 'alpha',
  count = 50,
  offset = 0,
  _musicFolderId?: string,
): Promise<Song[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'Audio',
    Recursive: true,
    Limit: count,
    StartIndex: offset,
    Fields: SONG_FIELDS,
    ...SONG_SORT[sort],
  });
  return (res.Items ?? []).map(toSong);
}

export async function getSongsByGenre(
  auth: SubsonicAuth,
  genre: string,
  count = 50,
  offset = 0,
  _musicFolderId?: string,
): Promise<Song[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'Audio',
    Recursive: true,
    Genres: genre,
    Limit: count,
    StartIndex: offset,
    SortBy: 'Album,ParentIndexNumber,IndexNumber',
    Fields: SONG_FIELDS,
  });
  return (res.Items ?? []).map(toSong);
}

export async function getAlbum(
  auth: SubsonicAuth,
  id: string,
): Promise<{ album: Album; songs: Song[] }> {
  const [item, children] = await Promise.all([
    request<JfItem>(auth, `/Users/${auth.jfUserId}/Items/${id}`),
    request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
      ParentId: id,
      IncludeItemTypes: 'Audio',
      SortBy: 'ParentIndexNumber,IndexNumber,SortName',
      Fields: SONG_FIELDS,
    }),
  ]);
  return { album: toAlbum(item), songs: (children.Items ?? []).map(toSong) };
}

export async function getArtists(auth: SubsonicAuth, _musicFolderId?: string): Promise<Artist[]> {
  const res = await request<JfItems>(auth, '/Artists/AlbumArtists', {
    UserId: auth.jfUserId,
    SortBy: 'SortName',
  });
  return (res.Items ?? []).map(toArtist);
}

export async function getArtist(
  auth: SubsonicAuth,
  id: string,
): Promise<{ artist: Artist; albums: Album[] }> {
  const [item, albums] = await Promise.all([
    request<JfItem>(auth, `/Users/${auth.jfUserId}/Items/${id}`),
    request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
      IncludeItemTypes: 'MusicAlbum',
      Recursive: true,
      AlbumArtistIds: id,
      SortBy: 'ProductionYear,SortName',
      SortOrder: 'Descending',
      Fields: ALBUM_FIELDS,
    }),
  ]);
  return { artist: toArtist(item), albums: (albums.Items ?? []).map(toAlbum) };
}

/** Albums where the artist collaborates without being the album artist ("Appears on"). */
export async function getAppearsOn(
  auth: SubsonicAuth,
  artistId: string,
  _artistName: string,
  _musicFolderId?: string,
): Promise<GuestAlbum[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'MusicAlbum',
    Recursive: true,
    ContributingArtistIds: artistId,
    SortBy: 'ProductionYear,SortName',
    SortOrder: 'Descending',
    Fields: ALBUM_FIELDS,
  });
  // Jellyfin answers this directly, so there is nothing to second-guess.
  return (res.Items ?? []).map((i) => ({ ...toAlbum(i), confirmed: true }));
}

export async function getArtistInfo(auth: SubsonicAuth, id: string): Promise<ArtistInfo> {
  const [item, similar] = await Promise.all([
    request<JfItem>(auth, `/Users/${auth.jfUserId}/Items/${id}`),
    request<JfItems>(auth, `/Items/${id}/Similar`, {
      UserId: auth.jfUserId,
      Limit: 12,
    }).catch(() => ({ Items: [] }) as JfItems),
  ]);
  return {
    biography: item.Overview?.replace(/<[^>]+>/g, '').trim() || undefined,
    imageUrl: item.ImageTags?.Primary ? coverArtUrl(auth, item.Id, 600) : undefined,
    similarArtists: (similar.Items ?? []).map(toArtist),
  };
}

/** Most played songs by an artist (Jellyfin filters by name). */
export async function getTopSongs(
  auth: SubsonicAuth,
  artist: string,
  count = 10,
): Promise<Song[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'Audio',
    Recursive: true,
    Artists: artist,
    SortBy: 'PlayCount,SortName',
    SortOrder: 'Descending',
    Limit: count,
    Fields: SONG_FIELDS,
  });
  return (res.Items ?? []).map(toSong);
}

/** Most listened songs (Jellyfin sorts by PlayCount directly). */
export async function getMostPlayedSongs(
  auth: SubsonicAuth,
  size = 50,
  _musicFolderId?: string,
): Promise<Song[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'Audio',
    Recursive: true,
    Filters: 'IsPlayed',
    SortBy: 'PlayCount,SortName',
    SortOrder: 'Descending',
    Limit: size,
    Fields: SONG_FIELDS,
  });
  return (res.Items ?? []).map(toSong);
}

/** Random songs from the entire library (the Home mix). */
export async function getRandomSongs(
  auth: SubsonicAuth,
  size = 200,
  genre?: string,
  _musicFolderId?: string,
): Promise<Song[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'Audio',
    Recursive: true,
    SortBy: 'Random',
    Limit: size,
    ...(genre ? { Genres: genre } : {}),
    Fields: SONG_FIELDS,
  });
  return (res.Items ?? []).map(toSong);
}

/** Songs similar to a given one via Instant Mix (autoplay / radio). */
export async function getSimilarSongs(
  auth: SubsonicAuth,
  id: string,
  count = 20,
): Promise<Song[]> {
  const res = await request<JfItems>(auth, `/Songs/${id}/InstantMix`, {
    UserId: auth.jfUserId,
    Limit: count + 1,
    Fields: SONG_FIELDS,
  });
  // The mix includes the seed song; Subsonic does not return it.
  return (res.Items ?? []).filter((it) => it.Id !== id).slice(0, count).map(toSong);
}

/** Album-only search: one request, not the three of `search`. */
export async function searchAlbums(
  auth: SubsonicAuth,
  query: string,
  count = 50,
  _musicFolderId?: string,
): Promise<Album[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    SearchTerm: query,
    IncludeItemTypes: 'MusicAlbum',
    Recursive: true,
    Limit: count,
    Fields: ALBUM_FIELDS,
  });
  return (res.Items ?? []).map(toAlbum);
}

export async function searchSongs(
  auth: SubsonicAuth,
  query: string,
  count = 50,
  _musicFolderId?: string,
): Promise<Song[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    SearchTerm: query,
    IncludeItemTypes: 'Audio',
    Recursive: true,
    Limit: count,
    Fields: SONG_FIELDS,
  });
  return (res.Items ?? []).map(toSong);
}

export async function search(
  auth: SubsonicAuth,
  query: string,
  _musicFolderId?: string,
): Promise<SearchResult> {
  const items = (kind: 'MusicAlbum' | 'Audio') =>
    request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
      SearchTerm: query,
      IncludeItemTypes: kind,
      Recursive: true,
      Limit: 20,
      Fields: kind === 'Audio' ? SONG_FIELDS : ALBUM_FIELDS,
    });
  const [artists, albums, songs] = await Promise.all([
    request<JfItems>(auth, '/Artists', { UserId: auth.jfUserId, SearchTerm: query, Limit: 20 }),
    items('MusicAlbum'),
    items('Audio'),
  ]);
  return {
    artists: (artists.Items ?? []).map(toArtist),
    albums: (albums.Items ?? []).map(toAlbum),
    songs: (songs.Items ?? []).map(toSong),
  };
}

// ── Favorites ──

export async function getStarred(auth: SubsonicAuth, _musicFolderId?: string): Promise<Starred> {
  const fav = (kind: 'MusicAlbum' | 'Audio') =>
    request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
      Filters: 'IsFavorite',
      IncludeItemTypes: kind,
      Recursive: true,
      Fields: kind === 'Audio' ? SONG_FIELDS : ALBUM_FIELDS,
    });
  const [songs, albums, artists] = await Promise.all([
    fav('Audio'),
    fav('MusicAlbum'),
    request<JfItems>(auth, '/Artists', { UserId: auth.jfUserId, IsFavorite: true }),
  ]);
  return {
    songs: (songs.Items ?? []).map(toSong),
    albums: (albums.Items ?? []).map(toAlbum),
    artists: (artists.Items ?? []).map(toArtist),
  };
}

/** In Jellyfin, favorites are per item, without distinguishing type. */
export async function star(auth: SubsonicAuth, id: string, _type: StarType = 'song'): Promise<void> {
  await request(auth, `/Users/${auth.jfUserId}/FavoriteItems/${id}`, {}, { method: 'POST' });
}

export async function unstar(
  auth: SubsonicAuth,
  id: string,
  _type: StarType = 'song',
): Promise<void> {
  await request(auth, `/Users/${auth.jfUserId}/FavoriteItems/${id}`, {}, { method: 'DELETE' });
}

/**
 * Jellyfin does not expose Subsonic's 1-5 star rating (only a
 * like/dislike). The rating bar is hidden for these profiles, so this is a
 * no-op and should never be called.
 */
export function setRating(_auth: SubsonicAuth, _id: string, _rating: number): Promise<void> {
  return Promise.resolve();
}

// ── Playlists ──

export async function getPlaylists(auth: SubsonicAuth): Promise<Playlist[]> {
  const res = await request<JfItems>(auth, `/Users/${auth.jfUserId}/Items`, {
    IncludeItemTypes: 'Playlist',
    Recursive: true,
    SortBy: 'SortName',
    Fields: PLAYLIST_FIELDS,
  });
  return (res.Items ?? []).map(toPlaylist);
}

export async function getPlaylist(
  auth: SubsonicAuth,
  id: string,
): Promise<{ playlist: Playlist; songs: Song[] }> {
  const [item, children] = await Promise.all([
    request<JfItem>(auth, `/Users/${auth.jfUserId}/Items/${id}`),
    request<JfItems>(auth, `/Playlists/${id}/Items`, {
      UserId: auth.jfUserId,
      Fields: SONG_FIELDS,
    }),
  ]);
  return { playlist: toPlaylist(item), songs: (children.Items ?? []).map(toSong) };
}

export async function addToPlaylist(
  auth: SubsonicAuth,
  playlistId: string,
  songId: string,
): Promise<void> {
  await request(
    auth,
    `/Playlists/${playlistId}/Items`,
    { Ids: songId, UserId: auth.jfUserId },
    { method: 'POST' },
  );
}

export async function createPlaylist(auth: SubsonicAuth, name: string): Promise<string> {
  const res = await request<{ Id?: string }>(
    auth,
    '/Playlists',
    {},
    { method: 'POST', body: { Name: name, UserId: auth.jfUserId, MediaType: 'Audio' } },
  );
  if (!res?.Id) throw new Error('No se encontró la playlist creada');
  return res.Id;
}

export async function deletePlaylist(auth: SubsonicAuth, id: string): Promise<void> {
  await request(auth, `/Items/${id}`, {}, { method: 'DELETE' });
}

/** Renames the playlist (Jellyfin 10.9+; no description field). */
export async function updatePlaylist(
  auth: SubsonicAuth,
  id: string,
  changes: { name?: string; comment?: string; public?: boolean },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (changes.name !== undefined) body.Name = changes.name;
  if (changes.public !== undefined) body.IsPublic = changes.public;
  if (Object.keys(body).length === 0) return;
  await request(auth, `/Playlists/${id}`, {}, { method: 'POST', body });
}

/** Removes a song by position: its entry id must be resolved first. */
export async function removeFromPlaylist(
  auth: SubsonicAuth,
  id: string,
  index: number,
): Promise<void> {
  const res = await request<{ Items?: { PlaylistItemId?: string }[] }>(
    auth,
    `/Playlists/${id}/Items`,
    { UserId: auth.jfUserId },
  );
  const entryId = res.Items?.[index]?.PlaylistItemId;
  if (!entryId) throw new Error('No se encontró la canción en la lista');
  await request(auth, `/Playlists/${id}/Items`, { EntryIds: entryId }, { method: 'DELETE' });
}

// ── Server library ──

interface JfTask {
  Key?: string;
  State?: string;
}

export async function getScanStatus(auth: SubsonicAuth): Promise<ScanStatus> {
  const tasks = await request<JfTask[]>(auth, '/ScheduledTasks');
  const refresh = tasks.find((t) => t.Key === 'RefreshLibrary');
  return { scanning: refresh?.State === 'Running', count: 0 };
}

export async function startScan(auth: SubsonicAuth): Promise<ScanStatus> {
  await request(auth, '/Library/Refresh', {}, { method: 'POST' });
  return { scanning: true, count: 0 };
}

// ── Lyrics ──

/** Jellyfin has no lyrics search by artist+title. */
export async function getLyrics(
  _auth: SubsonicAuth,
  _artist: string,
  _title: string,
): Promise<string> {
  return '';
}

/** Item lyrics (`/Audio/{id}/Lyrics`, 10.9+); times in ticks. */
export async function getLyricsBySongId(
  auth: SubsonicAuth,
  id: string,
): Promise<SongLyrics | null> {
  let res: { Lyrics?: { Text?: string; Start?: number }[] };
  try {
    res = await request(auth, `/Audio/${id}/Lyrics`);
  } catch {
    return null; // 404 if the song has no lyrics (or server < 10.9)
  }
  const lines = res?.Lyrics ?? [];
  if (lines.length === 0) return null;
  const synced = lines.some((l) => l.Start !== undefined);
  return {
    synced,
    lines: lines.map((l) => ({
      value: l.Text ?? '',
      ...(synced && l.Start !== undefined ? { start: Math.round(l.Start / TICKS_PER_MS) } : {}),
    })),
  };
}

// ── No Jellyfin equivalent ──

/** Jellyfin does not save the queue on the server; the device copy remains. */
export async function savePlayQueue(
  _auth: SubsonicAuth,
  _ids: string[],
  _currentId: string,
  _positionMs: number,
): Promise<void> {}

export async function getPlayQueue(_auth: SubsonicAuth): Promise<SavedQueue | null> {
  return null;
}

/** Jellyfin has no internet radio stations. */
export async function getRadioStations(_auth: SubsonicAuth): Promise<RadioStation[]> {
  return [];
}

/** Jellyfin does not support managing radio stations. */
export async function createRadioStation(
  _auth: SubsonicAuth,
  _name: string,
  _streamUrl: string,
  _homePageUrl?: string,
): Promise<string | undefined> {
  throw new Error('Jellyfin no soporta emisoras de radio');
}

export async function updateRadioStation(
  _auth: SubsonicAuth,
  _id: string,
  _name: string,
  _streamUrl: string,
  _homePageUrl?: string,
): Promise<void> {
  throw new Error('Jellyfin no soporta emisoras de radio');
}

export async function deleteRadioStation(_auth: SubsonicAuth, _id: string): Promise<void> {
  throw new Error('Jellyfin no soporta emisoras de radio');
}

// ── Playback ──

/** Marks the song as played (updates counter and date). */
export async function scrobble(auth: SubsonicAuth, id: string, submission = true): Promise<void> {
  // Jellyfin has no cheap "now playing" (requires full playback
  // sessions); only actual playback is marked.
  if (!submission) return;
  try {
    await request(auth, `/Users/${auth.jfUserId}/PlayedItems/${id}`, {}, { method: 'POST' });
  } catch {
    // Scrobbling is optional; ignore its errors.
  }
}

/**
 * A listen that already happened, dated (see the Subsonic one). Errors are let
 * through so the outbox can keep what didn't arrive, with one exception: if the
 * server takes the play but not the date, it is sent again undated. A play at
 * the wrong time is worth more than one stuck in the queue for good.
 */
export async function submitPlay(auth: SubsonicAuth, id: string, at: number): Promise<void> {
  const path = `/Users/${auth.jfUserId}/PlayedItems/${id}`;
  try {
    await request(auth, path, { datePlayed: new Date(at).toISOString() }, { method: 'POST' });
  } catch (e) {
    // Only worth a second try if the server answered at all: with no network
    // the undated one has nowhere to go either.
    if (e instanceof SubsonicRequestError && e.network) throw e;
    await request(auth, path, {}, { method: 'POST' });
  }
}

/** Cover art URL. `id` can come from an album, song, or playlist. */
export function coverArtUrl(
  auth: SubsonicAuth,
  id: string | undefined,
  size = 300,
): string | undefined {
  if (!id) return undefined;
  return buildUrl(auth, `/Items/${id}/Images/Primary`, {
    fillWidth: size,
    fillHeight: size,
    quality: 90,
    api_key: auth.jfToken,
  });
}

/** Download URL of the original file, without transcoding. */
export function downloadUrl(auth: SubsonicAuth, id: string): string {
  return buildUrl(auth, `/Items/${id}/Download`, { api_key: auth.jfToken });
}

/**
 * How Jellyfin is asked for each codec: the container it muxes into and the
 * codec inside it. Jellyfin builds a transcoding profile out of these two, so
 * asking for one and not the other gets you neither.
 */
const TRANSCODE_TO: Record<string, { container: string; codec: string }> = {
  mp3: { container: 'mp3', codec: 'mp3' },
  // Opus lives in an Ogg stream; that is what the .opus files are.
  opus: { container: 'ogg', codec: 'opus' },
  // Raw ADTS, the same thing Navidrome hands over for AAC.
  aac: { container: 'aac', codec: 'aac' },
};

/**
 * Streaming URL (`/Audio/{id}/universal`): the server serves the file as-is
 * if the container is supported and fits within the max bitrate, otherwise
 * transcodes to `format`. `maxBitRate` in kbps, as in Subsonic.
 *
 * `format` used to be ignored here, which quietly turned every choice into mp3
 * (#82): a download set to Opus arrived as an mp3 named `.opus`, at the right
 * bitrate, with the app showing the codec that had been asked for rather than
 * the one that came. Left empty it is still mp3, which is what "server
 * default" amounts to on a server that transcodes to whatever it is told.
 */
export function streamUrl(
  auth: SubsonicAuth,
  id: string,
  maxBitRate = 0,
  _timeOffset = 0,
  format = '',
): string {
  const target = TRANSCODE_TO[format] ?? TRANSCODE_TO.mp3;
  return buildUrl(auth, `/Audio/${id}/universal`, {
    UserId: auth.jfUserId,
    DeviceId: auth.jfDeviceId,
    api_key: auth.jfToken,
    Container: 'opus,webm|opus,mp3,aac,m4a|aac,m4b|aac,flac,webma,webm|webma,wav,ogg',
    TranscodingContainer: target.container,
    TranscodingProtocol: 'http',
    AudioCodec: target.codec,
    MaxStreamingBitrate: maxBitRate > 0 ? maxBitRate * 1000 : 140_000_000,
  });
}
